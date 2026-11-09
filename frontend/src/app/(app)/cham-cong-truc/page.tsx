"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileText, FileSpreadsheet, Loader2, LockKeyhole, Printer, RefreshCw, Save, Settings2, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/api';
import { previewAttendanceBoolean, previewAttendanceNumber, attendanceReferences, solveAttendanceEquality } from '@/lib/attendance-expression';
import { attendanceKeys, dutyAttendanceApi, type AttendanceColumn, type AttendanceDate, type AttendanceMonth, type AttendanceSection, type AttendanceStaff } from '@/lib/duty-attendance';

const bangkokMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
};
const currentMonth = () => bangkokMonth();
const previousMonth = (month: string, delta: number) => { const [year, value] = month.split('-').map(Number); const date = new Date(year, value - 1 + delta, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
const cellKey = (userId: number, date: string) => `${userId}:${date}`;
const manualCellKey = (userId: number, columnId: number) => `${userId}:${columnId}`;
const MONTH_LABELS_VI = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const monthLabel = (value: string) => { const [year, month] = value.split('-'); return `Tháng ${Number(month)}/${year}`; };
const numberLabel = (value: string | number) => typeof value === 'number' ? value.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) : value;

function foreground(hex: string) {
  const raw = hex.replace('#', ''); const r = Number.parseInt(raw.slice(0, 2), 16); const g = Number.parseInt(raw.slice(2, 4), 16); const b = Number.parseInt(raw.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#0f172a' : '#ffffff';
}

/** Chỉ chọn tháng/năm, không có ngày để tránh nhầm với ô chấm công theo ngày. */
function VietnameseMonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const [open, setOpen] = useState(false); const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4))); const [selectedYear, selectedMonth] = value.split('-').map(Number);
  useEffect(() => { setViewYear(selectedYear); }, [selectedYear]);
  return <div className="relative border-x bg-transparent">
    <button type="button" aria-label="Chọn tháng chấm công" aria-expanded={open} onClick={() => { setViewYear(selectedYear); setOpen((shown) => !shown); }} className="flex h-9 w-44 items-center gap-2 px-3 text-left text-sm font-semibold hover:bg-[var(--muted)]/60"><CalendarDays className="size-4 shrink-0 text-[var(--primary)]" /><span>{monthLabel(value)}</span></button>
    {open ? <div role="dialog" aria-label="Chọn tháng chấm công" className="absolute left-0 top-[calc(100%+0.4rem)] z-[60] w-80 rounded-xl border bg-[var(--card)] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-2"><button type="button" aria-label="Năm trước" onClick={() => setViewYear((year) => year - 1)} className="rounded-lg p-1.5 hover:bg-[var(--muted)]"><ChevronLeft className="size-4" /></button><p className="text-sm font-semibold">Chọn tháng năm {viewYear}</p><button type="button" aria-label="Năm sau" onClick={() => setViewYear((year) => year + 1)} className="rounded-lg p-1.5 hover:bg-[var(--muted)]"><ChevronRight className="size-4" /></button></div>
      <div className="grid grid-cols-3 gap-2">{MONTH_LABELS_VI.map((label, index) => { const month = index + 1; const selected = selectedYear === viewYear && selectedMonth === month; return <button key={label} type="button" onClick={() => { onChange(`${viewYear}-${String(month).padStart(2, '0')}`); setOpen(false); }} className={`h-10 rounded-lg text-sm transition-colors ${selected ? 'bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]' : 'border hover:border-[var(--primary)] hover:bg-[var(--accent)]'}`}>{label}</button>; })}</div>
      <div className="mt-3 flex justify-end border-t pt-2"><button type="button" onClick={() => { onChange(currentMonth()); setOpen(false); }} className="text-xs font-medium text-[var(--primary)] hover:underline">Tháng hiện tại · {monthLabel(currentMonth())}</button></div>
    </div> : null}
  </div>;
}

function CodeSelect({ data, person, date, value, disabled, onSave }: { data: AttendanceMonth; person: AttendanceStaff; date: AttendanceDate; value: string; disabled: boolean; onSave: (code: string) => void }) {
  const tone = date.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : date.isRest ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white';
  const title = date.isPast ? 'Ngày đã qua được khóa, không thể sửa' : value ? `Ký hiệu: ${value}` : 'Chưa nhập ký hiệu';
  return <select aria-label={`Chấm công ${person.fullName}, ngày ${date.day}`} title={title} value={value} disabled={disabled} onChange={(event) => onSave(event.target.value)} className={`h-9 min-w-12 rounded-lg border px-1 text-center text-sm font-bold shadow-sm outline-none transition focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-70 ${tone} ${date.isPast ? 'saturate-50' : ''}`}><option value="" aria-label="Chưa nhập ký hiệu"></option>{data.codes.map((code) => <option value={code.code} key={code.id}>{code.code}</option>)}</select>;
}

