'use client';

import { useMutation } from '@tanstack/react-query';
import { Copy, CornerDownRight, FolderTree, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import {
  attendanceForeground, attendanceGroupPath, buildAttendanceHeader, dutyAttendanceApi,
  type AttendanceColumn, type AttendanceColumnGroup, type AttendanceLayout, type AttendanceSection, type ColumnGroupPayload,
} from '@/lib/duty-attendance';

/** Giới hạn trùng với máy chủ (MAX_COLUMN_GROUP_DEPTH). */
const MAX_DEPTH = 5;
const DEFAULT_COLOR = '#dbeafe';
type Draft = { sectionId: number; parentId: number | null; name: string; color: string; sortOrder: number; active: boolean; columnIds: number[] };
type Rule = { from: string; to: string };
const blankDraft = (sectionId: number, parentId: number | null = null): Draft => ({ sectionId, parentId, name: '', color: '', sortOrder: 100, active: true, columnIds: [] });
const inputClass = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal';

const applyRules = (value: string, rules: Rule[]) => rules.reduce((current, rule) => rule.from.trim() ? current.split(rule.from.trim().toUpperCase()).join(rule.to.trim().toUpperCase()) : current, value.toUpperCase());

/** Thứ tự hiển thị cây: nhóm và cột xen kẽ theo "thứ tự", nhóm đứng trước khi bằng nhau. */
type TreeNode = { kind: 'group'; group: AttendanceColumnGroup; depth: number } | { kind: 'column'; column: AttendanceColumn; depth: number };
function treeNodes(sectionId: number, groups: AttendanceColumnGroup[], columns: AttendanceColumn[]): TreeNode[] {
  const sectionGroups = groups.filter((group) => group.sectionId === sectionId); const ids = new Set(sectionGroups.map((group) => group.id));
  const sectionColumns = columns.filter((column) => column.sectionId === sectionId);
  const result: TreeNode[] = []; const seen = new Set<number>();
  const walk = (parentId: number | null, depth: number) => {
    const items: Array<{ order: number; rank: number; node: TreeNode }> = [
      ...sectionGroups.filter((group) => (group.parentId && ids.has(group.parentId) ? group.parentId : null) === parentId).map((group) => ({ order: group.sortOrder, rank: 0, node: { kind: 'group' as const, group, depth } })),
      ...sectionColumns.filter((column) => (column.groupId && ids.has(column.groupId) ? column.groupId : null) === parentId).map((column) => ({ order: column.sortOrder, rank: 1, node: { kind: 'column' as const, column, depth } })),
    ].sort((left, right) => left.order - right.order || left.rank - right.rank);
    for (const item of items) {
      if (item.node.kind === 'group') { if (seen.has(item.node.group.id)) continue; seen.add(item.node.group.id); result.push(item.node); walk(item.node.group.id, depth + 1); }
      else result.push(item.node);
    }
  };
  walk(null, 0);
  return result;
}

/** Xem trước tiêu đề của một phần đúng như bảng/Excel sẽ hiển thị (chỉ nhóm và cột đang bật). */
export function AttendanceHeaderPreview({ section, groups, columns }: { section: AttendanceSection; groups: AttendanceColumnGroup[]; columns: AttendanceColumn[] }) {
  const header = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const visibleColumns = treeNodes(section.id, groups, columns).flatMap((node) => node.kind === 'column' && node.column.active ? [node.column] : [])
      .map((column) => ({ column, path: attendanceGroupPath(column.groupId, byId) }))
      .filter((item) => item.path.every((group) => group.active));
    return { built: buildAttendanceHeader(visibleColumns.map((item) => ({ sectionId: section.id, name: item.column.name, path: item.path })), () => ({ name: section.name, color: section.color })), count: visibleColumns.length };
  }, [section, groups, columns]);
  if (!header.count) return <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Phần này chưa có cột đang hiển thị.</p>;
  return <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="border-collapse text-[11px]"><tbody>
    {Array.from({ length: header.built.rows }, (_, row) => <tr key={row}>{header.built.cells.filter((cell) => cell.row === row).map((cell) => {
      const style = cell.kind === 'LEAF' ? undefined : { backgroundColor: cell.color || '#f8fafc', color: cell.color ? attendanceForeground(cell.color) : '#1e293b' };
      return <td key={`${cell.row}:${cell.col}`} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={style} className={`min-w-[72px] border border-slate-300 px-2 py-1.5 text-center font-semibold leading-tight ${cell.kind === 'LEAF' ? 'bg-white text-slate-700' : ''} ${cell.kind === 'SECTION' ? 'uppercase' : ''}`}>{cell.text}</td>;
    })}</tr>)}
  </tbody></table></div>;
}

