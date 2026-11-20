"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileText, FileSpreadsheet, Loader2, LockKeyhole, Maximize2, MessageSquare, Minimize2, Printer, RefreshCw, Settings2, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/api';
import { attendanceKeys, dutyAttendanceApi, type AttendanceColumn, type AttendanceDate, type AttendanceMonth, type AttendanceSection, type AttendanceStaff } from '@/lib/duty-attendance';

const bangkokMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
};
const currentMonth = () => bangkokMonth();
const previousMonth = (month: string, delta: number) => { const [year, value] = month.split('-').map(Number); const date = new Date(year, value - 1 + delta, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
const cellKey = (staffKey: string, date: string) => `${staffKey}:${date}`;
/** Phòng thủ khi bảng vừa được tải từ máy chủ chưa nâng cấp: suy ra mảng từ chuỗi cũ. */
const entryCodes = (entry?: { code: string; codes?: string[] }) => entry?.codes ?? (entry?.code ? entry.code.split(',').map((code) => code.trim()).filter(Boolean) : []);
const manualCellKey = (staffKey: string, columnId: number) => `${staffKey}:${columnId}`;
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

/** Danh sách checkbox luôn hiển thị trong hộp xuất để không bị che/cắt như menu thả xuống. */
function MultiDepartmentPicker({ items, value, onChange }: { items: Array<{ id: number; name: string; code: string; shortName: string }>; value: number[]; onChange: (ids: number[]) => void }) {
  const selected = new Set(value); const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const toggle = (id: number) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id].sort((a, b) => a - b));
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2"><p className="text-sm font-semibold text-slate-800">Khoa/phòng xuất tệp <span className="font-normal text-slate-500">({value.length}/{items.length} đã chọn)</span></p><button type="button" onClick={() => onChange(allSelected ? [] : items.map((item) => item.id))} className="rounded-md border border-sky-200 bg-white px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-50">{allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button></div><div role="group" aria-label="Chọn khoa/phòng để xuất" className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto p-2 sm:grid-cols-2">{items.map((department) => <label key={department.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${selected.has(department.id) ? 'border-sky-300 bg-sky-50 text-sky-950' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}><input type="checkbox" checked={selected.has(department.id)} onChange={() => toggle(department.id)} className="size-4 accent-sky-600" /><span className="min-w-0 flex-1">{department.shortName || department.name}{department.code ? <span className="ml-1 text-xs text-slate-500">({department.code})</span> : null}</span></label>)}</div></div>;
}

/** Bảng chỉ luôn làm việc với một khoa để tránh sửa nhầm dữ liệu giữa các khoa. */
function DepartmentPicker({ items, value, onChange }: { items: Array<{ id: number; name: string; code: string; shortName: string }>; value?: number; onChange: (id: number) => void }) {
  return <label className="flex h-9 min-w-52 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium shadow-sm"><span className="sr-only">Khoa/phòng đang chấm công</span><select aria-label="Khoa/phòng đang chấm công" value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent outline-none">{items.map((department) => <option key={department.id} value={department.id}>{department.shortName || department.name}{department.code ? ` (${department.code})` : ''}</option>)}</select></label>;
}

/** Nút chọn nhiều ký hiệu: danh sách tick mở trong Dialog nên không bị cắt bởi vùng cuộn của bảng. */
function CodeMultiSelect({ data, person, date, value, disabled, saving, onSave }: { data: AttendanceMonth; person: AttendanceStaff; date: AttendanceDate; value: string[]; disabled: boolean; saving: boolean; onSave: (codes: string[]) => void }) {
  const normalizedValue = [...new Set(value)];
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState<string[]>(normalizedValue);
  const activeCodes = data.codes.map((code) => code.code); const activeCodeSet = new Set(activeCodes);
  const retiredCodes = normalizedValue.filter((code) => !activeCodeSet.has(code));
  useEffect(() => { if (!open) setDraft(normalizedValue); }, [open, value.join('\u0001')]);
  const tone = date.holidayName ? 'border-amber-200 bg-amber-50 text-amber-900' : date.isWorkingOverride ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : date.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white';
  const display = normalizedValue.length ? normalizedValue.join('+') : '—';
  const close = () => { if (!saving) { setDraft(normalizedValue); setOpen(false); } };
  const toggle = (code: string) => setDraft((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const save = () => { onSave(draft); setOpen(false); };
  return <>
    <button type="button" aria-label={`Chọn ký hiệu chấm công ${person.fullName}, ngày ${date.day}`} aria-haspopup="dialog" aria-expanded={open} title={date.isLocked ? 'Ngày này đã được khóa theo chế độ khóa bảng chấm công' : normalizedValue.length ? `Đã chọn: ${normalizedValue.join(', ')}` : 'Chưa nhập ký hiệu — bấm để chọn'} disabled={disabled} onClick={() => { setDraft(normalizedValue); setOpen(true); }} className={`h-9 w-14 max-w-14 rounded-lg border px-1 text-center text-xs font-bold shadow-sm outline-none transition hover:border-sky-400 hover:bg-sky-50 focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-70 ${tone} ${date.isLocked ? 'saturate-50' : ''}`}><span className="block truncate">{display}</span></button>
    <Dialog open={open} onClose={close} size="sm" title="Chọn ký hiệu chấm công" description={`${person.fullName} · ngày ${date.day}. Có thể tick đồng thời nhiều ký hiệu.`} footer={<><Button type="button" variant="outline" disabled={saving || !draft.length} onClick={() => setDraft([])}>Bỏ tất cả</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>Hủy</Button><Button type="button" disabled={saving} loading={saving} onClick={save}>Lưu ký hiệu</Button></>}>
      <div className="space-y-3"><p className="text-sm text-slate-600">Mỗi ký hiệu được tính riêng theo cấu hình nghiệp vụ. Bỏ tick rồi lưu để xóa ký hiệu khỏi ngày này.</p><div role="group" aria-label={`Ký hiệu ngày ${date.day} của ${person.fullName}`} className="grid gap-1">{data.codes.map((code) => <label key={code.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${draft.includes(code.code) ? 'border-sky-300 bg-sky-50 text-sky-950' : 'border-slate-200 hover:border-sky-200 hover:bg-slate-50'}`}><input type="checkbox" checked={draft.includes(code.code)} disabled={saving} onChange={() => toggle(code.code)} className="size-4 accent-sky-600" /><span className="min-w-9 rounded bg-white px-1.5 py-0.5 text-center font-mono font-bold shadow-sm" style={{ color: code.color }}>{code.code}</span><span className="min-w-0 flex-1">{code.name}</span></label>)}</div>{retiredCodes.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-semibold">Ký hiệu lịch sử đã ngừng dùng: {retiredCodes.join(', ')}</p><p className="mt-1">Ký hiệu này không thể chọn thêm. Bấm nút bên dưới nếu cần bỏ khỏi ngày này.</p><div className="mt-2 flex flex-wrap gap-2">{retiredCodes.filter((code) => draft.includes(code)).map((code) => <button key={code} type="button" disabled={saving} onClick={() => toggle(code)} className="rounded border border-amber-300 bg-white px-2 py-1 font-semibold hover:bg-amber-100">Bỏ {code}</button>)}</div></div> : null}</div>
    </Dialog>
  </>;
}

type TableColumn = { key: string; name: string; kind: 'ADMIN' | 'DAY' | 'SYMBOL' | 'FORMULA' | 'MANUAL'; section: AttendanceSection; day?: AttendanceDate; column?: AttendanceColumn };
type ColumnGroup = { section: AttendanceSection; columns: TableColumn[] };
const NUMBER_WHILE_TYPING = /^\d*(?:[.,]\d*)?$/;

function tableGroups(data: AttendanceMonth, hiddenSections = new Set<string>()): ColumnGroup[] {
  return data.sections.filter((section) => !hiddenSections.has(section.code)).map((section) => {
    let columns: TableColumn[] = [];
    if (section.kind === 'ADMIN') columns = [{ key: 'STT', name: 'STT', kind: 'ADMIN', section }, { key: 'USERNAME', name: 'MANV', kind: 'ADMIN', section }, { key: 'FULL_NAME', name: 'Họ và tên', kind: 'ADMIN', section }, { key: 'TITLE', name: 'Chức vụ', kind: 'ADMIN', section }, ...(data.multiDepartment ? [{ key: 'DEPARTMENT', name: 'Khoa/Phòng', kind: 'ADMIN' as const, section }] : [])];
    if (section.kind === 'DAYS') columns = data.dates.map((day) => ({ key: `DAY:${day.date}`, name: String(day.day), kind: 'DAY', section, day }));
    if (section.kind === 'SYMBOLS') columns = data.codes.map((code) => ({ key: code.code.toUpperCase(), name: code.name, kind: 'SYMBOL', section }));
    if (section.kind === 'REPORT' || section.kind === 'CUSTOM') columns = data.columns.filter((column) => column.sectionId === section.id).map((column) => ({ key: column.key.toUpperCase(), name: column.name, kind: column.columnType, section, column }));
    return { section, columns };
  }).filter((group) => group.columns.length);
}

function adminValue(person: AttendanceStaff, key: string) { if (key === 'STT') return person.stt; if (key === 'FULL_NAME') return person.fullName; if (key === 'TITLE') return person.managementPosition || person.title; if (key === 'DEPARTMENT') return person.departmentName; return person.manv; }

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
  if (column.key === 'TITLE') return 'sticky left-[426px] z-50 w-[176px] min-w-[176px]';
  return 'sticky left-[602px] z-50 w-[184px] min-w-[184px]';
}

function DesktopAttendanceGrid({ data, canUpdate, saving, manualDrafts, manualViolations, hiddenSections, fullScreen, onCodeSave, onNoteEdit, onManualChange, onManualRowCommit }: { data: AttendanceMonth; canUpdate: boolean; saving: boolean; manualDrafts: Record<string, string>; manualViolations: Record<string, string[]>; hiddenSections: Set<string>; fullScreen: boolean; onCodeSave: (entry: { userId: number; departmentId: number; staffKey: string; workDate: string; codes?: string[]; note?: string }) => void; onNoteEdit: (entry: { userId: number; departmentId: number; staffKey: string; workDate: string; code?: string; note: string; fullName: string; day: number }) => void; onManualChange: (key: string, value: string) => void; onManualRowCommit: (staffKey: string) => void }) {
  const groups = useMemo(() => tableGroups(data, hiddenSections), [data, hiddenSections]); const columns = useMemo(() => groups.flatMap((group) => group.columns), [groups]);
  const dayTone = (day: AttendanceDate) => day.holidayName ? 'border-amber-200 bg-amber-50 text-amber-900' : day.isWorkingOverride ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : day.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700';
  return <Card className={`overflow-hidden border-slate-200 bg-white shadow-sm print:block ${fullScreen ? 'flex min-h-0 flex-1 flex-col' : 'hidden md:block'}`}>
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3 print:hidden"><div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs"><div className="flex flex-wrap items-center gap-3 text-slate-600"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-700" /> Các phần bảng được khai báo riêng</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Thứ Bảy, Chủ nhật</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Lễ / ngày nghỉ</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ngày làm bù / hoán đổi</span><span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" /> Ô đã khóa theo cấu hình</span></div><span className="text-slate-500">Thông tin hành chính luôn được cố định bên trái; kéo ngang để xem các phần khác.</span></div></div>
    <div className={`min-h-[24rem] overflow-auto bg-slate-50/40 [-webkit-overflow-scrolling:touch] print:max-h-none print:overflow-visible ${fullScreen ? 'min-h-0 flex-1 max-h-none' : 'max-h-[calc(100vh-18rem)]'}`}>
      <table className="min-w-max table-auto border-separate border-spacing-0 text-[13px]">
        <colgroup>{columns.map((column) => <col key={column.key + column.section.id} style={{ width: column.key === 'FULL_NAME' ? 240 : column.key === 'TITLE' ? 176 : column.key === 'DEPARTMENT' ? 184 : column.key === 'USERNAME' ? 130 : column.kind === 'ADMIN' ? 56 : column.kind === 'DAY' ? 56 : column.kind === 'MANUAL' && column.column?.dataType === 'TEXT' ? undefined : 104 }} />)}</colgroup>
        <thead>
          <tr className="h-10 text-xs uppercase tracking-wide">{groups.map((group) => <th key={group.section.id} colSpan={group.columns.length} className={`sticky top-0 z-20 border-b border-r border-white/40 px-3 text-center font-bold ${group.section.kind === 'ADMIN' ? `left-0 z-[60] ${data.multiDepartment ? 'min-w-[786px]' : 'min-w-[602px]'}` : ''}`} style={{ backgroundColor: group.section.color, color: foreground(group.section.color) }}>{group.section.name}</th>)}</tr>
          <tr className="h-10 text-xs">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-10 z-20 border-b border-r px-2 text-center font-bold ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-100 text-slate-700'}`} title={column.kind === 'FORMULA' ? column.column?.formula : column.kind === 'MANUAL' ? column.column?.placeholder : undefined}>{column.kind === 'SYMBOL' ? <span className="block truncate" title={column.name}>{column.key}</span> : column.name}</th>)}</tr>
          <tr className="h-7 text-[11px]">{columns.map((column) => <th key={column.key + column.section.id} className={`sticky top-20 z-20 border-b border-r px-1 text-center ${pinnedAdminClass(column)} ${column.kind === 'DAY' ? dayTone(column.day!) : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{column.kind === 'DAY' ? column.day!.weekday : column.kind === 'SYMBOL' ? data.codes.find((code) => code.code.toUpperCase() === column.key)?.name : column.kind === 'FORMULA' ? 'Công thức' : column.kind === 'MANUAL' ? 'Tự nhập' : ''}</th>)}</tr>
        </thead>
        <tbody>{data.staff.map((person, index) => <tr key={person.key} onBlur={(event) => { if (leavesContainer(event.currentTarget, event.relatedTarget)) onManualRowCommit(person.key); }} className={`group hover:bg-sky-50/70 ${index % 2 ? 'bg-slate-50' : 'bg-white'}`}>{columns.map((column) => {
          if (column.kind === 'ADMIN') return <td key={column.key + column.section.id} className={`border-b border-r border-slate-200 px-3 py-2 ${pinnedAdminClass(column)} ${index % 2 ? 'bg-slate-50' : 'bg-white'} ${column.key === 'FULL_NAME' ? 'font-semibold' : 'text-center'} ${column.key === 'USERNAME' ? 'font-mono text-xs text-slate-600' : ''}`}>{adminValue(person, column.key)}</td>;
          if (column.kind === 'DAY') { const day = column.day!; const entry = data.entries[cellKey(person.key, day.date)]; return <td key={column.key} className={`border-b border-r px-1 py-1 text-center ${dayTone(day)}`}><div className="flex items-center justify-center gap-0.5"><CodeMultiSelect data={data} person={person} date={day} value={entryCodes(entry)} disabled={!canUpdate || saving || day.isLocked} saving={saving} onSave={(codes) => onCodeSave({ userId: person.id, departmentId: person.departmentId, staffKey: person.key, workDate: day.date, codes })} /><button type="button" aria-label={`Ghi chú ngày ${person.fullName}, ngày ${day.day}`} title={entry?.note ? 'Sửa ghi chú ngày' : 'Thêm ghi chú ngày'} disabled={!canUpdate || saving || day.isLocked} onClick={() => onNoteEdit({ userId: person.id, departmentId: person.departmentId, staffKey: person.key, workDate: day.date, code: entry?.code || undefined, note: entry?.note ?? '', fullName: person.fullName, day: day.day })} className={`relative rounded-md p-1 text-slate-500 transition hover:bg-sky-100 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-35 ${entry?.note ? 'text-sky-700' : ''}`}><MessageSquare className="h-3.5 w-3.5" />{entry?.note ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-sky-600" /> : null}</button></div></td>; }
          if (column.kind === 'MANUAL') { const key = manualCellKey(person.key, column.column!.id); const value = manualDrafts[key] ?? data.manualValues[key] ?? ''; const violation = manualViolations[key] ?? []; return <td key={column.key} className={`border-b border-r px-1.5 py-1 text-center ${violation.length ? 'border-rose-300 bg-rose-50' : 'border-violet-100 bg-violet-50/20'}`}><ManualInput person={person} column={column.column!} data={data} value={value} violation={violation} disabled={!canUpdate} onChange={(value) => onManualChange(key, value)} /></td>; }
          const value = data.rowValues[person.key]?.[column.key]; return <td key={column.key} className={`border-b border-r px-2 py-2 text-center font-medium ${column.kind === 'FORMULA' ? 'border-indigo-100 bg-indigo-50/30 text-indigo-900' : 'border-emerald-100 bg-emerald-50/35 text-emerald-900'}`}>{typeof value === 'number' && value === 0 ? '' : value === undefined ? '' : numberLabel(value)}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </Card>;
}

export default function ChamCongTrucPage() {
  const can = useAuth((state) => state.can); const currentUser = useAuth((state) => state.user); const client = useQueryClient();
  const [month, setMonth] = useState(currentMonth); const [selectedDepartmentId, setSelectedDepartmentId] = useState<number>(); const [selectedDepartmentUserId, setSelectedDepartmentUserId] = useState<number>(); const [exportDepartmentIds, setExportDepartmentIds] = useState<number[]>([]); const [exportFormat, setExportFormat] = useState<'xlsx' | 'docx' | 'pdf'>(); const [includeDailyNotes, setIncludeDailyNotes] = useState(false); const [isBoardFullScreen, setIsBoardFullScreen] = useState(false); const [mobileDate, setMobileDate] = useState(''); const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  // Bảng tổng hợp tự động rộng, chỉ mở khi người dùng bấm rõ ràng tại “Hiển thị phần”.
  const [hiddenSectionCodes, setHiddenSectionCodes] = useState<string[]>(['REPORT']); const [noteEditor, setNoteEditor] = useState<{ userId: number; departmentId: number; staffKey: string; workDate: string; code?: string; note: string; fullName: string; day: number }>();
  const boardFullScreenRef = useRef<HTMLDivElement>(null); const manualDraftsRef = useRef<Record<string, string>>({}); const manualSaveQueues = useRef(new Map<string, Promise<unknown>>()); const manualSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()); const manualViewKeyRef = useRef('');
  const updateManualDrafts = (updater: (current: Record<string, string>) => Record<string, string>) => setManualDrafts((current) => { const next = updater(current); manualDraftsRef.current = next; return next; });
  const replaceManualDrafts = (next: Record<string, string>) => { manualDraftsRef.current = next; setManualDrafts(next); };
  const canView = can('duty-attendance.view'); const canUpdate = can('duty-attendance.update'); const canExport = can('duty-attendance.export'); const canCatalog = can('duty-attendance.catalog.manage'); const userId = currentUser?.id;
  const departmentScope = useQuery({ queryKey: attendanceKeys.departments(userId), queryFn: dutyAttendanceApi.departments, enabled: canView && !!userId, refetchOnMount: 'always' });
  useEffect(() => { const syncFullScreen = () => setIsBoardFullScreen(document.fullscreenElement === boardFullScreenRef.current); document.addEventListener('fullscreenchange', syncFullScreen); return () => document.removeEventListener('fullscreenchange', syncFullScreen); }, []);
  const toggleBoardFullScreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await boardFullScreenRef.current?.requestFullscreen(); } catch { toast.error('Trình duyệt không thể mở toàn màn hình. Hãy cho phép chế độ toàn màn hình rồi thử lại.'); } };
  useEffect(() => {
    setMobileDate(''); replaceManualDrafts({}); manualSaveQueues.current.clear(); manualSaveTimers.current.forEach((timer) => clearTimeout(timer)); manualSaveTimers.current.clear();
  }, [userId, month, selectedDepartmentId]);
  useEffect(() => {
    if (!userId || !departmentScope.data?.items.length || selectedDepartmentUserId === userId && selectedDepartmentId) return;
    setSelectedDepartmentUserId(userId); setSelectedDepartmentId(departmentScope.data.items[0].id);
  }, [departmentScope.data, selectedDepartmentId, selectedDepartmentUserId, userId]);
  // Khi xem/nhập, Điều phối cũng chỉ được làm việc với một khoa tại một thời điểm.
  const departmentIds = selectedDepartmentUserId === userId && selectedDepartmentId ? [selectedDepartmentId] : [];
  const scopeKey = departmentIds.join(',');
  const manualViewKey = `${userId ?? 0}:${month}:${scopeKey}`; manualViewKeyRef.current = manualViewKey;
  const queryKey = attendanceKeys.month(userId, month, departmentIds);
  const query = useQuery({ queryKey, queryFn: () => dutyAttendanceApi.month(month, departmentIds), enabled: canView && !!userId && departmentIds.length > 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const data = query.data; const activeDate = mobileDate && data?.dates.some((date) => date.date === mobileDate) ? mobileDate : data?.dates.find((date) => date.date === data.today)?.date ?? data?.dates[0]?.date ?? '';
  const save = useMutation({
    mutationFn: (entry: { userId: number; departmentId: number; staffKey: string; workDate: string; codes?: string[]; note?: string }) => dutyAttendanceApi.save([{ userId: entry.userId, workDate: entry.workDate, ...(entry.codes !== undefined ? { codes: entry.codes } : {}), ...(entry.note !== undefined ? { note: entry.note } : {}) }], entry.departmentId),
    onMutate: async (entry) => { await client.cancelQueries({ queryKey }); const before = client.getQueryData<AttendanceMonth>(queryKey); const key = cellKey(entry.staffKey, entry.workDate); const previous = before?.entries[key]; if (before) { const codes = entry.codes === undefined ? entryCodes(previous) : entry.codes; const code = codes.join(', '); const note = entry.note === undefined ? previous?.note ?? '' : entry.note; const entries = { ...before.entries }; if (codes.length || note) entries[key] = { code, codes, note }; else delete entries[key]; client.setQueryData<AttendanceMonth>(queryKey, { ...before, entries }); } return { before }; },
    onError: (error: Error, _entry, context) => { if (context?.before) client.setQueryData(queryKey, context.before); toast.error(error.message || 'Không lưu được ô chấm công'); },
    onSuccess: () => { void client.invalidateQueries({ queryKey }); },
  });
  type ManualSaveRequest = { departmentId: number; staffKey: string; values: Array<{ userId: number; columnId: number; value: string }>; quiet?: boolean; viewKey: string };
  const saveManual = useMutation({
    mutationFn: ({ values, departmentId }: ManualSaveRequest) => dutyAttendanceApi.saveManualValues(month, values, departmentId),
    onSuccess: (_result, request) => {
      if (request.viewKey !== manualViewKeyRef.current) return;
      client.setQueryData<AttendanceMonth>(queryKey, (current) => {
        if (!current) return current; const manualValues = { ...current.manualValues };
        for (const item of request.values) { const key = manualCellKey(request.staffKey, item.columnId); if (item.value) manualValues[key] = item.value; else delete manualValues[key]; }
        return { ...current, manualValues };
      });
      updateManualDrafts((current) => { const next = { ...current }; for (const item of request.values) { const key = manualCellKey(request.staffKey, item.columnId); if (next[key] === item.value) delete next[key]; } return next; });
      if (!request.quiet) toast.success('Đã lưu số liệu tự nhập');
      void client.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => { toast.error(error.message || 'Không lưu được số liệu tự nhập; các ô vừa sửa vẫn được giữ để bạn chỉnh lại.'); },
  });
  const doExport = async (format: 'xlsx' | 'docx' | 'pdf', ids = departmentIds, withDailyNotes = false) => { if (!ids.length) { toast.error('Hãy chọn ít nhất một khoa/phòng để xuất'); return; } try { await downloadFile(dutyAttendanceApi.exportPath(format, month, ids, withDailyNotes), `BANG_CHAM_CONG_${month}.${format}`); } catch (error) { toast.error(error instanceof Error ? error.message : 'Không thể xuất tệp'); } };
  const openExport = (format: 'xlsx' | 'docx' | 'pdf') => { setExportFormat(format); setIncludeDailyNotes(false); setExportDepartmentIds((current) => current.length ? current : departmentIds); };
  const confirmExport = () => { if (!exportFormat) return; void doExport(exportFormat, exportDepartmentIds, exportFormat === 'xlsx' && includeDailyNotes); setExportFormat(undefined); };
  const refreshBoard = async () => { await Promise.all([departmentScope.refetch(), query.refetch()]); toast.success('Đã làm mới bảng chấm công'); };
  const selected = useMemo(() => data?.dates.find((date) => date.date === activeDate), [data, activeDate]);
  const manualColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'MANUAL') ?? [], [data]); const formulaColumns = useMemo(() => data?.columns.filter((column) => column.columnType === 'FORMULA') ?? [], [data]); const hiddenSections = useMemo(() => new Set(hiddenSectionCodes), [hiddenSectionCodes]);
  const calculationWarnings = useMemo(() => data ? data.staff.flatMap((person) => (data.calculationWarnings[person.key] ?? []).map((message) => `${person.fullName}: ${message}`)) : [], [data]);
  const toggleSection = (code: string) => setHiddenSectionCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const pendingManualValues = (staffKey: string) => {
    const person = data?.staff.find((item) => item.key === staffKey); if (!person) return [];
    const prefix = `${staffKey}:`;
    return Object.entries(manualDraftsRef.current).flatMap(([key, value]) => key.startsWith(prefix) ? [{ userId: person.id, columnId: Number(key.slice(prefix.length)), value }] : []);
  };
  const enqueueManualSave = (staffKey: string, values: Array<{ userId: number; columnId: number; value: string }>, quiet = true) => {
    const person = data?.staff.find((item) => item.key === staffKey); if (!values.length || !person) return;
    const previous = manualSaveQueues.current.get(staffKey) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => saveManual.mutateAsync({ departmentId: person.departmentId, staffKey, values, quiet, viewKey: manualViewKey })); const settled = task.catch(() => undefined);
    manualSaveQueues.current.set(staffKey, settled); void settled.finally(() => { if (manualSaveQueues.current.get(staffKey) === settled) manualSaveQueues.current.delete(staffKey); });
  };
  const commitManualRow = (staffKey: string) => { const timer = manualSaveTimers.current.get(staffKey); if (timer) clearTimeout(timer); manualSaveTimers.current.delete(staffKey); enqueueManualSave(staffKey, pendingManualValues(staffKey)); };
  const scheduleManualSave = (staffKey: string) => { const previous = manualSaveTimers.current.get(staffKey); if (previous) clearTimeout(previous); manualSaveTimers.current.set(staffKey, setTimeout(() => { manualSaveTimers.current.delete(staffKey); commitManualRow(staffKey); }, 650)); };
  const changeManualValue = (key: string, value: string) => { updateManualDrafts((current) => ({ ...current, [key]: value })); const parts = key.split(':'); scheduleManualSave(parts.length > 2 ? `${parts[0]}:${parts[1]}` : parts[0]!); };
  // Phải là hậu duệ của phần tử fullscreen: phần tử bên ngoài không thể phủ lên Fullscreen API dù z-index cao đến đâu.
  const noteDialog = <Dialog open={!!noteEditor} onClose={() => { if (!save.isPending) setNoteEditor(undefined); }} title="Ghi chú ngày chấm công" description={noteEditor ? `${noteEditor.fullName} · ngày ${noteEditor.day}${noteEditor.code ? ` · ký hiệu hiện có ${noteEditor.code}` : ''}` : undefined} footer={<><Button variant="outline" onClick={() => setNoteEditor(undefined)} disabled={save.isPending}>Hủy</Button><Button disabled={!noteEditor || save.isPending} loading={save.isPending} onClick={() => { if (!noteEditor) return; const { code: _currentCode, ...noteOnly } = noteEditor; save.mutate(noteOnly, { onSuccess: () => { setNoteEditor(undefined); toast.success('Đã lưu ghi chú ngày'); } }); }}><MessageSquare className="h-4 w-4" /> Lưu ghi chú</Button></>}><div className="space-y-2"><p className="text-sm text-slate-600">Ghi chú thuộc về ngày đang chọn, có thể nhập khi chưa có ký hiệu và vẫn được giữ khi thay đổi hoặc xóa ký hiệu.</p><Textarea aria-label="Nội dung ghi chú ngày chấm công" value={noteEditor?.note ?? ''} maxLength={300} rows={5} disabled={save.isPending} onChange={(event) => setNoteEditor((current) => current ? { ...current, note: event.target.value } : current)} placeholder="Nhập ghi chú theo ngày (tối đa 300 ký tự)" /><p className="text-right text-xs text-slate-500">{noteEditor?.note.length ?? 0}/300</p></div></Dialog>;

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem bảng chấm công" description="Vai trò Nhập chấm công trực khoa được cấp riêng cho Hành chính trưởng hoặc Chủ nhiệm khoa." />;
  if (departmentScope.isLoading || query.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[32rem] w-full" /></div>;
  if (departmentScope.isError) return <EmptyState title="Không tải được danh sách khoa/phòng" description={departmentScope.error instanceof Error ? departmentScope.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;
  if (!departmentIds.length) return <EmptyState title="Chưa có khoa/phòng để chấm công" description="Hãy tạo hoặc kích hoạt khoa/phòng, sau đó thử lại." />;
  if (query.isError || !data) return <EmptyState title="Không tải được bảng chấm công" description={query.error instanceof Error ? query.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;

  return <>
    <PageHeader title="Bảng chấm công trực và chấm công khác" description={`Nhập ký hiệu theo ngày cho ${data.department.name}; tổng ký hiệu, công thức và số liệu tự nhập được tách thành các phần độc lập.`} actions={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <div className="flex items-center rounded-lg border bg-white shadow-sm"><Button variant="ghost" size="sm" aria-label="Tháng trước" onClick={() => setMonth(previousMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><VietnameseMonthPicker value={month} onChange={setMonth} /><Button variant="ghost" size="sm" aria-label="Tháng sau" onClick={() => setMonth(previousMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
      {departmentScope.data?.canSelect && <DepartmentPicker items={departmentScope.data.items} value={selectedDepartmentId} onChange={(id) => { setSelectedDepartmentUserId(userId); setSelectedDepartmentId(id); }} />}
      {canExport && <><Button variant="outline" size="sm" onClick={() => openExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span></Button><Button variant="outline" size="sm" onClick={() => departmentScope.data?.canSelect ? openExport('docx') : void doExport('docx')}><FileText className="h-4 w-4" /> <span className="hidden sm:inline">Word</span></Button><Button variant="outline" size="sm" onClick={() => departmentScope.data?.canSelect ? openExport('pdf') : void doExport('pdf')}><Download className="h-4 w-4" /> PDF</Button></>}
      {canCatalog && <Link href="/cham-cong-truc/danh-muc"><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Khai báo bảng</span></Button></Link>}
      <Button variant="outline" size="sm" onClick={() => void refreshBoard()} disabled={departmentScope.isFetching || query.isFetching} title="Làm mới dữ liệu bảng chấm công"><RefreshCw className={`h-4 w-4 ${(departmentScope.isFetching || query.isFetching) ? 'animate-spin' : ''}`} /><span className="hidden sm:inline"> Làm mới</span></Button><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline"> In</span></Button>
    </div>} />

    <Card className="mb-4 border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white shadow-sm"><CardBody className="py-3.5"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Users className="h-4 w-4 text-sky-700" /> {data.staff.length} nhân viên</div><p className="mt-1 text-xs text-slate-600">Thứ tự: {data.staffOrderMode === 'MANAGEMENT_THEN_PROFESSIONAL' ? 'chức vụ kiêm nhiệm, rồi chức danh chuyên môn' : 'chức danh chuyên môn'}.</p><div className="mt-3 flex flex-wrap gap-2">{data.codes.map((code) => <span key={code.id} title={code.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm"><b className="font-mono text-slate-900">{code.code}</b><span className="text-slate-600">{code.name}</span></span>)}</div></CardBody></Card>

    {calculationWarnings.length ? <Card className="mb-4 border-amber-300 bg-amber-50 shadow-sm"><CardBody className="py-3"><p className="font-semibold text-amber-950">Cần kiểm tra nghỉ bù ({calculationWarnings.length})</p><p className="mt-0.5 text-xs text-amber-900">Các ô này chưa được tổng hợp nghỉ bù vì không tìm thấy ca Trực/Tăng cường phù hợp trong {data.restPairLookbackDays} ngày trước đó.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{calculationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></CardBody></Card> : null}

    <Card className="mb-4 hidden border-slate-200 bg-white shadow-sm md:block print:hidden"><CardBody className="flex flex-wrap items-center gap-2 py-2.5"><span className="mr-1 text-sm font-semibold text-slate-700">Hiển thị phần:</span>{data.sections.map((section) => { const pinned = section.kind === 'ADMIN'; const visible = pinned || !hiddenSections.has(section.code); return <button key={section.id} type="button" disabled={pinned} onClick={() => toggleSection(section.code)} title={pinned ? 'Thông tin hành chính luôn được cố định để nhận biết nhân viên khi cuộn ngang' : visible ? `Ẩn phần ${section.name}` : `Hiện phần ${section.name}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${visible ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-slate-200 bg-white text-slate-400 line-through'} ${pinned ? 'cursor-default' : 'hover:border-sky-400 hover:bg-sky-50'}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: section.color }} />{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{section.name}{pinned ? ' · cố định' : ''}</button>; })}<Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void toggleBoardFullScreen()} title="Mở toàn màn hình để nhập bảng dễ hơn">{isBoardFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{isBoardFullScreen ? 'Thu nhỏ' : 'Toàn màn hình'}</Button></CardBody></Card>
    <div className="space-y-3 md:hidden"><div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{data.dates.map((date) => <button key={date.date} onClick={() => setMobileDate(date.date)} className={`min-w-13 snap-start rounded-xl border px-2 py-2 text-center text-xs shadow-sm ${activeDate === date.date ? 'border-sky-600 bg-sky-600 text-white' : date.holidayName ? 'border-amber-300 bg-amber-50 text-amber-900' : date.isWorkingOverride ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : date.isWeekend ? 'border-rose-300 bg-rose-50 text-rose-800' : 'bg-white'} ${date.isLocked ? 'opacity-70' : ''}`}><b className="block text-base leading-4">{date.day}</b><span>{date.weekday}</span></button>)}</div>
      {selected ? <Card className={selected.holidayName ? 'border-amber-300' : selected.isWorkingOverride ? 'border-emerald-300' : selected.isWeekend ? 'border-rose-300' : ''}><CardBody className="py-3"><p className="font-semibold">Ngày {selected.day} · {selected.weekday} {selected.holidayName ? `— ${selected.holidayName}` : selected.workdayName ? `— ${selected.workdayName} (làm việc)` : ''}</p><p className="mt-0.5 text-xs text-slate-500">{selected.isLocked ? 'Ngày này đã được khóa theo chế độ cấu hình.' : 'Chọn ký hiệu cho từng nhân viên bên dưới.'}</p></CardBody></Card> : null}
      <div className="space-y-2">{data.staff.map((person) => <div key={person.key} onBlur={(event) => { if (leavesContainer(event.currentTarget, event.relatedTarget)) commitManualRow(person.key); }}><Card><CardBody className="space-y-3 py-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.stt}. {person.fullName}</p><p className="truncate text-xs text-slate-500">{person.managementPosition || person.title || 'Chưa khai báo chức vụ/chức danh'} · MANV: {person.manv} · @{person.username}{data.multiDepartment ? ` · ${person.departmentName}` : ''}</p></div>{selected ? (() => { const entry = data.entries[cellKey(person.key, selected.date)]; return <div className="flex items-center gap-1"><CodeMultiSelect data={data} person={person} date={selected} value={entryCodes(entry)} disabled={!canUpdate || save.isPending || selected.isLocked} saving={save.isPending} onSave={(codes) => save.mutate({ userId: person.id, departmentId: person.departmentId, staffKey: person.key, workDate: selected.date, codes })} /><button type="button" aria-label={`Ghi chú ngày ${person.fullName}, ngày ${selected.day}`} title={entry?.note ? 'Sửa ghi chú ngày' : 'Thêm ghi chú ngày'} disabled={!canUpdate || save.isPending || selected.isLocked} onClick={() => setNoteEditor({ userId: person.id, departmentId: person.departmentId, staffKey: person.key, workDate: selected.date, code: entry?.code || undefined, note: entry?.note ?? '', fullName: person.fullName, day: selected.day })} className={`relative rounded-md p-1.5 text-slate-500 hover:bg-sky-100 hover:text-sky-800 disabled:opacity-35 ${entry?.note ? 'text-sky-700' : ''}`}><MessageSquare className="h-4 w-4" />{entry?.note ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-600" /> : null}</button></div>; })() : null}</div>
        {(formulaColumns.length || manualColumns.length) ? <div className="grid grid-cols-2 gap-2 border-t pt-2">{formulaColumns.map((column) => <div key={column.id} className="rounded-lg bg-indigo-50 p-2"><p className="text-[11px] font-medium text-indigo-700">{column.name}</p><p className="font-semibold text-indigo-950">{numberLabel(data.rowValues[person.key]?.[column.key] ?? 0)}</p></div>)}{manualColumns.map((column) => { const key = manualCellKey(person.key, column.id); return <label key={column.id} className="grid gap-1 text-[11px] font-medium text-violet-700">{column.name}<ManualInput person={person} column={column} data={data} value={manualDrafts[key] ?? data.manualValues[key] ?? ''} violation={data.manualViolations[key] ?? []} disabled={!canUpdate} onChange={(value) => changeManualValue(key, value)} /></label>; })}</div> : null}
      </CardBody></Card></div>)}</div>
    </div>

    <div ref={boardFullScreenRef} className={isBoardFullScreen ? 'flex h-screen flex-col bg-slate-100 p-3' : ''}>{isBoardFullScreen ? <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-700">Bảng chấm công toàn màn hình · {data.department.name}</p><Button type="button" variant="outline" size="sm" onClick={() => void toggleBoardFullScreen()}><Minimize2 className="h-4 w-4" /> Thoát toàn màn hình</Button></div> : null}<DesktopAttendanceGrid data={data} canUpdate={canUpdate} saving={save.isPending} manualDrafts={manualDrafts} manualViolations={data.manualViolations} hiddenSections={hiddenSections} fullScreen={isBoardFullScreen} onCodeSave={save.mutate} onNoteEdit={setNoteEditor} onManualChange={changeManualValue} onManualRowCommit={commitManualRow} />{isBoardFullScreen ? noteDialog : null}</div>
    {!isBoardFullScreen ? noteDialog : null}
    <Dialog open={!!exportFormat} onClose={() => setExportFormat(undefined)} size="lg" title={`Xuất ${exportFormat === 'xlsx' ? 'Excel' : exportFormat === 'docx' ? 'Word' : 'PDF'} nhiều khoa/phòng`} description="Bảng đang xem chỉ có một khoa. Danh sách checkbox bên dưới hiển thị đầy đủ các khoa/phòng được phép xuất." footer={<><Button variant="outline" onClick={() => setExportFormat(undefined)}>Hủy</Button><Button disabled={!exportDepartmentIds.length} onClick={confirmExport}><Download className="h-4 w-4" /> Xuất tệp</Button></>}><div className="space-y-3"><p className="text-sm text-slate-600">Chọn ít nhất một khoa/phòng. Các dòng xuất được gắn cột khoa/phòng để dễ đối chiếu.</p><MultiDepartmentPicker items={departmentScope.data?.items ?? []} value={exportDepartmentIds} onChange={setExportDepartmentIds} />{exportFormat === 'xlsx' ? <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-slate-800"><input type="checkbox" checked={includeDailyNotes} onChange={(event) => setIncludeDailyNotes(event.target.checked)} className="mt-0.5 size-4 accent-sky-600" /><span><b className="block">Kèm dòng ghi chú theo ngày</b><span className="text-xs text-slate-600">Thêm một dòng ngay dưới nhân viên có ghi chú; nội dung nằm đúng cột ngày và không phụ thuộc ký hiệu chấm công.</span></span></label> : null}</div></Dialog>

    {(save.isPending || saveManual.isPending) ? <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu…</div> : null}
  </>;
}