type TableColumn = { key: string; name: string; kind: 'ADMIN' | 'DAY' | 'SYMBOL' | 'FORMULA' | 'MANUAL'; section: AttendanceSection; day?: AttendanceDate; column?: AttendanceColumn };
type ColumnGroup = { section: AttendanceSection; columns: TableColumn[] };
type ManualIssue = { key?: string; userId?: number; message: string };
type ManualPreview = { issues: ManualIssue[]; byKey: Record<string, string>; userIssues: Record<number, string> };
const NUMERIC_INPUT = /^-?\d+(?:[.,]\d+)?$/;

function isEmptyManualValue(value: string | number | undefined) { return String(value ?? '').trim() === ''; }

/** Tính lại cột công thức với số liệu tự nhập hiện có, chỉ dùng để xem trước ở trình duyệt. */
function previewManualRowValues(data: AttendanceMonth, person: AttendanceStaff, manualColumns: AttendanceColumn[], formulaColumns: AttendanceColumn[], manualDrafts: Record<string, string>) {
  const values: Record<string, string | number | undefined> = { ...data.rowValues[String(person.id)] };
  for (const column of manualColumns) { const key = manualCellKey(person.id, column.id); values[column.key.toUpperCase()] = manualDrafts[key] ?? data.manualValues[key] ?? ''; }
  const formulas = new Map(formulaColumns.map((column) => [column.key.toUpperCase(), column])); const cache = new Map<string, number>(); const visiting = new Set<string>();
  const formula = (key: string): number => { if (cache.has(key)) return cache.get(key)!; if (visiting.has(key)) throw new Error('Công thức vòng lặp'); const column = formulas.get(key); if (!column) return Number(values[key] ?? 0) || 0; visiting.add(key); const next = { ...values }; for (const reference of attendanceReferences(column.formula)) if (formulas.has(reference)) next[reference] = formula(reference); const result = previewAttendanceNumber(column.formula, next); visiting.delete(key); cache.set(key, result); values[key] = result; return result; };
  try { for (const column of formulaColumns) formula(column.key.toUpperCase()); } catch { /* Cấu hình mới/sai vẫn do máy chủ xác thực khi lưu. */ }
  return values;
}

/** Ràng buộc được chờ khi vẫn còn ô tự nhập được tham chiếu chưa có giá trị. */
function manualRuleIncomplete(expression: string, manualColumns: AttendanceColumn[], values: Record<string, string | number | undefined>) {
  const manualKeys = new Set(manualColumns.map((column) => column.key.toUpperCase()));
  return attendanceReferences(expression).some((reference) => manualKeys.has(reference) && isEmptyManualValue(values[reference]));
}

function previewManualValues(data: AttendanceMonth | undefined, manualColumns: AttendanceColumn[], formulaColumns: AttendanceColumn[], manualDrafts: Record<string, string>): ManualPreview {
  const issues: ManualIssue[] = []; const byKey: Record<string, string> = {}; const userIssues: Record<number, string> = {};
  if (!data) return { issues, byKey, userIssues };
  const columnsById = new Map(manualColumns.map((column) => [column.id, column])); const invalidUsers = new Set<number>();
  for (const [key, value] of Object.entries(manualDrafts)) {
    const [userIdText, columnIdText] = key.split(':'); const userId = Number(userIdText); const column = columnsById.get(Number(columnIdText));
    if (column?.dataType === 'NUMBER' && value.trim() && !NUMERIC_INPUT.test(value.trim())) { const message = `${column.name}: chỉ được nhập số`; byKey[key] = message; userIssues[userId] = message; invalidUsers.add(userId); issues.push({ key, userId, message }); }
  }
  for (const person of data.staff) {
    const values = previewManualRowValues(data, person, manualColumns, formulaColumns, manualDrafts); const hasManualValue = manualColumns.some((column) => !isEmptyManualValue(values[column.key.toUpperCase()]));
    if (!hasManualValue || invalidUsers.has(person.id)) continue;
    for (const rule of data.validations) {
      if (manualRuleIncomplete(rule.expression, manualColumns, values)) continue;
      try {
        if (previewAttendanceBoolean(rule.expression, values)) continue;
        const message = rule.message || `Ràng buộc “${rule.name}” chưa đúng cho ${person.fullName}`; userIssues[person.id] = message; issues.push({ userId: person.id, message });
        for (const column of manualColumns) byKey[manualCellKey(person.id, column.id)] ??= message;
      } catch { const message = `Không thể xem trước ràng buộc “${rule.name}”; hãy kiểm tra lại biểu thức`; userIssues[person.id] = message; issues.push({ userId: person.id, message }); }
    }
  }
  return { issues, byKey, userIssues };
}

