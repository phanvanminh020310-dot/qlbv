/**
 * Đọc danh sách nhân viên từ tệp Excel (.xlsx), CSV hoặc TXT.
 *
 * - Tự tìm dòng tiêu đề trong 15 dòng đầu (bỏ qua các dòng tên bệnh viện, tiêu đề bảng…).
 * - Tên cột linh hoạt, không phân biệt dấu/hoa thường: "Họ và tên", "HO TEN", "Số điện thoại", "SĐT"…
 * - CSV/TXT: tự nhận dấu phân cách (, ; tab |) và bảng mã (UTF-8, UTF-16 của Excel
 *   "Unicode Text", Windows-1258).
 * - Excel: đọc ô hyperlink/rich text/công thức; số điện thoại bị Excel lưu thành số được
 *   thêm lại số 0 đầu.
 */
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export type ImportField =
  | 'username'
  | 'fullName'
  | 'title'
  | 'managementPosition'
  | 'department'
  | 'email'
  | 'phone'
  | 'note'
  | 'roles'
  | 'password'
  | 'employeeCode';

export interface ParsedRow {
  /** Số dòng trong tệp (tính cả dòng tiêu đề, bắt đầu từ 1) — để báo lỗi cho người dùng */
  line: number;
  values: Partial<Record<ImportField, string>>;
}

export interface ParsedFile {
  rows: ParsedRow[];
  /** Cột nhận diện được: tên cột trong tệp → trường */
  columns: { header: string; field: ImportField | null }[];
  format: 'xlsx' | 'csv' | 'txt';
  encoding?: string;
  delimiter?: string;
  sheet?: string;
}

export const IMPORT_MAX_ROWS = 5000;

/** Bỏ dấu, chữ thường, chỉ giữ a-z0-9 */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES: Record<ImportField, string[]> = {
  username: ['tendangnhap', 'taikhoan', 'tentaikhoan', 'username', 'login', 'user', 'account'],
  fullName: ['hoten', 'hovaten', 'hotennhanvien', 'tennhanvien', 'fullname', 'name', 'hotencanbo', 'tencanbo'],
  title: ['chucdanh', 'title', 'jobtitle', 'chucdanhnghenghiep', 'chucdanhchuyenmon'],
  managementPosition: ['chucvu', 'chucvukiemnhiem', 'chucvuquanly', 'managementposition', 'position'],
  department: ['makhoa', 'khoa', 'khoaphong', 'donvi', 'madonvi', 'tendonvi', 'tenkhoa', 'phongban', 'department', 'departmentcode', 'bophan'],
  email: ['email', 'thudientu', 'mail', 'diachiemail', 'emailaddress', 'thu'],
  phone: ['dienthoai', 'sodienthoai', 'sdt', 'dt', 'phone', 'mobile', 'didong', 'sodidong', 'dienthoaididong'],
  note: ['ghichu', 'note', 'notes'],
  roles: ['vaitro', 'roles', 'role', 'nhomquyen', 'quyen'],
  password: ['matkhau', 'password', 'matkhaubandau'],
  employeeCode: ['manhanvien', 'manv', 'macanbo', 'macb', 'employeecode', 'employeeid', 'sohieu'],
};
const ALIAS_TO_FIELD = new Map<string, ImportField>();
for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
  for (const a of aliases) ALIAS_TO_FIELD.set(a, field);
}

function fieldOf(header: string): ImportField | null {
  const k = normalizeKey(header);
  if (!k) return null;
  return ALIAS_TO_FIELD.get(k) ?? null;
}

/* ----------------------------------------------------------------- CSV / TXT */

