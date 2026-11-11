"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileText, FileSpreadsheet, Loader2, LockKeyhole, Printer, RefreshCw, Settings2, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/api';
import { attendanceKeys, dutyAttendanceApi, type AttendanceCode, type AttendanceColumn, type AttendanceDate, type AttendanceMonth, type AttendanceSection, type AttendanceStaff } from '@/lib/duty-attendance';

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
const LOCK_POLICY_LABEL = { DAILY: 'qua ngày', WEEKLY: 'theo tuần', MONTHLY: 'theo tháng', YEARLY: 'theo năm' } as const;
const monthLabel = (value: string) => { const [year, month] = value.split('-'); return `Tháng ${Number(month)}/${year}`; };
const numberLabel = (value: string | number) => typeof value === 'number' ? value.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) : value;
const calculationRoleLabel = (code: AttendanceCode) => code.calculationRole === 'DUTY' ? 'Trực' : code.calculationRole === 'REINFORCEMENT' ? 'Tăng cường' : code.calculationRole === 'REST' ? `Nghỉ bù (${code.restSource === 'ANY_DUTY' ? 'mọi ca' : code.restSource === 'DUTY' ? 'trực' : 'tăng cường'})` : 'không phân loại';

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
  const tone = date.holidayName ? 'border-amber-200 bg-amber-50 text-amber-900' : date.isWorkingOverride ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : date.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white';
  const selected = data.codes.find((code) => code.code === value); const legacyCode = value && !selected ? value : undefined; const title = date.isLocked ? 'Ngày này đã được khóa theo chế độ khóa bảng chấm công' : selected ? `${selected.code} — ${selected.name}${selected.note ? `: ${selected.note}` : ''}` : legacyCode ? `${legacyCode} — Ký hiệu lịch sử đã ngừng dùng` : 'Chưa nhập ký hiệu';
  return <select aria-label={`Chấm công ${person.fullName}, ngày ${date.day}`} title={title} value={value} disabled={disabled} onChange={(event) => onSave(event.target.value)} className={`h-9 w-12 max-w-12 rounded-lg border px-1 text-center text-sm font-bold shadow-sm outline-none transition focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-70 ${tone} ${date.isLocked ? 'saturate-50' : ''}`}><option value="" aria-label="Chưa nhập ký hiệu"></option>{legacyCode ? <option value={legacyCode} disabled>{legacyCode} — Ký hiệu lịch sử đã ngừng dùng</option> : null}{data.codes.map((code) => <option value={code.code} key={code.id} title={`${code.name}${code.note ? ` — ${code.note}` : ''}`}>{code.code} — {code.name}</option>)}</select>;
}

type TableColumn = { key: string; name: string; kind: 'ADMIN' | 'DAY' | 'SYMBOL' | 'FORMULA' | 'MANUAL'; section: AttendanceSection; day?: AttendanceDate; column?: AttendanceColumn };
type ColumnGroup = { section: AttendanceSection; columns: TableColumn[] };
const NUMBER_WHILE_TYPING = /^\d*(?:[.,]\d*)?$/;

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

/** Chốt dữ liệu sau khi tiêu điểm rời hẳn một dòng/khối nhập liệu. */
function leavesContainer(element: HTMLElement, relatedTarget: EventTarget | null) { return !(relatedTarget instanceof Node && element.contains(relatedTarget)); }

/**
 * Giữ ô nhập gọn như textbox. TEXT dùng textarea một dòng, không cho kéo giãn,
 * nên vẫn nhận được Enter/dán nhiều dòng mà không làm thay đổi kích thước bảng.
 */