/** Khi một ràng buộc bằng có đúng một ô số còn trống, điền chính xác ô đó thay vì đoán. */
function completeOneManualValue(data: AttendanceMonth, person: AttendanceStaff, manualColumns: AttendanceColumn[], formulaColumns: AttendanceColumn[], manualDrafts: Record<string, string>) {
  let next = { ...manualDrafts };
  for (let pass = 0; pass < manualColumns.length; pass++) {
    const values = previewManualRowValues(data, person, manualColumns, formulaColumns, next); let filled = false;
    for (const rule of data.validations) {
      const references = new Set(attendanceReferences(rule.expression));
      const related = manualColumns.filter((column) => references.has(column.key.toUpperCase()));
      if (!related.length || related.some((column) => column.dataType === 'NUMBER' && !isEmptyManualValue(values[column.key.toUpperCase()]) && !NUMERIC_INPUT.test(String(values[column.key.toUpperCase()]).trim()))) continue;
      const missing = related.filter((column) => isEmptyManualValue(values[column.key.toUpperCase()]));
      if (missing.length !== 1 || missing[0].dataType !== 'NUMBER') continue;
      const column = missing[0]; const answer = solveAttendanceEquality(rule.expression, values, column.key.toUpperCase());
      if (answer === null) continue;
      next[manualCellKey(person.id, column.id)] = String(answer); filled = true; break;
    }
    if (!filled) break;
  }
  return next;
}

function tableGroups(data: AttendanceMonth, hiddenSections = new Set<string>()): ColumnGroup[] {
  return data.sections.filter((section) => !hiddenSections.has(section.code)).map((section) => {
    let columns: TableColumn[] = [];
    if (section.kind === 'ADMIN') columns = [{ key: 'STT', name: 'STT', kind: 'ADMIN', section }, { key: 'USERNAME', name: 'MANV', kind: 'ADMIN', section }, { key: 'FULL_NAME', name: 'Họ và tên', kind: 'ADMIN', section }, { key: 'TITLE', name: 'Chức danh', kind: 'ADMIN', section }];
    if (section.kind === 'DAYS') columns = data.dates.map((day) => ({ key: `DAY:${day.date}`, name: String(day.day), kind: 'DAY', section, day }));
    if (section.kind === 'SYMBOLS') columns = data.codes.map((code) => ({ key: code.code.toUpperCase(), name: code.name, kind: 'SYMBOL', section }));
    if (section.kind === 'REPORT' || section.kind === 'CUSTOM') columns = data.columns.filter((column) => column.sectionId === section.id).map((column) => ({ key: column.key.toUpperCase(), name: column.name, kind: column.columnType, section, column }));
    return { section, columns };
  }).filter((group) => group.columns.length);
}

function adminValue(person: AttendanceStaff, key: string) { if (key === 'STT') return person.stt; if (key === 'FULL_NAME') return person.fullName; if (key === 'TITLE') return person.title || ''; return person.username; }

function ManualInput({ person, column, data, value, disabled, invalid, warning, onChange, onCommit }: { person: AttendanceStaff; column: AttendanceColumn; data: AttendanceMonth; value: string; disabled: boolean; invalid?: boolean; warning?: string; onChange: (value: string) => void; onCommit: (value: string) => void }) {
  const locked = data.month < data.today.slice(0, 7);
  return <input aria-label={`${column.name} của ${person.fullName}`} aria-invalid={invalid || undefined} title={locked ? 'Tháng đã qua được khóa để bảo toàn lịch sử' : warning || column.placeholder || 'Tự nhập'} type="text" inputMode={column.dataType === 'NUMBER' ? 'decimal' : 'text'} placeholder={column.placeholder || 'Tự nhập'} value={value} disabled={disabled || locked} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onCommit(event.target.value)} className={`h-8 min-w-20 rounded-md border px-2 text-center text-sm outline-none placeholder:text-violet-300 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${invalid ? 'border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-100' : 'border-violet-200 bg-violet-50/40 focus:border-violet-500 focus:ring-violet-100'}`} />;
}