export function AttendanceColumnGroupsPanel({ layout, sections, onChanged }: { layout?: AttendanceLayout; sections: AttendanceSection[]; onChanged: () => void }) {
  const groups = useMemo(() => layout?.groups ?? [], [layout]); const columns = useMemo(() => layout?.columns ?? [], [layout]);
  const [sectionId, setSectionId] = useState<number>(0);
  useEffect(() => { if (!sections.some((section) => section.id === sectionId) && sections[0]) setSectionId(sections[0].id); }, [sections, sectionId]);
  const section = sections.find((item) => item.id === sectionId);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const nodes = useMemo(() => treeNodes(sectionId, groups, columns), [sectionId, groups, columns]);
  const pathLabel = (groupId: number | null) => attendanceGroupPath(groupId, groupsById).map((group) => group.name).join(' › ');

  const [editingId, setEditingId] = useState<number>(); const [draft, setDraft] = useState<Draft>(() => blankDraft(0));
  useEffect(() => { if (!editingId) setDraft((current) => current.sectionId === sectionId ? current : blankDraft(sectionId)); }, [sectionId, editingId]);
  const reset = (parentId: number | null = null) => { setEditingId(undefined); setDraft(blankDraft(sectionId, parentId)); };
  const edit = (group: AttendanceColumnGroup) => { setEditingId(group.id); setDraft({ sectionId: group.sectionId, parentId: group.parentId, name: group.name, color: group.color, sortOrder: group.sortOrder, active: group.active, columnIds: columns.filter((column) => column.groupId === group.id).map((column) => column.id) }); };

  /** Không cho chọn chính nhóm đang sửa hoặc nhóm con của nó làm cha, và không vượt quá số tầng. */
  const descendants = useMemo(() => { const result = new Set<number>(); if (!editingId) return result; const walk = (id: number) => { for (const group of groups.filter((item) => item.parentId === id)) { result.add(group.id); walk(group.id); } }; result.add(editingId); walk(editingId); return result; }, [editingId, groups]);
  const subtreeHeight = useMemo(() => { if (!editingId) return 1; const height = (id: number): number => 1 + Math.max(0, ...groups.filter((group) => group.parentId === id).map((group) => height(group.id))); return height(editingId); }, [editingId, groups]);
  const parentOptions = nodes.flatMap((node) => node.kind === 'group' && !descendants.has(node.group.id) && node.depth + 1 + subtreeHeight <= MAX_DEPTH ? [node] : []);
  const sectionColumns = nodes.flatMap((node) => node.kind === 'column' ? [node.column] : []);

  const payload = (): ColumnGroupPayload => ({ sectionId: draft.sectionId || sectionId, parentId: draft.parentId ?? 0, name: draft.name.trim(), color: draft.color, sortOrder: draft.sortOrder, active: draft.active, columnIds: draft.columnIds });
  const save = useMutation({ mutationFn: () => editingId ? dutyAttendanceApi.updateColumnGroup(editingId, payload()) : dutyAttendanceApi.createColumnGroup(payload()), onSuccess: () => { toast.success(editingId ? 'Đã cập nhật nhóm tiêu đề' : 'Đã thêm nhóm tiêu đề'); reset(draft.parentId); onChanged(); }, onError: (error: Error) => toast.error(error.message || 'Không lưu được nhóm tiêu đề') });
  const remove = useMutation({ mutationFn: dutyAttendanceApi.deleteColumnGroup, onSuccess: (_data, id) => { if (editingId === id) reset(); toast.success('Đã xóa nhóm; các cột và nhóm con được chuyển lên nhóm cha'); onChanged(); }, onError: (error: Error) => toast.error(error.message || 'Không xóa được nhóm') });

  // ----- nhân bản
  const [copySource, setCopySource] = useState<AttendanceColumnGroup>(); const [copyName, setCopyName] = useState(''); const [copyParent, setCopyParent] = useState<number | null>(null); const [copyOrder, setCopyOrder] = useState(100); const [rules, setRules] = useState<Rule[]>([{ from: '', to: '' }]);
  const openCopy = (group: AttendanceColumnGroup) => { setCopySource(group); setCopyName(`${group.name} (bản sao)`); setCopyParent(group.parentId); setCopyOrder(group.sortOrder + 1); setRules([{ from: '', to: '' }]); };
  const copyColumns = useMemo(() => {
    if (!copySource) return [];
    const ids = new Set<number>([copySource.id]); const walk = (id: number) => { for (const group of groups.filter((item) => item.parentId === id)) { ids.add(group.id); walk(group.id); } }; walk(copySource.id);
    const existing = new Set(columns.map((column) => column.key.toUpperCase()));
    const mapped = columns.filter((column) => column.groupId && ids.has(column.groupId)).map((column) => ({ column, key: applyRules(column.key, rules), formula: column.columnType === 'FORMULA' ? column.formula.replace(/\[([^\]]+)\]/g, (_match, ref: string) => `[${applyRules(ref.trim(), rules)}]`) : '' }));
    return mapped.map((item) => ({ ...item, conflict: existing.has(item.key) || mapped.filter((other) => other.key === item.key).length > 1 }));
  }, [copySource, groups, columns, rules]);
  const copyParentOptions = useMemo(() => {
    if (!copySource) return [];
    const height = (id: number): number => 1 + Math.max(0, ...groups.filter((group) => group.parentId === id).map((group) => height(group.id)));
    const sourceHeight = height(copySource.id);
    return treeNodes(copySource.sectionId, groups, columns).flatMap((node) => node.kind === 'group' && node.depth + 1 + sourceHeight <= MAX_DEPTH ? [node] : []);
  }, [copySource, groups, columns]);
  const duplicate = useMutation({ mutationFn: () => dutyAttendanceApi.duplicateColumnGroup(copySource!.id, { name: copyName.trim(), parentId: copyParent ?? 0, sortOrder: copyOrder, replacements: rules.filter((rule) => rule.from.trim()).map((rule) => ({ from: rule.from.trim().toUpperCase(), to: rule.to.trim().toUpperCase() })) }), onSuccess: (result) => { toast.success(`Đã nhân bản ${result.groups} nhóm và ${result.columns} cột`); setCopySource(undefined); onChanged(); }, onError: (error: Error) => toast.error(error.message || 'Không nhân bản được nhóm') });

  if (!sections.length) return <Card className="border-slate-200"><CardBody><p className="text-sm text-slate-500">Chưa có phần Báo cáo hoặc phần tự tạo để chia nhóm tiêu đề.</p></CardBody></Card>;

  return <div className="space-y-5">
    <Card className="border-sky-200 bg-sky-50/60"><CardBody className="space-y-1.5 py-4 text-sm text-sky-950">
      <p className="font-semibold">Tiêu đề nhiều tầng giống mẫu Excel</p>
      <p>Mỗi <b>nhóm tiêu đề</b> là một ô gộp nằm trên các cột của nó; nhóm có thể lồng trong nhóm khác (tối đa {MAX_DEPTH} tầng). Tên cột là dòng tiêu đề cuối cùng. Ví dụ: <i>Trực theo quy định › Ngày lễ › Trực / Nghỉ trực / Làm thêm</i>.</p>
      <p>Cách làm nhanh: tạo đủ một nhóm (ví dụ “Ngày lễ” với ba cột), rồi dùng <b>Nhân bản</b> để tạo “Ngày nghỉ”, “Ngày thường” và đổi mã cột bằng quy tắc thay thế (VD: <code>LE</code> → <code>NGHI</code>). Cột không thuộc nhóm nào (VD: “Vị trí trực”) tự gộp dọc qua mọi tầng.</p>
    </CardBody></Card>

    <label className="flex max-w-md items-center gap-2 text-sm font-semibold">Phần bảng <select value={sectionId || ''} onChange={(event) => { setSectionId(Number(event.target.value)); reset(); }} className={inputClass}>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>

    {section ? <Card className="border-slate-200"><CardHeader title="Xem trước tiêu đề" description="Hiển thị đúng như trên bảng chấm công, bản in và tệp Excel/Word." /><CardBody><AttendanceHeaderPreview section={section} groups={groups} columns={columns} /></CardBody></Card> : null}

    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="border-slate-200"><CardHeader title={editingId ? `Sửa nhóm “${groups.find((group) => group.id === editingId)?.name ?? ''}”` : 'Thêm nhóm tiêu đề'} description="Chọn nhóm cha để tạo tầng dưới. Đánh dấu các cột nằm trực tiếp dưới nhóm này." /><CardBody>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Tên nhóm (dòng tiêu đề) <input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} placeholder="VD: Trực theo quy định, Ngày lễ…" /></label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Nằm trong nhóm <select value={draft.parentId ?? ''} onChange={(event) => setDraft({ ...draft, parentId: event.target.value ? Number(event.target.value) : null })} className={inputClass}><option value="">— Cấp 1 (ngay dưới phần “{section?.name}”) —</option>{parentOptions.map((node) => node.kind === 'group' ? <option key={node.group.id} value={node.group.id}>{`${'\u00a0\u00a0\u00a0'.repeat(node.depth)}${node.group.name}`}</option> : null)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">Thứ tự <input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={inputClass} /><span className="text-xs font-normal text-slate-500">So cùng thứ tự với các cột/nhóm ngang hàng.</span></label>
          <div className="grid gap-1 text-sm font-semibold">Màu nền <div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-sm font-normal"><input type="checkbox" checked={!!draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.checked ? DEFAULT_COLOR : '' })} /> Tô màu</label>{draft.color ? <input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} className="h-9 w-14 cursor-pointer rounded border" /> : <span className="text-xs font-normal text-slate-500">Nền nhạt mặc định</span>}</div></div>
          <div className="grid gap-1.5 text-sm font-semibold sm:col-span-2">Cột nằm trực tiếp dưới nhóm này
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">{sectionColumns.length ? sectionColumns.map((column) => { const checked = draft.columnIds.includes(column.id); const elsewhere = column.groupId && column.groupId !== editingId ? pathLabel(column.groupId) : ''; return <label key={column.id} className="flex items-start gap-2 rounded px-1.5 py-1 text-sm font-normal hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={checked} onChange={(event) => setDraft({ ...draft, columnIds: event.target.checked ? [...draft.columnIds, column.id] : draft.columnIds.filter((id) => id !== column.id) })} /><span className="min-w-0"><span className="font-medium">{column.name}</span> <span className="font-mono text-xs text-slate-500">[{column.key}]</span>{!column.active ? <span className="text-xs text-slate-400"> · đang ẩn</span> : null}{elsewhere ? <span className={`block text-xs ${checked ? 'text-amber-700' : 'text-slate-500'}`}>{checked ? 'Sẽ chuyển từ' : 'Đang ở'}: {elsewhere}</span> : null}</span></label>; }) : <p className="p-2 text-sm font-normal text-slate-500">Phần này chưa có cột. Hãy thêm cột ở tab “Cột & công thức”.</p>}</div>
            <span className="text-xs font-normal text-slate-500">Bỏ chọn một cột đang thuộc nhóm này sẽ đưa cột về ngay dưới phần. Nhóm chỉ chứa nhóm con thì không cần chọn cột.</span>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Hiển thị nhóm (tắt sẽ ẩn cả nhóm con và các cột bên dưới khỏi bảng, giữ nguyên dữ liệu)</label>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={save.isPending}><Save className="h-4 w-4" /> {editingId ? 'Lưu thay đổi' : 'Thêm nhóm'}</Button>{editingId || draft.name ? <Button type="button" variant="outline" onClick={() => reset()}><X className="h-4 w-4" /> Hủy</Button> : null}</div>
        </form>
      </CardBody></Card>

      <Card className="border-slate-200"><CardHeader title="Cây tiêu đề" description="Nhóm và cột theo đúng thứ tự trái → phải trên bảng." /><CardBody>
        {nodes.length ? <div className="space-y-1">{nodes.map((node) => node.kind === 'group'
          ? <div key={`g${node.group.id}`} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${editingId === node.group.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200'}`} style={{ marginLeft: node.depth * 20 }}>
              <FolderTree className="h-4 w-4 shrink-0 text-slate-500" /><span className="h-4 w-4 shrink-0 rounded border" style={{ backgroundColor: node.group.color || '#f8fafc' }} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{node.group.name}</p><p className="text-xs text-slate-500">thứ tự {node.group.sortOrder}{!node.group.active ? ' · đang ẩn' : ''}</p></div>
              <div className="flex shrink-0 gap-0.5">
                {node.depth + 1 < MAX_DEPTH ? <Button size="icon" variant="ghost" title="Thêm nhóm con" onClick={() => reset(node.group.id)}><Plus className="h-4 w-4" /></Button> : null}
                <Button size="icon" variant="ghost" title="Sửa" onClick={() => edit(node.group)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" title="Nhân bản cùng nhóm con và cột" onClick={() => openCopy(node.group)}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-rose-700" title="Xóa nhóm (giữ cột)" onClick={() => { if (confirm(`Xóa nhóm “${node.group.name}”? Các cột và nhóm con sẽ được chuyển lên nhóm cha, không mất dữ liệu.`)) remove.mutate(node.group.id); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          : <div key={`c${node.column.id}`} className="flex items-center gap-2 px-2 py-1 text-sm" style={{ marginLeft: node.depth * 20 }}><CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className={`rounded px-1 py-0.5 text-[10px] font-bold ${node.column.columnType === 'FORMULA' ? 'bg-indigo-100 text-indigo-800' : 'bg-violet-100 text-violet-800'}`}>{node.column.columnType === 'FORMULA' ? 'CT' : 'TN'}</span><span className={`truncate ${node.column.active ? '' : 'text-slate-400 line-through'}`}>{node.column.name}</span><span className="font-mono text-xs text-slate-500">[{node.column.key}]</span><span className="ml-auto text-xs text-slate-400">{node.column.sortOrder}</span></div>)}</div>
          : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Chưa có nhóm hoặc cột trong phần này.</p>}
      </CardBody></Card>
    </div>

    <Dialog open={!!copySource} onClose={() => { if (!duplicate.isPending) setCopySource(undefined); }} size="lg" title={`Nhân bản nhóm “${copySource?.name ?? ''}”`} description="Sao chép nhóm, toàn bộ nhóm con và cột bên dưới. Mã cột phải là duy nhất nên cần quy tắc thay thế; tham chiếu trong công thức được đổi theo cùng quy tắc."
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCopySource(undefined)} disabled={duplicate.isPending}>Hủy</Button><Button onClick={() => duplicate.mutate()} disabled={duplicate.isPending || !copyName.trim() || copyColumns.some((item) => item.conflict)}><Copy className="h-4 w-4" /> Nhân bản</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Tên nhóm mới <input value={copyName} maxLength={120} onChange={(event) => setCopyName(event.target.value)} className={inputClass} /></label>
        <label className="grid gap-1 text-sm font-semibold">Nằm trong nhóm <select value={copyParent ?? ''} onChange={(event) => setCopyParent(event.target.value ? Number(event.target.value) : null)} className={inputClass}><option value="">— Cấp 1 —</option>{copyParentOptions.map((node) => node.kind === 'group' ? <option key={node.group.id} value={node.group.id}>{`${'\u00a0\u00a0\u00a0'.repeat(node.depth)}${node.group.name}`}</option> : null)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Thứ tự <input type="number" value={copyOrder} onChange={(event) => setCopyOrder(Number(event.target.value))} className={inputClass} /></label>
        <div className="grid gap-2 sm:col-span-2"><p className="text-sm font-semibold">Quy tắc thay thế mã cột (áp dụng lần lượt)</p>
          {rules.map((rule, index) => <div key={index} className="flex items-center gap-2"><input value={rule.from} maxLength={32} placeholder="Tìm, VD: LE" onChange={(event) => setRules(rules.map((item, at) => at === index ? { ...item, from: event.target.value.toUpperCase() } : item))} className={`${inputClass} flex-1 font-mono uppercase`} /><span className="text-slate-400">→</span><input value={rule.to} maxLength={32} placeholder="Thay bằng, VD: NGHI" onChange={(event) => setRules(rules.map((item, at) => at === index ? { ...item, to: event.target.value.toUpperCase() } : item))} className={`${inputClass} flex-1 font-mono uppercase`} /><Button size="icon" variant="ghost" onClick={() => setRules(rules.length > 1 ? rules.filter((_item, at) => at !== index) : [{ from: '', to: '' }])}><X className="h-4 w-4" /></Button></div>)}
          {rules.length < 10 ? <Button variant="outline" size="sm" className="w-fit" onClick={() => setRules([...rules, { from: '', to: '' }])}><Plus className="h-4 w-4" /> Thêm quy tắc</Button> : null}
        </div>
        <div className="sm:col-span-2"><p className="mb-1.5 text-sm font-semibold">Xem trước {copyColumns.length} cột sẽ tạo</p>
          {copyColumns.length ? <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-xs"><thead className="bg-slate-50 text-left"><tr><th className="px-2 py-1.5">Tên cột</th><th className="px-2 py-1.5">Mã cũ → mã mới</th><th className="px-2 py-1.5">Công thức mới</th></tr></thead><tbody>{copyColumns.map((item) => <tr key={item.column.id} className={item.conflict ? 'bg-rose-50' : ''}><td className="border-t px-2 py-1">{item.column.name}</td><td className="border-t px-2 py-1 font-mono">{item.column.key} → <b className={item.conflict ? 'text-rose-700' : 'text-emerald-700'}>{item.key}</b>{item.conflict ? <span className="block font-sans text-rose-700">Trùng mã đã có — thêm/sửa quy tắc</span> : null}</td><td className="border-t px-2 py-1 font-mono text-slate-600">{item.formula || '—'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">Nhóm này chưa có cột; chỉ sao chép cấu trúc nhóm.</p>}
        </div>
      </div>
    </Dialog>
  </div>;
}