function ManualInput({ person, column, data, value, disabled, violation = [], onChange }: { person: AttendanceStaff; column: AttendanceColumn; data: AttendanceMonth; value: string; disabled: boolean; violation?: string[]; onChange: (value: string) => void }) {
  const locked = data.manualLocked;
  const violationText = violation.join(' ');
  const title = locked ? 'Tháng/kỳ năm này đã được khóa theo chế độ khóa bảng chấm công' : violationText || column.placeholder || 'Tự nhập';
  const unavailable = disabled || locked;
  const fieldClass = `h-8 min-w-20 rounded-md border px-2 text-sm outline-none placeholder:text-violet-300 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${violationText ? 'border-rose-700 bg-rose-100 font-bold text-rose-950 focus:border-rose-700 focus:ring-rose-200' : 'border-violet-200 bg-violet-50/40 focus:border-violet-500 focus:ring-violet-100'}`;
  if (column.dataType === 'TEXT') {
    const longestLine = Math.max(0, ...value.split('\n').map((line) => line.length));
    const width = Math.min(64, Math.max(12, longestLine + 2));
    return <textarea aria-label={`${column.name} của ${person.fullName}`} title={title} placeholder={column.placeholder || 'Tự nhập'} value={value} disabled={unavailable} rows={1} style={{ width: `${width}ch` }} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} max-w-[32rem] resize-none overflow-y-auto py-1 leading-6 text-left`} />;
  }
  return <input aria-label={`${column.name} của ${person.fullName}`} title={title} type="text" inputMode="decimal" placeholder={column.placeholder || '0'} value={value} disabled={unavailable} onChange={(event) => { const next = event.target.value; const isDeletingLegacyNegative = value.startsWith('-') && /^-?\d*(?:[.,]\d*)?$/.test(next); if (!NUMBER_WHILE_TYPING.test(next) && !isDeletingLegacyNegative) return; onChange(next); }} className={`${fieldClass} w-full text-center`} />;
}

function pinnedAdminClass(column: TableColumn) {
  if (column.kind !== 'ADMIN') return '';
  if (column.key === 'STT') return 'sticky left-0 z-50 w-[56px] min-w-[56px]';
  if (column.key === 'USERNAME') return 'sticky left-[56px] z-50 w-[130px] min-w-[130px]';
  if (column.key === 'FULL_NAME') return 'sticky left-[186px] z-50 w-[240px] min-w-[240px]';
  return 'sticky left-[426px] z-50 w-[176px] min-w-[176px]';
}

function DesktopAttendanceGrid({ data, canUpdate, saving, manualDrafts, manualViolations, hiddenSections, onCodeSave, onManualChange, onManualRowCommit }: { data: AttendanceMonth; canUpdate: boolean; saving: boolean; manualDrafts: Record<string, string>; manualViolations: Record<string, string[]>; hiddenSections: Set<string>; onCodeSave: (entry: { userId: number; workDate: string; code: string }) => void; onManualChange: (key: string, value: string) => void; onManualRowCommit: (userId: number) => void }) {
  const groups = useMemo(() => tableGroups(data, hiddenSections), [data, hiddenSections]); const columns = useMemo(() => groups.flatMap((group) => group.columns), [groups]);
  const dayTone = (day: AttendanceDate) => day.holidayName ? 'border-amber-200 bg-amber-50 text-amber-900' : day.isWorkingOverride ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : day.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700';
  return <Card className="hidden overflow-hidden border-slate-200 bg-white shadow-sm md:block print:block">
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3 print:hidden"><div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs"><div className="flex flex-wrap items-center gap-3 text-slate-600"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-700" /> Các phần bảng được khai báo riêng</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Thứ Bảy, Chủ nhật</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Lễ / ngày nghỉ</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ngày làm bù / hoán đổi</span><span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" /> Ô đã khóa theo cấu hình</span></div><span className="text-slate-500">Thông tin hành chính luôn được cố định bên trái; kéo ngang để xem các phần khác.</span></div></div>
    <div className="min-h-[24rem] max-h-[calc(100vh-18rem)] overflow-auto bg-slate-50/40 [-webkit-overflow-scrolling:touch] print:max-h-none print:overflow-visible">
      <table className="min-w-max table-auto border-separate border-spacing-0 text-[13px]">
        <colgroup>{columns.map((column) => <col key={column.key + column.section.id} style={{ width: column.key === 'FULL_NAME' ? 240 : column.key === 'TITLE' ? 176 : column.key === 'USERNAME' ? 130 : column.kind === 'ADMIN' ? 56 : column.kind === 'DAY' ? 56 : column.kind === 'MANUAL' && column.column?.dataType === 'TEXT' ? undefined : 104 }} />)}</colgroup>
        <thead>
          <tr className="h-10 text-xs uppercase tracking-wide">{groups.map((group) => <th key={group.section.id} colSpan={group.columns.length} className={`sticky top-0 z-20 border-b border-r border-white/40 px-3 text-center font-bold ${group.section.kind === 'ADMIN' ? 'left-0 z-[60] min-w-[602px]' : ''}`} style={{ backgroundColor: group.section.color, color: foreground(group.section.color) }}>{group.section.name}</th>)}</tr>
          <tr className="h-10 text-xs">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-10 z-20 border-b border-r px-2 text-center font-bold ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-100 text-slate-700'}`} title={column.kind === 'FORMULA' ? column.column?.formula : column.kind === 'MANUAL' ? column.column?.placeholder : undefined}>{column.kind === 'SYMBOL' ? <span className="block truncate" title={column.name}>{column.key}</span> : column.name}</th>)}</tr>
          <tr className="h-7 text-[11px]">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-20 z-20 border-b border-r px-1 text-center ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{column.kind === 'DAY' ? column.day!.weekday : column.kind === 'SYMBOL' ? data.codes.find((code) => code.code.toUpperCase() === column.key)?.name : column.kind === 'FORMULA' ? 'Công thức' : column.kind === 'MANUAL' ? 'Tự nhập' : ''}</th>)}</tr>
        </thead>
        <tbody>{data.staff.map((person, index) => <tr key={person.id} onBlur={(event) => { if (leavesContainer(event.currentTarget, event.relatedTarget)) onManualRowCommit(person.id); }} className={`group hover:bg-sky-50/70 ${index % 2 ? 'bg-slate-50' : 'bg-white'}`}>{columns.map((column) => {
          if (column.kind === 'ADMIN') return <td key={column.key + column.section.id} className={`border-b border-r border-slate-200 px-3 py-2 ${pinnedAdminClass(column)} ${index % 2 ? 'bg-slate-50' : 'bg-white'} ${column.key === 'FULL_NAME' ? 'font-semibold' : 'text-center'} ${column.key === 'USERNAME' ? 'font-mono text-xs text-slate-600' : ''}`}>{adminValue(person, column.key)}</td>;
          if (column.kind === 'DAY') { const day = column.day!; return <td key={column.key} className={`border-b border-r px-1.5 py-1 text-center ${dayTone(day)}`}><CodeSelect data={data} person={person} date={day} value={data.entries[cellKey(person.id, day.date)]?.code ?? ''} disabled={!canUpdate || saving || day.isLocked} onSave={(code) => onCodeSave({ userId: person.id, workDate: day.date, code })} /></td>; }
          if (column.kind === 'MANUAL') { const key = manualCellKey(person.id, column.column!.id); const value = manualDrafts[key] ?? data.manualValues[key] ?? ''; const violation = manualViolations[key] ?? []; return <td key={column.key} className={`border-b border-r px-1.5 py-1 text-center ${violation.length ? 'border-rose-300 bg-rose-50' : 'border-violet-100 bg-violet-50/20'}`}><ManualInput person={person} column={column.column!} data={data} value={value} violation={violation} disabled={!canUpdate} onChange={(value) => onManualChange(key, value)} /></td>; }
          const value = data.rowValues[String(person.id)]?.[column.key]; return <td key={column.key} className={`border-b border-r px-2 py-2 text-center font-medium ${column.kind === 'FORMULA' ? 'border-indigo-100 bg-indigo-50/30 text-indigo-900' : 'border-emerald-100 bg-emerald-50/35 text-emerald-900'}`}>{typeof value === 'number' && value === 0 ? '' : value === undefined ? '' : numberLabel(value)}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </Card>;
}

export default function ChamCongTrucPage() {
  const can = useAuth((state) => state.can); const currentUser = useAuth((state) => state.user); const client = useQueryClient();
  const [month, setMonth] = useState(currentMonth); const [selectedDepartmentId, setSelectedDepartmentId] = useState<number>(); const [selectedDepartmentUserId, setSelectedDepartmentUserId] = useState<number>(); const [mobileDate, setMobileDate] = useState(''); const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({}); const [hiddenSectionCodes, setHiddenSectionCodes] = useState<string[]>([]);
  const manualDraftsRef = useRef<Record<string, string>>({}); const manualSaveQueues = useRef(new Map<number, Promise<unknown>>()); const manualSaveTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>()); const manualViewKeyRef = useRef('');
  const updateManualDrafts = (updater: (current: Record<string, string>) => Record<string, string>) => setManualDrafts((current) => { const next = updater(current); manualDraftsRef.current = next; return next; });
  const replaceManualDrafts = (next: Record<string, string>) => { manualDraftsRef.current = next; setManualDrafts(next); };
  const canView = can('duty-attendance.view'); const canUpdate = can('duty-attendance.update'); const canExport = can('duty-attendance.export'); const canCatalog = can('duty-attendance.catalog.manage'); const userId = currentUser?.id;
  const departmentScope = useQuery({ queryKey: attendanceKeys.departments(userId), queryFn: dutyAttendanceApi.departments, enabled: canView && !!userId, refetchOnMount: 'always' });
  useEffect(() => {
    setMobileDate('');
    replaceManualDrafts({});
    manualSaveQueues.current.clear();
    manualSaveTimers.current.forEach((timer) => clearTimeout(timer));
    manualSaveTimers.current.clear();
  }, [userId, month, selectedDepartmentId]);
  useEffect(() => { if (!userId || !departmentScope.data?.items.length || (selectedDepartmentUserId === userId && selectedDepartmentId)) return; setSelectedDepartmentUserId(userId); setSelectedDepartmentId(departmentScope.data.items[0].id); }, [departmentScope.data, selectedDepartmentId, selectedDepartmentUserId, userId]);
  const departmentId = selectedDepartmentUserId === userId ? selectedDepartmentId : undefined;
  const manualViewKey = `${userId ?? 0}:${month}:${departmentId ?? 0}`; manualViewKeyRef.current = manualViewKey;
  const query = useQuery({ queryKey: attendanceKeys.month(userId, month, departmentId), queryFn: () => dutyAttendanceApi.month(month, departmentId), enabled: canView && !!userId && !!departmentId, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const data = query.data; const activeDate = mobileDate && data?.dates.some((date) => date.date === mobileDate) ? mobileDate : data?.dates.find((date) => date.date === data.today)?.date ?? data?.dates[0]?.date ?? '';
  const save = useMutation({ mutationFn: (entry: { userId: number; workDate: string; code: string }) => dutyAttendanceApi.save([{ ...entry, code: entry.code || null }], departmentId), onMutate: async (entry) => { await client.cancelQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); const before = client.getQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId)); if (before) client.setQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId), { ...before, entries: { ...before.entries, [cellKey(entry.userId, entry.workDate)]: entry.code ? { code: entry.code, note: '' } : undefined as never } }); return { before }; }, onError: (error: Error, _entry, context) => { if (context?.before) client.setQueryData(attendanceKeys.month(userId, month, departmentId), context.before); toast.error(error.message || 'Không lưu được ô chấm công'); }, onSuccess: () => { void client.invalidateQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); } });
  type ManualSaveRequest = { values: Array<{ userId: number; columnId: number; value: string }>; quiet?: boolean; viewKey: string };
  const saveManual = useMutation({
    mutationFn: ({ values }: ManualSaveRequest) => dutyAttendanceApi.saveManualValues(month, values, departmentId),
    onSuccess: (_result, request) => {
      if (request.viewKey !== manualViewKeyRef.current) return;
      const queryKey = attendanceKeys.month(userId, month, departmentId);
      client.setQueryData<AttendanceMonth>(queryKey, (current) => {
        if (!current) return current; const manualValues = { ...current.manualValues };
        for (const item of request.values) { const key = manualCellKey(item.userId, item.columnId); if (item.value) manualValues[key] = item.value; else delete manualValues[key]; }
        return { ...current, manualValues };
      });
      updateManualDrafts((current) => { const next = { ...current }; for (const item of request.values) { const key = manualCellKey(item.userId, item.columnId); if (next[key] === item.value) delete next[key]; } return next; });
      if (!request.quiet) toast.success('Đã lưu số liệu tự nhập');
      void client.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => { toast.error(error.message || 'Không lưu được số liệu tự nhập; các ô vừa sửa vẫn được giữ để bạn chỉnh lại.'); },
  });
  const doExport = async (format: 'xlsx' | 'docx' | 'pdf') => { try { await downloadFile(dutyAttendanceApi.exportPath(format, month, departmentId), `BANG_CHAM_CONG_${month}.${format}`); } catch (error) { toast.error(error instanceof Error ? error.message : 'Không thể xuất tệp'); } };
  const refreshBoard = async () => { await Promise.all([departmentScope.refetch(), query.refetch()]); toast.success('Đã làm mới bảng chấm công'); };
  const selected = useMemo(() => data?.dates.find((date) => date.date === activeDate), [data, activeDate]);
  const manualColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'MANUAL') ?? [], [data]); const formulaColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'FORMULA') ?? [], [data]); const hiddenSections = useMemo(() => new Set(hiddenSectionCodes), [hiddenSectionCodes]);
  const calculationWarnings = useMemo(() => data ? data.staff.flatMap((person) => (data.calculationWarnings[String(person.id)] ?? []).map((message) => `${person.fullName}: ${message}`)) : [], [data]);
  const toggleSection = (code: string) => setHiddenSectionCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const pendingManualValues = (onlyUserId?: number) => Object.entries(manualDraftsRef.current).flatMap(([key, value]) => {
    const [userIdText, columnIdText] = key.split(':'); const draftUserId = Number(userIdText); const columnId = Number(columnIdText);
    return onlyUserId !== undefined && draftUserId !== onlyUserId ? [] : [{ userId: draftUserId, columnId, value }];
  });
  const enqueueManualSave = (userIdValue: number, values: Array<{ userId: number; columnId: number; value: string }>, quiet = true) => {
    if (!values.length) return;
    const previous = manualSaveQueues.current.get(userIdValue) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => saveManual.mutateAsync({ values, quiet, viewKey: manualViewKey })); const settled = task.catch(() => undefined);
    manualSaveQueues.current.set(userIdValue, settled); void settled.finally(() => { if (manualSaveQueues.current.get(userIdValue) === settled) manualSaveQueues.current.delete(userIdValue); });
  };
  const commitManualRow = (userIdValue: number) => {
    const timer = manualSaveTimers.current.get(userIdValue);
    if (timer) clearTimeout(timer);
    manualSaveTimers.current.delete(userIdValue);
    enqueueManualSave(userIdValue, pendingManualValues(userIdValue));
  };
  const scheduleManualSave = (userIdValue: number) => {
    const previous = manualSaveTimers.current.get(userIdValue);
    if (previous) clearTimeout(previous);
    manualSaveTimers.current.set(userIdValue, setTimeout(() => {
      manualSaveTimers.current.delete(userIdValue);
      commitManualRow(userIdValue);
    }, 650));
  };
  const changeManualValue = (key: string, value: string) => {
    updateManualDrafts((current) => ({ ...current, [key]: value }));
    scheduleManualSave(Number(key.split(':', 1)[0]));
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
      {canExport && <><Button variant="outline" size="sm" onClick={() => doExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span></Button><Button variant="outline" size="sm" onClick={() => doExport('docx')}><FileText className="h-4 w-4" /> <span className="hidden sm:inline">Word</span></Button><Button variant="outline" size="sm" onClick={() => doExport('pdf')}><Download className="h-4 w-4" /> PDF</Button></>}
      {canCatalog && <Link href="/cham-cong-truc/danh-muc"><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Khai báo bảng</span></Button></Link>}
      <Button variant="outline" size="sm" onClick={() => void refreshBoard()} disabled={departmentScope.isFetching || query.isFetching} title="Làm mới dữ liệu bảng chấm công"><RefreshCw className={`h-4 w-4 ${(departmentScope.isFetching || query.isFetching) ? 'animate-spin' : ''}`} /><span className="hidden sm:inline"> Làm mới</span></Button><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline"> In</span></Button>
    </div>} />

    <Card className="mb-4 border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white shadow-sm"><CardBody className="space-y-3 py-3.5"><div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><Users className="h-4 w-4 text-sky-700" /> {data.staff.length} nhân viên</span><span><b className="text-violet-700">Tự nhập</b> = tự lưu sau khi ngừng gõ hoặc rời dòng. Ràng buộc chưa đúng sẽ báo đỏ nhưng không cản nhập. <b className="text-indigo-700">Công thức</b> = hệ thống tự tính</span><span className="text-slate-500">Đang khóa {LOCK_POLICY_LABEL[data.lockPolicy]}; số liệu tự nhập khóa khi tháng/kỳ năm đã qua.</span></div><div className="border-t border-sky-100 pt-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="h-2 w-2 rounded-full bg-sky-600" /> Ký hiệu và giá trị đếm đang khai báo</div><div className="flex flex-wrap gap-2">{data.codes.map((code) => <span key={code.id} title={code.note || code.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: code.color }} /><b className="font-mono text-slate-900">{code.code}</b><span className="text-slate-600">{code.name} = {code.countValue} · {calculationRoleLabel(code)}{code.deductsWorkday ? ' · trừ công' : ''}</span></span>)}</div></div></CardBody></Card>

    {calculationWarnings.length ? <Card className="mb-4 border-amber-300 bg-amber-50 shadow-sm"><CardBody className="py-3"><p className="font-semibold text-amber-950">Cần kiểm tra nghỉ bù ({calculationWarnings.length})</p><p className="mt-0.5 text-xs text-amber-900">Các ô này chưa được tổng hợp nghỉ bù vì không tìm thấy ca Trực/Tăng cường phù hợp trong {data.restPairLookbackDays} ngày trước đó.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{calculationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></CardBody></Card> : null}

    <Card className="mb-4 hidden border-slate-200 bg-white shadow-sm md:block print:hidden"><CardBody className="flex flex-wrap items-center gap-2 py-2.5"><span className="mr-1 text-sm font-semibold text-slate-700">Hiển thị phần:</span>{data.sections.map((section) => { const pinned = section.kind === 'ADMIN'; const visible = pinned || !hiddenSections.has(section.code); return <button key={section.id} type="button" disabled={pinned} onClick={() => toggleSection(section.code)} title={pinned ? 'Thông tin hành chính luôn được cố định để nhận biết nhân viên khi cuộn ngang' : visible ? `Ẩn phần ${section.name}` : `Hiện phần ${section.name}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${visible ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-slate-200 bg-white text-slate-400 line-through'} ${pinned ? 'cursor-default' : 'hover:border-sky-400 hover:bg-sky-50'}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: section.color }} />{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{section.name}{pinned ? ' · cố định' : ''}</button>; })}</CardBody></Card>
    <div className="space-y-3 md:hidden"><div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{data.dates.map((date) => <button key={date.date} onClick={() => setMobileDate(date.date)} className={`min-w-13 snap-start rounded-xl border px-2 py-2 text-center text-xs shadow-sm ${activeDate === date.date ? 'border-sky-600 bg-sky-600 text-white' : date.holidayName ? 'border-amber-300 bg-amber-50 text-amber-900' : date.isWorkingOverride ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : date.isWeekend ? 'border-rose-300 bg-rose-50 text-rose-800' : 'bg-white'} ${date.isLocked ? 'opacity-70' : ''}`}><b className="block text-base leading-4">{date.day}</b><span>{date.weekday}</span></button>)}</div>
      {selected ? <Card className={selected.holidayName ? 'border-amber-300' : selected.isWorkingOverride ? 'border-emerald-300' : selected.isWeekend ? 'border-rose-300' : ''}><CardBody className="py-3"><p className="font-semibold">Ngày {selected.day} · {selected.weekday} {selected.holidayName ? `— ${selected.holidayName}` : selected.workdayName ? `— ${selected.workdayName} (làm việc)` : ''}</p><p className="mt-0.5 text-xs text-slate-500">{selected.isLocked ? 'Ngày này đã được khóa theo chế độ cấu hình.' : 'Chọn ký hiệu cho từng nhân viên bên dưới.'}</p></CardBody></Card> : null}
      <div className="space-y-2">{data.staff.map((person) => <div key={person.id} onBlur={(event) => { if (leavesContainer(event.currentTarget, event.relatedTarget)) commitManualRow(person.id); }}><Card><CardBody className="space-y-3 py-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.stt}. {person.fullName}</p><p className="truncate text-xs text-slate-500">{person.title || 'Chưa khai báo chức danh'} · MANV: {person.username}</p></div>{selected ? <CodeSelect data={data} person={person} date={selected} value={data.entries[cellKey(person.id, selected.date)]?.code ?? ''} disabled={!canUpdate || save.isPending || selected.isLocked} onSave={(code) => save.mutate({ userId: person.id, workDate: selected.date, code })} /> : null}</div>
        {(formulaColumns.length || manualColumns.length) ? <div className="grid grid-cols-2 gap-2 border-t pt-2">{formulaColumns.map((column) => <div key={column.id} className="rounded-lg bg-indigo-50 p-2"><p className="text-[11px] font-medium text-indigo-700">{column.name}</p><p className="font-semibold text-indigo-950">{numberLabel(data.rowValues[String(person.id)]?.[column.key] ?? 0)}</p></div>)}{manualColumns.map((column) => { const key = manualCellKey(person.id, column.id); return <label key={column.id} className="grid gap-1 text-[11px] font-medium text-violet-700">{column.name}<ManualInput person={person} column={column} data={data} value={manualDrafts[key] ?? data.manualValues[key] ?? ''} violation={data.manualViolations[key] ?? []} disabled={!canUpdate} onChange={(value) => changeManualValue(key, value)} /></label>; })}</div> : null}
      </CardBody></Card></div>)}</div>
    </div>

    <DesktopAttendanceGrid data={data} canUpdate={canUpdate} saving={save.isPending} manualDrafts={manualDrafts} manualViolations={data.manualViolations} hiddenSections={hiddenSections} onCodeSave={save.mutate} onManualChange={changeManualValue} onManualRowCommit={commitManualRow} />
    {(save.isPending || saveManual.isPending) ? <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu…</div> : null}
  </>;
}