function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16LE' };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16BE' };
  }
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(start));
    return { text, encoding: 'UTF-8' };
  } catch {
    /* không phải UTF-8 → thử bảng mã tiếng Việt của Windows */
  }
  for (const enc of ['windows-1258', 'windows-1252']) {
    try {
      return { text: new TextDecoder(enc).decode(buf), encoding: enc };
    } catch {
      /* Node không có ICU đầy đủ */
    }
  }
  return { text: buf.toString('latin1'), encoding: 'latin1' };
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of ['\t', ';', ',', '|']) {
    const counts = lines.map((l) => splitCsvLine(l, d).length);
    const max = Math.max(0, ...counts);
    if (max < 2) continue;
    // Ưu tiên dấu cho nhiều cột và số cột ổn định giữa các dòng
    const stable = counts.filter((c) => c === max).length;
    const score = max * 10 + stable;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Tách 1 dòng (dùng cho dò dấu phân cách) */
function splitCsvLine(line: string, d: string): string[] {
  return parseCsv(line, d)[0] ?? [];
}

/** Bộ đọc CSV theo RFC 4180 (hỗ trợ ngoặc kép, xuống dòng trong ô) */
function parseCsv(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* --------------------------------------------------------------------- Excel */

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) {
    const dd = String(v.getDate()).padStart(2, '0');
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${v.getFullYear()}`;
  }
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if (typeof o.text === 'string') return o.text; // hyperlink
    if (o.text && typeof o.text === 'object') return cellText(o.text as ExcelJS.CellValue);
    if ('result' in o) return cellText(o.result as ExcelJS.CellValue); // công thức
    if (typeof o.error === 'string') return '';
  }
  return String(v);
}

async function readXlsx(buf: Buffer): Promise<{ grid: string[][]; sheet: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      'Không đọc được tệp Excel. Nếu là tệp .xls (Excel 97-2003), hãy mở bằng Excel và "Lưu thành" .xlsx hoặc CSV UTF-8.',
    );
  }
  // Chọn trang tính có nhiều dữ liệu nhất (bỏ trang "Hướng dẫn" của tệp mẫu)
  let best: ExcelJS.Worksheet | undefined;
  for (const ws of wb.worksheets) {
    if (normalizeKey(ws.name).startsWith('huongdan')) continue;
    if (!best || ws.actualRowCount > best.actualRowCount) best = ws;
  }
  best ??= wb.worksheets[0];
  if (!best) throw new BadRequestException('Tệp Excel không có trang tính nào');
  const grid: string[][] = [];
  best.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    const count = Math.max(row.cellCount, row.actualCellCount);
    for (let c = 1; c <= count; c++) cells.push(cellText(row.getCell(c).value).trim());
    grid[rowNumber - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return { grid, sheet: best.name };
}

/* ------------------------------------------------------------------ Chung */

function gridToRows(grid: string[][]): { rows: ParsedRow[]; columns: ParsedFile['columns'] } {
  // Dòng tiêu đề = dòng đầu tiên (trong 15 dòng) nhận diện được ≥ 2 cột
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const known = new Set((grid[i] ?? []).map((h) => fieldOf(h.normalize('NFC'))).filter(Boolean));
    if (known.size >= 2 && (known.has('fullName') || known.has('username'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new BadRequestException(
      'Không tìm thấy dòng tiêu đề. Tệp cần có ít nhất cột "Họ và tên" (hoặc "Tên đăng nhập") và một cột khác như "Khoa", "Chức danh". Hãy tải tệp mẫu để xem.',
    );
  }
  const headers = (grid[headerIdx] ?? []).map((h) => h.normalize('NFC').trim());
  const fields = headers.map(fieldOf);
  // Hai cột cùng nghĩa → chỉ lấy cột đầu tiên
  const seen = new Set<ImportField>();
  const used = fields.map((f) => {
    if (!f || seen.has(f)) return null;
    seen.add(f);
    return f;
  });
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    if (!cells.some((c) => String(c ?? '').trim())) continue;
    const values: ParsedRow['values'] = {};
    used.forEach((f, ci) => {
      // NFC: bảng mã Windows-1258 / tệp từ máy Mac lưu dấu tiếng Việt dạng tổ hợp
      if (f) values[f] = String(cells[ci] ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    });
    // Dòng không có dữ liệu ở cột nào nhận diện được (chỉ có STT…) → bỏ qua
    if (!Object.values(values).some(Boolean)) continue;
    rows.push({ line: i + 1, values });
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new BadRequestException(`Tệp có ${rows.length} dòng — tối đa ${IMPORT_MAX_ROWS} dòng mỗi lần nhập, hãy chia nhỏ tệp`);
  }
  return { rows, columns: headers.map((h, i) => ({ header: h, field: used[i] ?? null })).filter((c) => c.header) };
}

export async function parseImportFile(buf: Buffer, fileName: string): Promise<ParsedFile> {
  const lower = fileName.toLowerCase();
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // .xlsx là tệp zip
  if (lower.endsWith('.xls') && !isZip) {
    throw new BadRequestException('Tệp .xls (Excel 97-2003) chưa được hỗ trợ — hãy "Lưu thành" .xlsx hoặc CSV UTF-8 rồi nhập lại.');
  }
  if (isZip || lower.endsWith('.xlsx')) {
    const { grid, sheet } = await readXlsx(buf);
    return { ...gridToRows(grid), format: 'xlsx', sheet };
  }
  if (!/\.(csv|txt|tsv)$/.test(lower)) {
    throw new BadRequestException('Chỉ nhận tệp .xlsx, .csv hoặc .txt');
  }
  const { text, encoding } = decodeText(buf);
  const delimiter = detectDelimiter(text);
  const grid = parseCsv(text, delimiter).map((r) => r.map((c) => c.trim()));
  return { ...gridToRows(grid), format: lower.endsWith('.csv') ? 'csv' : 'txt', encoding, delimiter };
}

/**
 * Tạo tên đăng nhập từ họ tên kiểu phổ biến ở Việt Nam: tên + chữ cái đầu họ, đệm.
 * "Nguyễn Văn An" → "annv". Trùng thì thêm số: annv2, annv3…
 */
export function suggestUsername(fullName: string, taken: Set<string>): string {
  const parts = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  const given = parts[parts.length - 1]!;
  const base = (given + parts.slice(0, -1).map((p) => p[0]).join('')).slice(0, 60) || 'user';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
  return name;
}

/**
 * Đọc tệp .xlsx / .csv / .txt thành lưới ô (dùng chung cho các chức năng nhập khác, vd tài sản).
 * Tự nhận bảng mã (UTF-8/UTF-16/Windows-1258…) và dấu phân cách.
 */
export async function readTabularGrid(buf: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (lower.endsWith('.xls') && !isZip) {
    throw new BadRequestException('Tệp .xls (Excel 97-2003) chưa được hỗ trợ — hãy "Lưu thành" .xlsx hoặc CSV UTF-8 rồi nhập lại.');
  }
  if (isZip || lower.endsWith('.xlsx')) return (await readXlsx(buf)).grid;
  if (!/\.(csv|txt|tsv)$/.test(lower)) throw new BadRequestException('Chỉ nhận tệp .xlsx, .csv hoặc .txt');
  const { text } = decodeText(buf);
  return parseCsv(text, detectDelimiter(text)).map((r) => r.map((c) => c.trim()));
}