function pinnedAdminClass(column: TableColumn) {
  if (column.kind !== 'ADMIN') return '';
  if (column.key === 'STT') return 'sticky left-0 z-50 w-[56px] min-w-[56px]';
  if (column.key === 'USERNAME') return 'sticky left-[56px] z-50 w-[130px] min-w-[130px]';
  if (column.key === 'FULL_NAME') return 'sticky left-[186px] z-50 w-[240px] min-w-[240px]';
  return 'sticky left-[426px] z-50 w-[176px] min-w-[176px]';
}

function DesktopAttendanceGrid({ data, canUpdate, saving, manualDrafts, manualIssuesByKey, hiddenSections, onCodeSave, onManualChange, onManualCommit }: { data: AttendanceMonth; canUpdate: boolean; saving: boolean; manualDrafts: Record<string, string>; manualIssuesByKey: Record<string, string>; hiddenSections: Set<string>; onCodeSave: (entry: { userId: number; workDate: string; code: string }) => void; onManualChange: (key: string, value: string) => void; onManualCommit: (key: string, value: string) => void }) {
  const groups = useMemo(() => tableGroups(data, hiddenSections), [data, hiddenSections]); const columns = useMemo(() => groups.flatMap((group) => group.columns), [groups]);
  const dayTone = (day: AttendanceDate) => day.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : day.isRest ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700';
  return <Card className="hidden overflow-hidden border-slate-200 bg-white shadow-sm md:block print:block">
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3 print:hidden"><div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs"><div className="flex flex-wrap items-center gap-3 text-slate-600"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-700" /> Các phần bảng được khai báo riêng</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Thứ Bảy, Chủ nhật</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Lễ / ngày nghỉ</span><span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" /> Ngày đã qua khóa sửa</span></div><span className="text-slate-500">Thông tin hành chính luôn được cố định bên trái; kéo ngang để xem các phần khác.</span></div></div>
    <div className="min-h-[24rem] max-h-[calc(100vh-18rem)] overflow-auto bg-slate-50/40 [-webkit-overflow-scrolling:touch] print:max-h-none print:overflow-visible">
      <table className="min-w-max table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>{columns.map((column) => <col key={column.key + column.section.id} style={{ width: column.key === 'FULL_NAME' ? 240 : column.key === 'TITLE' ? 176 : column.key === 'USERNAME' ? 130 : column.kind === 'ADMIN' ? 56 : column.kind === 'DAY' ? 56 : 104 }} />)}</colgroup>
        <thead>
          <tr className="h-10 text-xs uppercase tracking-wide">{groups.map((group) => <th key={group.section.id} colSpan={group.columns.length} className={`sticky top-0 z-20 border-b border-r border-white/40 px-3 text-center font-bold ${group.section.kind === 'ADMIN' ? 'left-0 z-[60] min-w-[602px]' : ''}`} style={{ backgroundColor: group.section.color, color: foreground(group.section.color) }}>{group.section.name}</th>)}</tr>
          <tr className="h-10 text-xs">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-10 z-20 border-b border-r px-2 text-center font-bold ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-100 text-slate-700'}`} title={column.kind === 'FORMULA' ? column.column?.formula : column.kind === 'MANUAL' ? column.column?.placeholder : undefined}>{column.kind === 'SYMBOL' ? <span className="block truncate" title={column.name}>{column.key}</span> : column.name}</th>)}</tr>
          <tr className="h-7 text-[11px]">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-20 z-20 border-b border-r px-1 text-center ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{column.kind === 'DAY' ? column.day!.weekday : column.kind === 'SYMBOL' ? data.codes.find((code) => code.code.toUpperCase() === column.key)?.name : column.kind === 'FORMULA' ? 'Công thức' : column.kind === 'MANUAL' ? 'Tự nhập' : ''}</th>)}</tr>
        </thead>
        <tbody>{data.staff.map((person, index) => <tr key={person.id} className={`group hover:bg-sky-50/70 ${index % 2 ? 'bg-slate-50' : 'bg-white'}`}>{columns.map((column) => {
          if (column.kind === 'ADMIN') return <td key={column.key + column.section.id} className={`border-b border-r border-slate-200 px-3 py-2 ${pinnedAdminClass(column)} ${index % 2 ? 'bg-slate-50' : 'bg-white'} ${column.key === 'FULL_NAME' ? 'font-semibold' : 'text-center'} ${column.key === 'USERNAME' ? 'font-mono text-xs text-slate-600' : ''}`}>{adminValue(person, column.key)}</td>;
          if (column.kind === 'DAY') { const day = column.day!; return <td key={column.key} className={`border-b border-r px-1.5 py-1 text-center ${dayTone(day)}`}><CodeSelect data={data} person={person} date={day} value={data.entries[cellKey(person.id, day.date)]?.code ?? ''} disabled={!canUpdate || saving || day.isPast} onSave={(code) => onCodeSave({ userId: person.id, workDate: day.date, code })} /></td>; }
          if (column.kind === 'MANUAL') { const key = manualCellKey(person.id, column.column!.id); const value = manualDrafts[key] ?? data.manualValues[key] ?? ''; return <td key={column.key} className="border-b border-r border-violet-100 bg-violet-50/20 px-1.5 py-1 text-center"><ManualInput person={person} column={column.column!} data={data} value={value} disabled={!canUpdate || saving} invalid={!!manualIssuesByKey[key]} warning={manualIssuesByKey[key]} onChange={(value) => onManualChange(key, value)} onCommit={(value) => onManualCommit(key, value)} /></td>; }
          const value = data.rowValues[String(person.id)]?.[column.key]; return <td key={column.key} className={`border-b border-r px-2 py-2 text-center font-medium ${column.kind === 'FORMULA' ? 'border-indigo-100 bg-indigo-50/30 text-indigo-900' : 'border-emerald-100 bg-emerald-50/35 text-emerald-900'}`}>{typeof value === 'number' && value === 0 ? '' : value === undefined ? '' : numberLabel(value)}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </Card>;
}

export default function ChamCongTrucPage() {
  const can = useAuth((state) => state.can); const currentUser = useAuth((state) => state.user); const client = useQueryClient();
  const [month, setMonth] = useState(currentMonth); const [selectedDepartmentId, setSelectedDepartmentId] = useState<number>(); const [selectedDepartmentUserId, setSelectedDepartmentUserId] = useState<number>(); const [mobileDate, setMobileDate] = useState(''); const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({}); const [hiddenSectionCodes, setHiddenSectionCodes] = useState<string[]>([]);
  const canView = can('duty-attendance.view'); const canUpdate = can('duty-attendance.update'); const canExport = can('duty-attendance.export'); const canCatalog = can('duty-attendance.catalog.manage'); const userId = currentUser?.id;
  const departmentScope = useQuery({ queryKey: attendanceKeys.departments(userId), queryFn: dutyAttendanceApi.departments, enabled: canView && !!userId, refetchOnMount: 'always' });
  useEffect(() => { setMobileDate(''); setManualDrafts({}); }, [userId, month, selectedDepartmentId]);
  useEffect(() => { if (!userId || !departmentScope.data?.items.length || (selectedDepartmentUserId === userId && selectedDepartmentId)) return; setSelectedDepartmentUserId(userId); setSelectedDepartmentId(departmentScope.data.items[0].id); }, [departmentScope.data, selectedDepartmentId, selectedDepartmentUserId, userId]);
  const departmentId = selectedDepartmentUserId === userId ? selectedDepartmentId : undefined;
  const query = useQuery({ queryKey: attendanceKeys.month(userId, month, departmentId), queryFn: () => dutyAttendanceApi.month(month, departmentId), enabled: canView && !!userId && !!departmentId, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const data = query.data; const activeDate = mobileDate && data?.dates.some((date) => date.date === mobileDate) ? mobileDate : data?.dates.find((date) => date.date === data.today)?.date ?? data?.dates[0]?.date ?? '';
  const save = useMutation({ mutationFn: (entry: { userId: number; workDate: string; code: string }) => dutyAttendanceApi.save([{ ...entry, code: entry.code || null }], departmentId), onMutate: async (entry) => { await client.cancelQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); const before = client.getQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId)); if (before) client.setQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId), { ...before, entries: { ...before.entries, [cellKey(entry.userId, entry.workDate)]: entry.code ? { code: entry.code, note: '' } : undefined as never } }); return { before }; }, onError: (error: Error, _entry, context) => { if (context?.before) client.setQueryData(attendanceKeys.month(userId, month, departmentId), context.before); toast.error(error.message || 'Không lưu được ô chấm công'); }, onSuccess: () => { void client.invalidateQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); } });
  type ManualSaveRequest = { values: Array<{ userId: number; columnId: number; value: string }>; quiet?: boolean };
  const saveManual = useMutation({
    mutationFn: ({ values }: ManualSaveRequest) => dutyAttendanceApi.saveManualValues(month, values, departmentId),
    onMutate: async ({ values }) => {
      await client.cancelQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); const before = client.getQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId));
      if (before) client.setQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId), { ...before, manualValues: { ...before.manualValues, ...Object.fromEntries(values.map((item) => [manualCellKey(item.userId, item.columnId), item.value])) } });
      return { before };
    },
    onSuccess: (_result, request) => {
      setManualDrafts((current) => { const next = { ...current }; for (const item of request.values) { const key = manualCellKey(item.userId, item.columnId); if (next[key] === item.value) delete next[key]; } return next; });
      if (!request.quiet) toast.success('Đã lưu số liệu tự nhập và kiểm tra ràng buộc');
      void client.invalidateQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) });
    },
    onError: (error: Error, _request, context) => { if (context?.before) client.setQueryData(attendanceKeys.month(userId, month, departmentId), context.before); toast.error(error.message || 'Không lưu được số liệu tự nhập'); },
  });
  const doExport = async (format: 'xlsx' | 'docx' | 'pdf') => { try { await downloadFile(dutyAttendanceApi.exportPath(format, month, departmentId), `BANG_CHAM_CONG_${month}.${format}`); } catch (error) { toast.error(error instanceof Error ? error.message : 'Không thể xuất tệp'); } };
  const refreshBoard = async () => { await Promise.all([departmentScope.refetch(), query.refetch()]); toast.success('Đã làm mới bảng chấm công'); };
  const selected = useMemo(() => data?.dates.find((date) => date.date === activeDate), [data, activeDate]);
  const manualColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'MANUAL') ?? [], [data]); const formulaColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'FORMULA') ?? [], [data]); const hiddenSections = useMemo(() => new Set(hiddenSectionCodes), [hiddenSectionCodes]);
  const manualPreview = useMemo(() => previewManualValues(data, manualColumns, formulaColumns, manualDrafts), [data, formulaColumns, manualColumns, manualDrafts]);
  const toggleSection = (code: string) => setHiddenSectionCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const saveAllManual = () => { if (!data || !Object.keys(manualDrafts).length) return; if (manualPreview.issues.length) { toast.error(`Chưa thể lưu: ${manualPreview.issues[0].message}`); return; } const values = Object.entries(manualDrafts).map(([key, value]) => { const [userIdText, columnIdText] = key.split(':'); return { userId: Number(userIdText), columnId: Number(columnIdText), value }; }); saveManual.mutate({ values }); };
  const commitManualValue = (key: string, value: string) => {
    if (!data || saveManual.isPending) return;
    const [userIdText] = key.split(':'); const person = data.staff.find((item) => item.id === Number(userIdText)); if (!person) return;
    const entered = { ...manualDrafts, [key]: value }; const completed = completeOneManualValue(data, person, manualColumns, formulaColumns, entered); const preview = previewManualValues(data, manualColumns, formulaColumns, completed);
    setManualDrafts(completed);
    const issue = preview.issues.find((item) => item.userId === person.id || item.key === key);
    if (issue) { toast.error(`Chưa thể tự lưu: ${issue.message}`); return; }
    const values = Object.entries(completed).flatMap(([draftKey, draftValue]) => { const [draftUserId, columnId] = draftKey.split(':'); return Number(draftUserId) === person.id ? [{ userId: person.id, columnId: Number(columnId), value: draftValue }] : []; });
    const changed = values.filter((item) => item.value !== (data.manualValues[manualCellKey(item.userId, item.columnId)] ?? ''));
    if (changed.length) saveManual.mutate({ values: changed, quiet: true });
    else setManualDrafts((current) => { const next = { ...current }; for (const item of values) delete next[manualCellKey(item.userId, item.columnId)]; return next; });
  };

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem bảng chấm công" description="Vai trò Nhập chấm công trực khoa được cấp riêng cho Hành chính trưởng hoặc Chủ nhiệm khoa." />;
  if (departmentScope.isLoading || query.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[32rem] w-full" /></div>;
  if (departmentScope.isError) return <EmptyState title="Không tải được danh sách khoa/phòng" description={departmentScope.error instanceof Error ? departmentScope.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;
  if (!departmentId) return <EmptyState title="Chưa có khoa/phòng để chấm công" description="Hãy tạo hoặc kích hoạt khoa/phòng, sau đó thử lại." />;
  if (query.isError || !data) return <EmptyState title="Không tải được bảng chấm công" description={query.error instanceof Error ? query.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;

  return <>
    <PageHeader title="Bảng chấm công trực và chấm công khác" description={`Nhập ký hiệu theo ngày cho ${data.department.name}; tổng ký hiệu, công thức và số liệu tự nhập được tách thành các phần độc lập.`} actions={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <div className="flex items-center rounded-lg border bg-white shadow-sm"><Button variant="ghost" size="sm" aria-label="Tháng trước" onClick={() => setMonth(previousMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><VietnameseMonthPicker value={month} onChange={setMonth} /><Button variant="ghost" size="sm" aria-label="Tháng sau" onClick={() => setMonth(previousMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
      {departmentScope.data?.canSelect && <select aria-label="Chọn khoa/phòng" value={departmentId ?? ''} onChange={(event) => { setSelectedDepartmentUserId(userId); setSelectedDepartmentId(Number(event.target.value)); }} className="h-9 max-w-64 rounded-lg border bg-white px-3 text-sm font-medium shadow-sm"><option value="" disabled>Chọn khoa/phòng</option>{departmentScope.data.items.map((department) => <option key={department.id} value={department.id}>{department.shortName || department.name}{department.code ? ` (${department.code})` : ''}</option>)}</select>}
      {Object.keys(manualDrafts).length > 0 && canUpdate ? <Button size="sm" onClick={saveAllManual} disabled={saveManual.isPending}><Save className="h-4 w-4" /> Lưu số liệu tự nhập ({Object.keys(manualDrafts).length})</Button> : null}
      {canExport && <><Button variant="outline" size="sm" onClick={() => doExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span></Button><Button variant="outline" size="sm" onClick={() => doExport('docx')}><FileText className="h-4 w-4" /> <span className="hidden sm:inline">Word</span></Button><Button variant="outline" size="sm" onClick={() => doExport('pdf')}><Download className="h-4 w-4" /> PDF</Button></>}
      {canCatalog && <Link href="/cham-cong-truc/danh-muc"><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Khai báo bảng</span></Button></Link>}
      <Button variant="outline" size="sm" onClick={() => void refreshBoard()} disabled={departmentScope.isFetching || query.isFetching} title="Làm mới dữ liệu bảng chấm công"><RefreshCw className={`h-4 w-4 ${(departmentScope.isFetching || query.isFetching) ? 'animate-spin' : ''}`} /><span className="hidden sm:inline"> Làm mới</span></Button><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline"> In</span></Button>
    </div>} />

    <Card className="mb-4 border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white shadow-sm"><CardBody className="space-y-3 py-3.5"><div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><Users className="h-4 w-4 text-sky-700" /> {data.staff.length} nhân viên</span><span><b className="text-violet-700">Tự nhập</b> = tự lưu khi rời ô; còn đúng một ô số theo ràng buộc thì hệ thống tự tính. <b className="text-indigo-700">Công thức</b> = hệ thống tự tính</span><span className="text-slate-500">Ngày đã qua khóa sửa. Số liệu tự nhập của tháng đã qua cũng được khóa để bảo toàn lịch sử.</span></div><div className="border-t border-sky-100 pt-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="h-2 w-2 rounded-full bg-sky-600" /> Ký hiệu và giá trị đếm đang khai báo</div><div className="flex flex-wrap gap-2">{data.codes.map((code) => <span key={code.id} title={code.note || code.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: code.color }} /><b className="font-mono text-slate-900">{code.code}</b><span className="text-slate-600">{code.name} = {code.countValue}</span></span>)}</div></div></CardBody></Card>

    <Card className="mb-4 hidden border-slate-200 bg-white shadow-sm md:block print:hidden"><CardBody className="flex flex-wrap items-center gap-2 py-2.5"><span className="mr-1 text-sm font-semibold text-slate-700">Hiển thị phần:</span>{data.sections.map((section) => { const pinned = section.kind === 'ADMIN'; const visible = pinned || !hiddenSections.has(section.code); return <button key={section.id} type="button" disabled={pinned} onClick={() => toggleSection(section.code)} title={pinned ? 'Thông tin hành chính luôn được cố định để nhận biết nhân viên khi cuộn ngang' : visible ? `Ẩn phần ${section.name}` : `Hiện phần ${section.name}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${visible ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-slate-200 bg-white text-slate-400 line-through'} ${pinned ? 'cursor-default' : 'hover:border-sky-400 hover:bg-sky-50'}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: section.color }} />{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{section.name}{pinned ? ' · cố định' : ''}</button>; })}</CardBody></Card>
    {manualPreview.issues.length ? <Card className="mb-4 border-rose-200 bg-rose-50 shadow-sm"><CardBody className="flex gap-3 py-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" /><div className="min-w-0"><p className="font-semibold text-rose-900">Có {manualPreview.issues.length} dữ liệu tự nhập cần điều chỉnh trước khi lưu</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-rose-800">{[...new Set(manualPreview.issues.map((issue) => issue.message))].slice(0, 3).map((message) => <li key={message}>{message}</li>)}</ul><p className="mt-1 text-xs text-rose-700">Ô có vấn đề được viền đỏ. Hệ thống sẽ không lưu khi kiểu số hoặc ràng buộc công thức chưa hợp lệ.</p></div></CardBody></Card> : null}

    <div className="space-y-3 md:hidden"><div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{data.dates.map((date) => <button key={date.date} onClick={() => setMobileDate(date.date)} className={`min-w-13 snap-start rounded-xl border px-2 py-2 text-center text-xs shadow-sm ${activeDate === date.date ? 'border-sky-600 bg-sky-600 text-white' : date.isWeekend ? 'border-rose-300 bg-rose-50 text-rose-800' : date.isRest ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-white'} ${date.isPast ? 'opacity-70' : ''}`}><b className="block text-base leading-4">{date.day}</b><span>{date.weekday}</span></button>)}</div>
      {selected ? <Card className={selected.isWeekend ? 'border-rose-300' : selected.isRest ? 'border-amber-300' : ''}><CardBody className="py-3"><p className="font-semibold">Ngày {selected.day} · {selected.weekday} {selected.holidayName ? `— ${selected.holidayName}` : ''}</p><p className="mt-0.5 text-xs text-slate-500">{selected.isPast ? 'Ngày đã qua: chỉ xem, không được sửa.' : 'Chọn ký hiệu cho từng nhân viên bên dưới.'}</p></CardBody></Card> : null}
      <div className="space-y-2">{data.staff.map((person) => <Card key={person.id}><CardBody className="space-y-3 py-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.stt}. {person.fullName}</p><p className="truncate text-xs text-slate-500">{person.title || 'Chưa khai báo chức danh'} · MANV: {person.username}</p></div>{selected ? <CodeSelect data={data} person={person} date={selected} value={data.entries[cellKey(person.id, selected.date)]?.code ?? ''} disabled={!canUpdate || save.isPending || selected.isPast} onSave={(code) => save.mutate({ userId: person.id, workDate: selected.date, code })} /> : null}</div>
        {(formulaColumns.length || manualColumns.length) ? <div className="grid grid-cols-2 gap-2 border-t pt-2">{formulaColumns.map((column) => <div key={column.id} className="rounded-lg bg-indigo-50 p-2"><p className="text-[11px] font-medium text-indigo-700">{column.name}</p><p className="font-semibold text-indigo-950">{numberLabel(data.rowValues[String(person.id)]?.[column.key] ?? 0)}</p></div>)}{manualColumns.map((column) => { const key = manualCellKey(person.id, column.id); return <label key={column.id} className="grid gap-1 text-[11px] font-medium text-violet-700">{column.name}<ManualInput person={person} column={column} data={data} value={manualDrafts[key] ?? data.manualValues[key] ?? ''} disabled={!canUpdate || saveManual.isPending} invalid={!!manualPreview.byKey[key]} warning={manualPreview.byKey[key]} onChange={(value) => setManualDrafts((current) => ({ ...current, [key]: value }))} onCommit={(value) => commitManualValue(key, value)} /></label>; })}</div> : null}
      </CardBody></Card>)}</div>
    </div>

    <DesktopAttendanceGrid data={data} canUpdate={canUpdate} saving={save.isPending || saveManual.isPending} manualDrafts={manualDrafts} manualIssuesByKey={manualPreview.byKey} hiddenSections={hiddenSections} onCodeSave={save.mutate} onManualChange={(key, value) => setManualDrafts((current) => ({ ...current, [key]: value }))} onManualCommit={commitManualValue} />
    {(save.isPending || saveManual.isPending) ? <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu…</div> : null}
  </>;
}
