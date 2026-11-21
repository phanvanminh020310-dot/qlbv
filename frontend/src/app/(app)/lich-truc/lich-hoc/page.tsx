"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, GraduationCap, Loader2, RefreshCw, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { staffLearningApi, staffLearningKeys, type StaffLearningDay } from '@/lib/staff-learning';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select, Textarea } from '@/components/ui/input';

const dateAtBangkok = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const item = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${item('year')}-${item('month')}-${item('day')}`;
};
const addDays = (ymd: string, delta: number) => {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};
const mondayOf = (ymd: string) => {
  const date = new Date(`${ymd}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  return addDays(ymd, 1 - weekday);
};
const currentWeek = () => mondayOf(dateAtBangkok());
const shortDate = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const entryKey = (departmentId: number, date: string) => `${departmentId}:${date}`;

function WeekNavigator({ value, onChange }: { value: string; onChange: (week: string) => void }) {
  const end = addDays(value, 6);
  return (
    <div className="flex flex-wrap items-center overflow-hidden rounded-lg border bg-white shadow-sm">
      <Button variant="ghost" size="sm" aria-label="Tuần trước" onClick={() => onChange(addDays(value, -7))}><ChevronLeft className="h-4 w-4" /></Button>
      <label className="flex h-9 items-center gap-2 border-x px-3 text-sm font-semibold">
        <CalendarDays className="h-4 w-4 text-teal-700" />
        <span className="hidden sm:inline">Tuần</span>
        <input aria-label="Chọn tuần học" type="date" value={value} onChange={(event) => { if (event.target.value) onChange(mondayOf(event.target.value)); }} className="w-[8.25rem] bg-transparent text-sm outline-none" />
        <span className="text-xs font-normal text-slate-500">– {shortDate(end)}</span>
      </label>
      <Button variant="ghost" size="sm" aria-label="Tuần sau" onClick={() => onChange(addDays(value, 7))}><ChevronRight className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" className="border-l text-xs" onClick={() => onChange(currentWeek())}>Tuần này</Button>
    </div>
  );
}

