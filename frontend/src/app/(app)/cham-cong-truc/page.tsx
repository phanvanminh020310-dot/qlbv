"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileText, FileSpreadsheet, Loader2, LockKeyhole, Printer, RefreshCw, Settings2, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, Skeleton } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/api';
import { attendanceKeys, dutyAttendanceApi, type AttendanceDate, type AttendanceMonth, type AttendanceStaff } from '@/lib/duty-attendance';

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date());
const previousMonth = (month: string, delta: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const cellKey = (userId: number, date: string) => `${userId}:${date}`;
const MONTH_LABELS_VI = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

/** Native month controls inherit the browser language. Use explicit Vietnamese controls instead. */
function VietnameseMonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const [year, month] = value.split('-').map(Number);
  const firstYear = Math.min(2000, year - 10);
  const lastYear = Math.max(2100, year + 10);
  const setMonth = (nextYear: number, nextMonth: number) => onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
  return (
    <div className="flex h-9 items-center border-x bg-transparent">
      <Select aria-label="Chọn tháng" value={String(month)} onChange={(event) => setMonth(year, Number(event.target.value))} className="h-9 w-32 rounded-none border-0 border-r bg-transparent px-2 font-semibold shadow-none focus-visible:ring-0">
        {MONTH_LABELS_VI.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
      </Select>
      <Select aria-label="Chọn năm" value={String(year)} onChange={(event) => setMonth(Number(event.target.value), month)} className="h-9 w-24 rounded-none border-0 bg-transparent px-2 font-semibold shadow-none focus-visible:ring-0">
        {Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((item) => <option key={item} value={item}>Năm {item}</option>)}
      </Select>
    </div>
  );
}

function CodeSelect({ data, person, date, value, disabled, onSave }: { data: AttendanceMonth; person: AttendanceStaff; date: AttendanceDate; value: string; disabled: boolean; onSave: (code: string) => void }) {
  const tone = date.isWeekend ? 'border-rose-200 bg-rose-50 text-rose-800' : date.isRest ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white';
  const tooltip = date.isPast ? 'Ngày đã qua được khóa, không thể sửa' : value ? `Ký hiệu: ${value}` : 'Chưa nhập ký hiệu';
  return <select aria-label={`Chấm công ${person.fullName}, ngày ${date.day}`} title={tooltip} value={value} disabled={disabled} onChange={(e) => onSave(e.target.value)} className={`h-9 min-w-12 rounded-lg border px-1 text-center text-sm font-bold shadow-sm outline-none transition focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-70 ${tone} ${date.isPast ? 'saturate-50' : ''}`}>
    <option value="" aria-label="Chưa nhập ký hiệu"></option>{data.codes.map((code) => <option value={code.code} key={code.id}>{code.code}</option>)}
  </select>;
}

function DesktopAttendanceGrid({
  data,
  canUpdate,
  saving,
  onSave,
}: {
  data: AttendanceMonth;
  canUpdate: boolean;
  saving: boolean;
  onSave: (entry: { userId: number; workDate: string; code: string }) => void;
}) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const syncWidth = () => setTableWidth(table.scrollWidth);
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(table);
    window.addEventListener('resize', syncWidth);
    return () => { observer.disconnect(); window.removeEventListener('resize', syncWidth); };
  }, [data]);

  const syncHorizontalScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (target && Math.abs(target.scrollLeft - source.scrollLeft) > 1) target.scrollLeft = source.scrollLeft;
  };
  const dayTone = (day: AttendanceDate) => day.isWeekend
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : day.isRest ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700';

  return <Card className="hidden overflow-hidden border-slate-200 bg-white shadow-sm md:block print:block">
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-700" /> Điều hướng ngày</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Thứ Bảy, Chủ nhật</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Lễ / ngày nghỉ</span>
          <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" /> Ngày đã qua khóa sửa</span>
        </div>
        <span className="text-slate-500">Kéo thanh ngang hoặc giữ Shift + lăn chuột để xem các ngày sau.</span>
      </div>
      <div
        ref={topScrollRef}
        aria-label="Thanh cuộn ngang các ngày chấm công"
        className="mt-2 h-5 overflow-x-scroll overflow-y-hidden rounded-full border border-slate-200 bg-slate-100"
        onScroll={(event) => syncHorizontalScroll(event.currentTarget, gridScrollRef.current)}
      >
        <div className="h-4" style={{ width: tableWidth }} />
      </div>
    </div>
    <div
      ref={gridScrollRef}
      className="min-h-[24rem] max-h-[calc(100vh-18rem)] overflow-x-scroll overflow-y-auto bg-slate-50/40 [-webkit-overflow-scrolling:touch] print:max-h-none print:overflow-visible"
      onScroll={(event) => syncHorizontalScroll(event.currentTarget, topScrollRef.current)}
      onWheel={(event) => {
        if (!event.shiftKey) return;
        event.preventDefault();
        event.currentTarget.scrollLeft += event.deltaY;
      }}
    >
      <table ref={tableRef} className="isolate min-w-max table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col style={{ width: 56 }} /><col style={{ width: 240 }} /><col style={{ width: 176 }} />
          {data.dates.map((day) => <col key={day.date} style={{ width: 56 }} />)}
          <col style={{ width: 60 }} /><col style={{ width: 60 }} />
          {data.summaryCodes.map((code) => <col key={code} style={{ width: 76 }} />)}
        </colgroup>
        <thead>
          <tr className="h-11 text-xs uppercase tracking-wide text-white">
            <th rowSpan={2} className="sticky left-0 top-0 z-50 w-[56px] min-w-[56px] border-b border-r border-slate-700 bg-slate-900 px-3 text-center">STT</th>
            <th rowSpan={2} className="sticky left-[56px] top-0 z-50 w-[240px] min-w-[240px] max-w-[240px] border-b border-r border-slate-700 bg-slate-900 px-4 text-left">Họ và tên</th>
            <th rowSpan={2} className="sticky left-[296px] top-0 z-50 w-[176px] min-w-[176px] max-w-[176px] border-b border-r border-slate-700 bg-slate-900 px-4 text-left">Chức danh</th>
            <th colSpan={data.dates.length} className="sticky top-0 z-30 border-b border-r border-slate-700 bg-slate-800 px-2 text-center">Ngày trong tháng</th>
            <th colSpan={2} className="sticky top-0 z-30 border-b border-r border-slate-700 bg-slate-800 px-2 text-center">Trực</th>
            {data.summaryColumns.map((column) => <th key={column.code} rowSpan={2} className="sticky top-0 z-30 border-b border-r border-slate-700 bg-slate-800 px-3 text-center">{column.name}</th>)}
          </tr>
          <tr className="h-12 text-xs">
            {data.dates.map((day) => <th title={day.holidayName || (day.isPast ? 'Ngày đã khóa sửa' : undefined)} key={day.date} className={`sticky top-11 z-30 min-w-14 border-b border-r px-1 text-center ${dayTone(day)} ${day.isPast ? 'opacity-80' : ''}`}><span className="flex items-center justify-center gap-1"><b className="text-sm">{day.day}</b>{day.isPast && <LockKeyhole className="h-3 w-3" />}</span><small className="block font-semibold">{day.weekday}</small></th>)}
            <th className="sticky top-11 z-30 border-b border-r border-slate-200 bg-slate-100 px-3 text-center font-bold text-slate-700">NN</th><th className="sticky top-11 z-30 border-b border-r border-slate-200 bg-slate-100 px-3 text-center font-bold text-slate-700">NT</th>
          </tr>
        </thead>
        <tbody>
          {data.staff.map((person, index) => {
            const rowTone = index % 2 ? 'bg-slate-50' : 'bg-white';
            return <tr key={person.id} className="group hover:bg-sky-50/70">
              <td className={`sticky left-0 z-20 w-[56px] min-w-[56px] border-b border-r border-slate-200 px-3 py-2 text-center font-medium text-slate-500 ${rowTone} group-hover:bg-sky-50`}>{person.stt}</td>
              <td title={person.fullName} className={`sticky left-[56px] z-20 w-[240px] min-w-[240px] max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-200 px-4 py-2 font-semibold text-slate-800 ${rowTone} group-hover:bg-sky-50`}>{person.fullName}</td>
              <td title={person.title || undefined} className={`sticky left-[296px] z-20 w-[176px] min-w-[176px] max-w-[176px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-200 px-4 py-2 text-slate-500 ${rowTone} group-hover:bg-sky-50`}>{person.title || ''}</td>
              {data.dates.map((day) => <td className={`border-b border-r border-slate-100 p-1 text-center ${day.isWeekend ? 'bg-rose-50/65' : day.isRest ? 'bg-amber-50/65' : ''} ${day.isPast ? 'bg-slate-100/80' : ''}`} key={day.date}><CodeSelect data={data} person={person} date={day} value={data.entries[cellKey(person.id, day.date)]?.code ?? ''} disabled={!canUpdate || saving || day.isPast} onSave={(code) => onSave({ userId: person.id, workDate: day.date, code })} /></td>)}
              <td className="border-b border-r border-slate-200 bg-amber-50/60 px-3 text-center font-bold text-amber-800">{person.totals.NN}</td><td className="border-b border-r border-slate-200 bg-sky-50/70 px-3 text-center font-bold text-sky-800">{person.totals.NT}</td>
              {data.summaryCodes.map((code) => <td className="border-b border-r border-slate-200 px-3 text-center font-medium text-slate-700" key={code}>{person.totals[code] || ''}</td>)}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </Card>;
}

export default function ChamCongTrucPage() {
  const currentUser = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const [month, setMonth] = useState(currentMonth);
  const [mobileDate, setMobileDate] = useState<string>('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | undefined>();
  const [selectedDepartmentUserId, setSelectedDepartmentUserId] = useState<number | undefined>();
  const client = useQueryClient();
  const canView = can('duty-attendance.view'); const canUpdate = can('duty-attendance.update'); const canExport = can('duty-attendance.export'); const canCatalog = can('duty-attendance.catalog.manage');
  const userId = currentUser?.id;
  const departmentScope = useQuery({ queryKey: attendanceKeys.departments(userId), queryFn: dutyAttendanceApi.departments, enabled: canView && !!userId, refetchOnMount: 'always' });
  useEffect(() => { setMobileDate(''); }, [userId]);
  useEffect(() => {
    if (!userId || !departmentScope.data?.items.length || (selectedDepartmentUserId === userId && selectedDepartmentId)) return;
    setSelectedDepartmentUserId(userId);
    setSelectedDepartmentId(departmentScope.data.items[0].id);
  }, [departmentScope.data, selectedDepartmentId, selectedDepartmentUserId, userId]);
  // Không dùng lại lựa chọn khoa từ phiên tài khoản trước trong lúc React Query đang tải dữ liệu mới.
  const departmentId = selectedDepartmentUserId === userId ? selectedDepartmentId : undefined;
  const query = useQuery({ queryKey: attendanceKeys.month(userId, month, departmentId), queryFn: () => dutyAttendanceApi.month(month, departmentId), enabled: canView && !!userId && !!departmentId, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const data = query.data;
  const activeDate = mobileDate && data?.dates.some((d) => d.date === mobileDate) ? mobileDate : data?.dates.find((d) => d.date === data.today)?.date ?? data?.dates[0]?.date ?? '';
  const save = useMutation({
    mutationFn: (entry: { userId: number; workDate: string; code: string }) => dutyAttendanceApi.save([{ ...entry, code: entry.code || null }], departmentId),
    onMutate: async (entry) => { await client.cancelQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); const before = client.getQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId)); if (before) client.setQueryData<AttendanceMonth>(attendanceKeys.month(userId, month, departmentId), { ...before, entries: { ...before.entries, [cellKey(entry.userId, entry.workDate)]: entry.code ? { code: entry.code, note: '' } : undefined as never } }); return { before }; },
    onError: (err: Error, _entry, context) => { if (context?.before) client.setQueryData(attendanceKeys.month(userId, month, departmentId), context.before); toast.error(err.message || 'Không lưu được ô chấm công'); },
    onSuccess: () => { void client.invalidateQueries({ queryKey: attendanceKeys.month(userId, month, departmentId) }); },
  });
  const doExport = async (format: 'xlsx' | 'docx' | 'pdf') => { try { await downloadFile(dutyAttendanceApi.exportPath(format, month, departmentId), `BANG_CHAM_CONG_${month}.${format}`); } catch (e) { toast.error(e instanceof Error ? e.message : 'Không thể xuất tệp'); } };
  const refreshBoard = async () => { await Promise.all([departmentScope.refetch(), query.refetch()]); toast.success('Đã làm mới bảng chấm công'); };
  const selected = useMemo(() => data?.dates.find((d) => d.date === activeDate), [data, activeDate]);

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem bảng chấm công" description="Vai trò Nhập chấm công trực khoa được cấp riêng cho Hành chính trưởng hoặc Chủ nhiệm khoa." />;
  if (departmentScope.isLoading || query.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[32rem] w-full" /></div>;
  if (departmentScope.isError) return <EmptyState title="Không tải được danh sách khoa/phòng" description={departmentScope.error instanceof Error ? departmentScope.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;
  if (!departmentId) return <EmptyState title="Chưa có khoa/phòng để chấm công" description="Hãy tạo hoặc kích hoạt khoa/phòng, sau đó thử lại." />;
  if (query.isError) return <EmptyState title="Không tải được bảng chấm công" description={query.error instanceof Error ? query.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;
  if (!data) return <EmptyState title="Không tải được bảng chấm công" description="Hãy thử lại hoặc liên hệ quản trị hệ thống." />;

  return <>
    <PageHeader title="Bảng chấm công trực và chấm công khác" description={`Nhập thủ công cho ${data.department.name}. T: trực; hệ thống tự tách NN (ngày nghỉ/lễ) và NT (ngày thường).`} actions={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <div className="flex items-center rounded-lg border bg-white shadow-sm"><Button variant="ghost" size="sm" aria-label="Tháng trước" onClick={() => setMonth(previousMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><VietnameseMonthPicker value={month} onChange={setMonth} /><Button variant="ghost" size="sm" aria-label="Tháng sau" onClick={() => setMonth(previousMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
      {departmentScope.data?.canSelect && <select aria-label="Chọn khoa/phòng" value={departmentId ?? ''} onChange={(e) => { setSelectedDepartmentUserId(userId); setSelectedDepartmentId(Number(e.target.value)); }} className="h-9 max-w-64 rounded-lg border bg-white px-3 text-sm font-medium shadow-sm"><option value="" disabled>Chọn khoa/phòng</option>{departmentScope.data.items.map((dept) => <option key={dept.id} value={dept.id}>{dept.shortName || dept.name}{dept.code ? ` (${dept.code})` : ''}</option>)}</select>}
      {canExport && <><Button variant="outline" size="sm" onClick={() => doExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span></Button><Button variant="outline" size="sm" onClick={() => doExport('docx')}><FileText className="h-4 w-4" /> <span className="hidden sm:inline">Word</span></Button><Button variant="outline" size="sm" onClick={() => doExport('pdf')}><Download className="h-4 w-4" /> PDF</Button></>}
      {canCatalog && <Link href="/cham-cong-truc/danh-muc"><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Ký hiệu & ngày nghỉ</span></Button></Link>}
      <Button variant="outline" size="sm" onClick={() => void refreshBoard()} disabled={departmentScope.isFetching || query.isFetching} title="Làm mới dữ liệu bảng chấm công"><RefreshCw className={`h-4 w-4 ${(departmentScope.isFetching || query.isFetching) ? 'animate-spin' : ''}`} /><span className="hidden sm:inline"> Làm mới</span></Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline"> In</span></Button>
    </div>} />

    <Card className="mb-4 border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white shadow-sm"><CardBody className="space-y-3 py-3.5"><div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><Users className="h-4 w-4 text-sky-700" /> {data.staff.length} nhân viên</span><span><b className="text-amber-700">NN</b> = trực thứ Bảy, Chủ nhật hoặc ngày nghỉ/lễ</span><span><b className="text-sky-700">NT</b> = trực ngày thường</span><span className="text-slate-500">Ngày đã qua được khóa; các thay đổi hợp lệ được lưu ngay.</span></div><div className="border-t border-sky-100 pt-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="h-2 w-2 rounded-full bg-sky-600" /> Ký hiệu chấm công đang khai báo</div><div className="flex flex-wrap gap-2">{data.codes.map((code) => <span key={code.id} title={code.note || code.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: code.color }} /><b className="font-mono text-slate-900">{code.code}</b><span className="text-slate-600">{code.name}</span></span>)}</div></div></CardBody></Card>

    <div className="md:hidden space-y-3">
      <div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{data.dates.map((day) => <button key={day.date} onClick={() => setMobileDate(day.date)} className={`min-w-13 snap-start rounded-xl border px-2 py-2 text-center text-xs shadow-sm ${activeDate === day.date ? 'border-sky-600 bg-sky-600 text-white' : day.isWeekend ? 'border-rose-300 bg-rose-50 text-rose-800' : day.isRest ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-white'} ${day.isPast ? 'opacity-70' : ''}`}><b className="block text-base leading-4">{day.day}</b><span>{day.weekday}</span></button>)}</div>
      {selected && <Card className={selected.isWeekend ? 'border-rose-300' : selected.isRest ? 'border-amber-300' : ''}><CardBody className="py-3"><p className="font-semibold">Ngày {selected.day} · {selected.weekday} {selected.holidayName ? `— ${selected.holidayName}` : ''}</p><p className="mt-0.5 text-xs text-slate-500">{selected.isPast ? 'Ngày đã qua: chỉ xem, không được sửa.' : selected.isRest ? 'Ngày nghỉ: trực T sẽ cộng vào NN.' : 'Ngày thường: trực T sẽ cộng vào NT.'}</p></CardBody></Card>}
      <div className="space-y-2">{data.staff.map((person) => <Card key={person.id}><CardBody className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.stt}. {person.fullName}</p><p className="truncate text-xs text-slate-500">{person.title || 'Chưa khai báo chức danh'} · NN {person.totals.NN} · NT {person.totals.NT}</p></div>{selected && <CodeSelect data={data} person={person} date={selected} value={data.entries[cellKey(person.id, selected.date)]?.code ?? ''} disabled={!canUpdate || save.isPending || selected.isPast} onSave={(code) => save.mutate({ userId: person.id, workDate: selected.date, code })} />}</CardBody></Card>)}</div>
    </div>

    <DesktopAttendanceGrid data={data} canUpdate={canUpdate} saving={save.isPending} onSave={save.mutate} />
    {save.isPending && <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu…</div>}
  </>;
}
