"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, FileText, FileSpreadsheet, Loader2, Printer, Settings2, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/api';
import { attendanceKeys, dutyAttendanceApi, type AttendanceDate, type AttendanceMonth, type AttendanceStaff } from '@/lib/duty-attendance';

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date());
const previousMonth = (month: string, delta: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const cellKey = (userId: number, date: string) => `${userId}:${date}`;

function CodeSelect({ data, person, date, value, disabled, onSave }: { data: AttendanceMonth; person: AttendanceStaff; date: AttendanceDate; value: string; disabled: boolean; onSave: (code: string) => void }) {
  return <select aria-label={`Chấm công ${person.fullName}, ngày ${date.day}`} value={value} disabled={disabled} onChange={(e) => onSave(e.target.value)} className={`h-9 min-w-12 rounded-md border bg-white px-1 text-center text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-55 ${date.isRest ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
    <option value="">—</option>{data.codes.map((code) => <option value={code.code} key={code.id}>{code.code}</option>)}
  </select>;
}

export default function ChamCongTrucPage() {
  const can = useAuth((s) => s.can);
  const [month, setMonth] = useState(currentMonth);
  const [mobileDate, setMobileDate] = useState<string>('');
  const client = useQueryClient();
  const canView = can('duty-attendance.view'); const canUpdate = can('duty-attendance.update'); const canExport = can('duty-attendance.export'); const canCatalog = can('duty-attendance.catalog.manage');
  const query = useQuery({ queryKey: attendanceKeys.month(month), queryFn: () => dutyAttendanceApi.month(month), enabled: canView });
  const data = query.data;
  const activeDate = mobileDate && data?.dates.some((d) => d.date === mobileDate) ? mobileDate : data?.dates[0]?.date ?? '';
  const save = useMutation({
    mutationFn: (entry: { userId: number; workDate: string; code: string }) => dutyAttendanceApi.save([{ ...entry, code: entry.code || null }]),
    onMutate: async (entry) => { await client.cancelQueries({ queryKey: attendanceKeys.month(month) }); const before = client.getQueryData<AttendanceMonth>(attendanceKeys.month(month)); if (before) client.setQueryData<AttendanceMonth>(attendanceKeys.month(month), { ...before, entries: { ...before.entries, [cellKey(entry.userId, entry.workDate)]: entry.code ? { code: entry.code, note: '' } : undefined as never } }); return { before }; },
    onError: (err: Error, _entry, context) => { if (context?.before) client.setQueryData(attendanceKeys.month(month), context.before); toast.error(err.message || 'Không lưu được ô chấm công'); },
    onSuccess: () => { void client.invalidateQueries({ queryKey: attendanceKeys.month(month) }); },
  });
  const doExport = async (format: 'xlsx' | 'docx' | 'pdf') => { try { await downloadFile(dutyAttendanceApi.exportPath(format, month), `BANG_CHAM_CONG_${month}.${format}`); } catch (e) { toast.error(e instanceof Error ? e.message : 'Không thể xuất tệp'); } };
  const selected = useMemo(() => data?.dates.find((d) => d.date === activeDate), [data, activeDate]);

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem bảng chấm công" description="Vai trò Nhập chấm công trực khoa được cấp riêng cho Hành chính trưởng hoặc Chủ nhiệm khoa." />;
  if (query.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-[32rem] w-full" /></div>;
  if (!data) return <EmptyState title="Không tải được bảng chấm công" description="Hãy thử tải lại trang hoặc liên hệ quản trị hệ thống." />;

  return <>
    <PageHeader title="Bảng chấm công trực và chấm công khác" description={`Nhập thủ công cho ${data.department.name}. T: trực; hệ thống tự tách NN (ngày nghỉ/lễ) và NT (ngày thường).`} actions={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <div className="flex items-center rounded-lg border bg-white shadow-sm"><Button variant="ghost" size="sm" aria-label="Tháng trước" onClick={() => setMonth(previousMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><input aria-label="Chọn tháng" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-35 border-x bg-transparent px-2 text-sm font-semibold outline-none" /><Button variant="ghost" size="sm" aria-label="Tháng sau" onClick={() => setMonth(previousMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
      {canExport && <><Button variant="outline" size="sm" onClick={() => doExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span></Button><Button variant="outline" size="sm" onClick={() => doExport('docx')}><FileText className="h-4 w-4" /> <span className="hidden sm:inline">Word</span></Button><Button variant="outline" size="sm" onClick={() => doExport('pdf')}><Download className="h-4 w-4" /> PDF</Button></>}
      {canCatalog && <Link href="/cham-cong-truc/danh-muc"><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Ký hiệu & ngày nghỉ</span></Button></Link>}
      <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline"> In</span></Button>
    </div>} />

    <Card className="mb-4 border-sky-100 bg-gradient-to-br from-sky-50 to-white"><CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><Users className="h-4 w-4 text-sky-700" /> {data.staff.length} nhân viên</span><span><b className="text-amber-700">NN</b> = trực thứ Bảy, Chủ nhật hoặc ngày nghỉ/lễ</span><span><b className="text-sky-700">NT</b> = trực ngày thường</span><span className="text-slate-500">Chạm vào ô để chọn ký hiệu; thay đổi được lưu ngay.</span></CardBody></Card>

    <div className="md:hidden space-y-3">
      <div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{data.dates.map((day) => <button key={day.date} onClick={() => setMobileDate(day.date)} className={`min-w-13 snap-start rounded-xl border px-2 py-2 text-center text-xs shadow-sm ${activeDate === day.date ? 'border-sky-600 bg-sky-600 text-white' : day.isRest ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-white'}`}><b className="block text-base leading-4">{day.day}</b><span>{day.weekday}</span></button>)}</div>
      {selected && <Card className={selected.isRest ? 'border-amber-300' : ''}><CardBody className="py-3"><p className="font-semibold">Ngày {selected.day} · {selected.weekday} {selected.holidayName ? `— ${selected.holidayName}` : ''}</p><p className="mt-0.5 text-xs text-slate-500">{selected.isRest ? 'Ngày nghỉ: trực T sẽ cộng vào NN.' : 'Ngày thường: trực T sẽ cộng vào NT.'}</p></CardBody></Card>}
      <div className="space-y-2">{data.staff.map((person) => <Card key={person.id}><CardBody className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.stt}. {person.fullName}</p><p className="truncate text-xs text-slate-500">{person.title || 'Chưa khai báo chức danh'} · NN {person.totals.NN} · NT {person.totals.NT}</p></div>{selected && <CodeSelect data={data} person={person} date={selected} value={data.entries[cellKey(person.id, selected.date)]?.code ?? ''} disabled={!canUpdate || save.isPending} onSave={(code) => save.mutate({ userId: person.id, workDate: selected.date, code })} />}</CardBody></Card>)}</div>
    </div>

    <Card className="hidden md:block overflow-hidden print:block"><div className="overflow-auto [-webkit-overflow-scrolling:touch]"><table className="min-w-max border-collapse text-sm"><thead><tr className="bg-slate-100"><th rowSpan={2} className="sticky left-0 z-20 border bg-slate-100 px-2 py-2">STT</th><th rowSpan={2} className="sticky left-12 z-20 min-w-52 border bg-slate-100 px-3 py-2 text-left">Họ và tên</th><th rowSpan={2} className="sticky left-64 z-20 min-w-36 border bg-slate-100 px-3 py-2 text-left">Chức danh</th><th colSpan={data.dates.length} className="border px-2 py-2 text-center">Ngày trong tháng</th><th colSpan={2} className="border px-2 py-2 text-center">Trực</th>{data.summaryColumns.map((column) => <th key={column.code} rowSpan={2} className="border px-2 py-2">{column.name}</th>)}</tr><tr className="bg-slate-50">{data.dates.map((day) => <th title={day.holidayName || undefined} key={day.date} className={`min-w-13 border px-1 py-1 text-center ${day.isRest ? 'bg-amber-50 text-amber-800' : ''}`}><b>{day.day}</b><small className="block font-normal">{day.weekday}</small></th>)}<th className="border px-2">NN</th><th className="border px-2">NT</th></tr></thead><tbody>{data.staff.map((person) => <tr key={person.id} className="hover:bg-sky-50/50"><td className="sticky left-0 z-10 border bg-white px-2 py-1 text-center">{person.stt}</td><td className="sticky left-12 z-10 border bg-white px-3 py-1 font-medium">{person.fullName}</td><td className="sticky left-64 z-10 border bg-white px-3 py-1 text-slate-600">{person.title}</td>{data.dates.map((day) => <td className={`border p-0.5 text-center ${day.isRest ? 'bg-amber-50/45' : ''}`} key={day.date}><CodeSelect data={data} person={person} date={day} value={data.entries[cellKey(person.id, day.date)]?.code ?? ''} disabled={!canUpdate || save.isPending} onSave={(code) => save.mutate({ userId: person.id, workDate: day.date, code })} /></td>)}<td className="border px-2 text-center font-bold text-amber-800">{person.totals.NN}</td><td className="border px-2 text-center font-bold text-sky-800">{person.totals.NT}</td>{data.summaryCodes.map((code) => <td className="border px-2 text-center" key={code}>{person.totals[code] || ''}</td>)}</tr>)}</tbody></table></div></Card>
    {save.isPending && <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu…</div>}
  </>;
}