function SummaryTile({ label, value, hint, tone = 'teal' }: { label: string; value: number; hint: string; tone?: 'teal' | 'blue' | 'amber' }) {
  const style = tone === 'blue' ? 'border-blue-100 from-blue-50 to-white text-blue-800' : tone === 'amber' ? 'border-amber-100 from-amber-50 to-white text-amber-800' : 'border-teal-100 from-teal-50 to-white text-teal-800';
  return <div className={`rounded-xl border bg-gradient-to-br p-4 shadow-sm ${style}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></div>;
}

function RegisterDayButton({ day, registered, note, disabled, onClick }: { day: StaffLearningDay; registered: boolean; note?: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`relative min-h-28 rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-55 ${registered ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50'}`}><span className="block text-sm font-bold">{day.weekday}</span><span className={`mt-0.5 block text-xs ${registered ? 'text-teal-50' : 'text-slate-500'}`}>{shortDate(day.date)}</span><span className={`mt-4 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${registered ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{registered ? 'Đã đăng ký' : 'Đăng ký học'}</span>{note ? <span className={`mt-2 block line-clamp-2 text-xs ${registered ? 'text-teal-50' : 'text-slate-500'}`} title={note}>Ghi chú: {note}</span> : null}</button>;
}

export default function LichHocCanBoNhanVienPage() {
  const can = useAuth((state) => state.can);
  const currentUser = useAuth((state) => state.user);
  const client = useQueryClient();
  const canView = can('staff-learning.view');
  const canExport = can('staff-learning.export');
  const userId = currentUser?.id;
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [selectedStaffId, setSelectedStaffId] = useState<number | undefined>();
  const [dayEditor, setDayEditor] = useState<StaffLearningDay>();
  const [noteDraft, setNoteDraft] = useState('');
  const key = staffLearningKeys.week(userId, weekStart);
  const query = useQuery({ queryKey: key, queryFn: () => staffLearningApi.week(weekStart), enabled: canView && !!userId, refetchOnMount: 'always' });
  const register = useMutation({
    mutationFn: staffLearningApi.register,
    onSuccess: (result) => {
      toast.success(result.alreadyRegistered ? 'Nhân viên đã có đăng ký lịch học ngày này' : 'Đã đăng ký lịch học cho nhân viên');
      setDayEditor(undefined);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message || 'Không thể đăng ký lịch học'),
  });
  const updateNote = useMutation({
    mutationFn: staffLearningApi.updateNote,
    onSuccess: () => {
      toast.success('Đã cập nhật ghi chú lịch học');
      setDayEditor(undefined);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message || 'Không thể cập nhật ghi chú lịch học'),
  });
  const remove = useMutation({
    mutationFn: staffLearningApi.remove,
    onSuccess: (result) => {
      toast.success(result.removed ? 'Đã gỡ đăng ký lịch học' : 'Không còn đăng ký để gỡ');
      setDayEditor(undefined);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message || 'Không thể gỡ lịch học'),
  });

  const data = query.data;
  const selectedStaff = useMemo(() => {
    if (!data) return undefined;
    return data.staff.find((person) => person.userId === selectedStaffId) ?? data.staff[0];
  }, [data, selectedStaffId]);
  const registrationsByDate = useMemo(() => {
    if (!data || !selectedStaff) return new Map<string, { note: string }>();
    const selected = new Map<string, { note: string }>();
    for (const day of data.days) {
      const registration = Object.entries(data.entries).flatMap(([key, people]) => key.endsWith(`:${day.date}`) ? people : []).find((person) => person.userId === selectedStaff.userId);
      if (registration) selected.set(day.date, { note: registration.note ?? '' });
    }
    return selected;
  }, [data, selectedStaff]);
  const busy = register.isPending || updateNote.isPending || remove.isPending;
  const openDayEditor = (day: StaffLearningDay) => {
    setDayEditor(day);
    setNoteDraft(registrationsByDate.get(day.date)?.note ?? '');
  };
  const currentDayRegistration = dayEditor ? registrationsByDate.get(dayEditor.date) : undefined;
  const exportExcel = async () => {
    try {
      await downloadFile(staffLearningApi.exportPath(weekStart), `LICH_HOC_CAN_BO_NHAN_VIEN_${weekStart}.xlsx`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể xuất Excel');
    }
  };

  if (!canView) return <EmptyState title="Bạn chưa có quyền vào lịch học cán bộ nhân viên" description="Quản trị viên cần gán vai trò Đăng ký lịch học cán bộ nhân viên hoặc vai trò Điều phối phù hợp." />;
  if (query.isLoading) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-44 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (query.isError || !data) return <EmptyState title="Không tải được lịch học" description={query.error instanceof Error ? query.error.message : 'Hãy thử lại hoặc liên hệ quản trị hệ thống.'} />;

  return <>
    <PageHeader title="Lịch học cán bộ nhân viên" description={data.viewer.seesAllDepartments ? 'Điều phối xem và xuất lịch học của tất cả khoa/phòng.' : 'Người được giao vai trò chỉ xem và nhập lịch cho nhân viên thuộc khoa/phòng được gán.'} actions={<div className="flex flex-wrap gap-2"><WeekNavigator value={weekStart} onChange={setWeekStart} />{canExport ? <Button variant="outline" size="sm" onClick={() => void exportExcel()}><Download className="h-4 w-4" /> Excel</Button> : null}<Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Làm mới</span></Button></div>} />

    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryTile label="Lượt đăng ký" value={data.summary.registrations} hint="Tổng lượt học trong tuần" /><SummaryTile label="Cán bộ nhân viên" value={data.summary.people} hint="Người đã có đăng ký" tone="blue" /><SummaryTile label="Khoa / đơn vị" value={data.summary.departments} hint={data.viewer.seesAllDepartments ? 'Toàn viện' : 'Trong phạm vi được gán'} tone="amber" /><SummaryTile label="Ngày có lịch học" value={data.summary.daysWithRegistration} hint="Từ Thứ 2 đến Chủ nhật" /></div>

    {data.viewer.canRegister ? <Card className="mb-5 border-teal-100"><CardHeader title="Đăng ký lịch học cho nhân viên" description="Chọn nhân viên trong khoa/phòng được gán, sau đó bấm từng ngày để đăng ký hoặc gỡ. Không thể thao tác nhân viên ngoài phạm vi." actions={<GraduationCap className="h-5 w-5 text-teal-700" />} /><CardBody>{data.staff.length ? <><div className="max-w-2xl"><label htmlFor="staff-learning-person" className="mb-1.5 block text-sm font-medium text-slate-700">Nhân viên</label><Select id="staff-learning-person" value={selectedStaff ? String(selectedStaff.userId) : ''} disabled={busy} onChange={(event) => setSelectedStaffId(Number(event.target.value))}>{data.staff.map((person) => <option key={person.userId} value={person.userId}>{person.fullName}{person.manv ? ` · ${person.manv}` : ''} — {person.departmentShortName || person.departmentName}</option>)}</Select>{selectedStaff ? <p className="mt-2 text-xs text-slate-500">{selectedStaff.title || 'Nhân viên'} · {selectedStaff.departmentName}</p> : null}</div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">{data.days.map((day) => <RegisterDayButton key={day.date} day={day} registered={registrationsByDate.has(day.date)} note={registrationsByDate.get(day.date)?.note} disabled={busy || !selectedStaff} onClick={() => openDayEditor(day)} />)}</div><p className="mt-3 flex items-start gap-2 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-950"><Users className="mt-0.5 h-4 w-4 shrink-0" />Mỗi lượt đăng ký được ghi nhận theo khoa/phòng công tác của nhân viên tại thời điểm nhập. Vai trò này chỉ thao tác được nhân viên thuộc khoa/phòng đã gán.</p></> : <EmptyState title="Không có nhân viên hoạt động trong phạm vi được gán" description="Hãy kiểm tra khoa/phòng và danh sách người dùng trước khi đăng ký lịch học." />}</CardBody></Card> : <Card className="mb-5 border-sky-100"><CardHeader title={data.viewer.seesAllDepartments ? 'Chế độ điều phối' : 'Chế độ xem lịch học'} description={data.viewer.seesAllDepartments ? 'Bạn được xem và xuất lịch của toàn viện; quyền nhập lịch được gán riêng qua vai trò Đăng ký lịch học cán bộ nhân viên.' : 'Bạn chỉ có quyền xem lịch trong phạm vi được gán hoặc chưa có khoa/phòng hợp lệ để nhập lịch.'} /><CardBody><p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950"><Users className="mt-0.5 h-4 w-4 shrink-0" />{data.viewer.seesAllDepartments ? 'Đang hiển thị toàn bộ khoa/phòng đang hoạt động.' : 'Đang hiển thị các khoa/phòng được gán cho tài khoản.'}</p></CardBody></Card>}

    <Card><CardHeader title={`Danh sách lịch học · ${shortDate(data.weekStart)} – ${shortDate(data.days[data.days.length - 1]!.date)}`} description="Tên cán bộ nhân viên được hiển thị trong ô ngày đã đăng ký. Có thể xuất Excel với cột Khoa/đơn vị và các ngày trong tuần." /><CardBody className="p-0"><div className="overflow-auto"><table className="min-w-[1080px] w-full border-separate border-spacing-0 text-sm"><thead><tr><th className="sticky left-0 top-0 z-20 w-16 border-b border-r bg-slate-100 px-3 py-3 text-center font-bold">STT</th><th className="sticky left-16 top-0 z-20 min-w-56 border-b border-r bg-slate-100 px-3 py-3 text-left font-bold">Khoa / đơn vị</th>{data.days.map((day) => <th key={day.date} className="sticky top-0 z-10 min-w-48 border-b border-r bg-[#dff0d5] px-3 py-2 text-center font-bold text-slate-800"><span className="block">{day.weekday}</span><span className="mt-0.5 block text-xs font-medium text-slate-600">{shortDate(day.date)}</span></th>)}</tr></thead><tbody>{data.departments.map((department, index) => <tr key={department.id} className={index % 2 ? 'bg-slate-50/70' : 'bg-white'}><td className={`sticky left-0 z-10 border-b border-r px-3 py-3 text-center font-medium ${index % 2 ? 'bg-slate-50' : 'bg-white'}`}>{index + 1}</td><td className={`sticky left-16 z-10 border-b border-r px-3 py-3 font-semibold ${index % 2 ? 'bg-slate-50' : 'bg-white'}`}><span>{department.shortName || department.name}</span>{department.code ? <span className="ml-1.5 text-xs font-normal text-slate-500">({department.code})</span> : null}</td>{data.days.map((day) => { const people = data.entries[entryKey(department.id, day.date)] ?? []; return <td key={day.date} className="min-h-16 border-b border-r px-3 py-2 align-top">{people.length ? <ul className="space-y-1">{people.map((person) => <li key={person.userId} className={`rounded-md px-2 py-1 text-xs leading-snug ${person.userId === data.viewer.userId ? 'bg-teal-100 font-semibold text-teal-950 ring-1 ring-teal-300' : 'bg-slate-100 text-slate-800'}`} title={`${person.title || 'Cán bộ'} · ${person.manv || 'Chưa có MANV'}`}><span>{person.fullName}{person.userId === data.viewer.userId ? <span className="ml-1 text-[10px] text-teal-700">(Bạn)</span> : null}</span>{person.note ? <span className="mt-0.5 block text-[11px] font-normal text-slate-600">Ghi chú: {person.note}</span> : null}</li>)}</ul> : <span className="text-slate-300">—</span>}</td>; })}</tr>)}</tbody></table></div>{data.departments.length === 0 ? <div className="p-6"><EmptyState title="Không có khoa/phòng trong phạm vi xem" description="Người dùng cần được gán đơn vị công tác hoặc phạm vi khoa trước khi sử dụng lịch học." /></div> : null}</CardBody></Card>
    <Dialog open={!!dayEditor} onClose={() => { if (!busy) setDayEditor(undefined); }} title={currentDayRegistration ? 'Ghi chú lượt học' : 'Đăng ký lịch học'} description={dayEditor && selectedStaff ? `${selectedStaff.fullName} · ${dayEditor.weekday}, ${shortDate(dayEditor.date)}` : undefined} footer={<><Button variant="outline" disabled={busy} onClick={() => setDayEditor(undefined)}>Hủy</Button>{currentDayRegistration && dayEditor && selectedStaff ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" disabled={busy} onClick={() => remove.mutate({ userId: selectedStaff.userId, studyDate: dayEditor.date })}>Gỡ đăng ký</Button> : null}<Button disabled={!dayEditor || !selectedStaff || busy} loading={busy} onClick={() => { if (!dayEditor || !selectedStaff) return; const input = { userId: selectedStaff.userId, studyDate: dayEditor.date, note: noteDraft }; if (currentDayRegistration) updateNote.mutate(input); else register.mutate(input); }}>{currentDayRegistration ? 'Lưu ghi chú' : 'Đăng ký học'}</Button></>}><div className="space-y-2"><label htmlFor="staff-learning-note" className="block text-sm font-medium text-slate-700">Ghi chú buổi học <span className="font-normal text-slate-500">(không bắt buộc)</span></label><Textarea id="staff-learning-note" aria-label="Ghi chú lịch học" value={noteDraft} maxLength={300} rows={4} disabled={busy} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Ví dụ: Chỉ học buổi sáng; học buổi chiều" /><p className="text-right text-xs text-slate-500">{noteDraft.length}/300</p><p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-950">Ghi chú được lưu riêng cho từng ngày học, hiển thị trong lịch và kèm theo khi xuất Excel.</p></div></Dialog>
    {busy ? <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Đang cập nhật lịch học…</div> : null}
  </>;
}
