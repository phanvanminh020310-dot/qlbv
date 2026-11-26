/**
 * Bố cục tiêu đề nhiều tầng của bảng chấm công — hàm thuần, dùng chung cho bảng tổng hợp,
 * Excel, Word, PDF để mọi nơi hiển thị cùng một cấu trúc do người dùng khai báo.
 *
 * Cây trong mỗi phần: phần → nhóm (lồng nhau tùy ý) → cột. Nhóm và cột cùng cấp xếp theo
 * sort_order (bằng nhau thì nhóm trước, rồi id). Thứ tự cột hiển thị là duyệt cây theo chiều
 * sâu, nhờ đó các cột của cùng một nhóm luôn liền nhau để gộp ô tiêu đề.
 */

export type LayoutGroup = { id: number; sectionId: number; parentId: number | null; name: string; color: string; sortOrder: number; active: boolean };
export type LayoutColumn = { id: number; sectionId: number; groupId: number | null; sortOrder: number };

/** Số tầng nhóm tối đa dưới một phần, đủ cho các mẫu báo cáo thực tế và vẫn dễ đọc. */
export const MAX_COLUMN_GROUP_DEPTH = 5;

/** Đường dẫn nhóm từ cấp cao nhất đến nhóm trực tiếp chứa cột. Bỏ qua vòng lặp nếu dữ liệu hỏng. */
export function groupPath<G extends LayoutGroup>(groupId: number | null | undefined, groupsById: Map<number, G>): G[] {
  const path: G[] = []; const seen = new Set<number>();
  let current = groupId ? groupsById.get(groupId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id); path.unshift(current);
    current = current.parentId ? groupsById.get(current.parentId) : undefined;
  }
  return path;
}

/** Nhóm được hiển thị khi chính nó và mọi nhóm cha đều đang dùng. */
export function visibleGroupIds(groups: LayoutGroup[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const visible = new Set<number>();
  for (const group of groups) {
    const path = groupPath(group.id, byId);
    if (path.length && path[0]!.parentId === null && path.every((item) => item.active)) visible.add(group.id);
  }
  return visible;
}

/**
 * Sắp xếp cột theo cây. Cột trỏ tới nhóm không có trong danh sách (hoặc khác phần) được coi
 * là nằm ngay dưới phần để không bao giờ mất cột khỏi bảng.
 */
export function orderColumnsByTree<C extends LayoutColumn>(sectionIds: number[], groups: LayoutGroup[], columns: C[]): C[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  type Item = { kind: 'group'; group: LayoutGroup } | { kind: 'column'; column: C };
  const children = new Map<string, Item[]>();
  const push = (key: string, item: Item) => children.set(key, [...(children.get(key) ?? []), item]);
  for (const group of groups) {
    const parent = group.parentId ? groupById.get(group.parentId) : undefined;
    push(`${group.sectionId}:${parent && parent.sectionId === group.sectionId ? parent.id : 0}`, { kind: 'group', group });
  }
  for (const column of columns) {
    const group = column.groupId ? groupById.get(column.groupId) : undefined;
    push(`${column.sectionId}:${group && group.sectionId === column.sectionId ? group.id : 0}`, { kind: 'column', column });
  }
  const order = (item: Item) => item.kind === 'group' ? item.group.sortOrder : item.column.sortOrder;
  const ordered: C[] = []; const visited = new Set<number>();
  const visit = (key: string) => {
    const items = [...(children.get(key) ?? [])].sort((left, right) => order(left) - order(right)
      || (left.kind === right.kind ? 0 : left.kind === 'group' ? -1 : 1)
      || (left.kind === 'group' ? left.group.id : left.column.id) - (right.kind === 'group' ? right.group.id : right.column.id));
    for (const item of items) {
      if (item.kind === 'column') { ordered.push(item.column); continue; }
      if (visited.has(item.group.id)) continue;
      visited.add(item.group.id); visit(`${item.group.sectionId}:${item.group.id}`);
    }
  };
  const sections = [...new Set([...sectionIds, ...columns.map((column) => column.sectionId)])];
  for (const sectionId of sections) visit(`${sectionId}:0`);
  // Cột trong nhóm bị vòng lặp (dữ liệu hỏng) vẫn được giữ ở cuối.
  const placed = new Set(ordered.map((column) => column.id));
  for (const column of columns) if (!placed.has(column.id)) ordered.push(column);
  return ordered;
}

export type HeaderColumn = { sectionId: number; sectionName: string; sectionColor: string; name: string; path: Array<{ id: number; name: string; color: string }> };
export type HeaderCell = { kind: 'SECTION' | 'GROUP' | 'LEAF'; row: number; col: number; rowSpan: number; colSpan: number; text: string; color: string; columnIndex?: number };

/**
 * Lưới ô tiêu đề: hàng 0 là phần; hàng 1..depth là các tầng nhóm; tên cột đặt ngay dưới nhóm
 * sâu nhất của nó và kéo dài tới hàng cuối (depth + 1). Tổng số hàng = depth + 2.
 */
export function buildHeaderCells(columns: HeaderColumn[]): { depth: number; rows: number; cells: HeaderCell[] } {
  const depth = columns.reduce((max, column) => Math.max(max, column.path.length), 0);
  const cells: HeaderCell[] = [];
  for (let index = 0; index < columns.length;) {
    let end = index + 1;
    while (end < columns.length && columns[end]!.sectionId === columns[index]!.sectionId) end += 1;
    cells.push({ kind: 'SECTION', row: 0, col: index, rowSpan: 1, colSpan: end - index, text: columns[index]!.sectionName, color: columns[index]!.sectionColor });
    index = end;
  }
  for (let level = 0; level < depth; level++) {
    for (let index = 0; index < columns.length;) {
      const group = columns[index]!.path[level];
      if (!group) { index += 1; continue; }
      let end = index + 1;
      while (end < columns.length && columns[end]!.sectionId === columns[index]!.sectionId && columns[end]!.path[level]?.id === group.id) end += 1;
      cells.push({ kind: 'GROUP', row: level + 1, col: index, rowSpan: 1, colSpan: end - index, text: group.name, color: group.color });
      index = end;
    }
  }
  columns.forEach((column, index) => {
    const row = column.path.length + 1;
    cells.push({ kind: 'LEAF', row, col: index, rowSpan: depth + 2 - row, colSpan: 1, text: column.name, color: '', columnIndex: index });
  });
  cells.sort((left, right) => left.row - right.row || left.col - right.col);
  return { depth, rows: depth + 2, cells };
}

/** Áp dụng lần lượt các quy tắc thay thế chuỗi (dùng khi nhân bản nhóm: mã cột và tham chiếu công thức). */
export function applyReplacements(value: string, replacements: Array<{ from: string; to: string }>) {
  return replacements.reduce((current, rule) => rule.from ? current.split(rule.from).join(rule.to) : current, value);
}

/** Chỉ thay trong các tham chiếu [MA] của công thức, không đụng toán tử/số. */
export function replaceFormulaReferences(formula: string, replacements: Array<{ from: string; to: string }>) {
  return formula.replace(/\[([^\]]+)\]/g, (_match, reference: string) => `[${applyReplacements(reference.trim().toUpperCase(), replacements)}]`);
}
