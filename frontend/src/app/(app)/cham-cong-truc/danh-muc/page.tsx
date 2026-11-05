"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { dutyAttendanceApi, type AttendanceCode } from '@/lib/duty-attendance';

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date());
const blank = (): Omit<AttendanceCode, 'id'> => ({ code: '', name: '', group: 'OTHER', color: '#0f766e', countsAsDuty: false, showSummary: true, sortOrder: 100, active: true, note: '' });
const draftFrom = (code: AttendanceCode): Omit<AttendanceCode, 'id'> => ({ code: code.code, name: code.name, group: code.group, color: code.color, countsAsDuty: code.countsAsDuty, showSummary: code.showSummary, sortOrder: code.sortOrder, active: code.active, note: code.note });

export default function ChamCongDanhMucPage() {
  const can = useAuth((s) => s.can);
  const client = useQueryClient();
  const allowed = can('duty-attendance.catalog.manage');
  const [month, setMonth] = useState(thisMonth);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Omit<AttendanceCode, 'id'>>(blank);
  const codes = useQuery({ queryKey: ['duty-attendance-codes'], queryFn: dutyAttendanceApi.codes, enabled: allowed });
  const holidays = useQuery({ queryKey: ['duty-attendance-holidays', month], queryFn: () => dutyAttendanceApi.holidays(month), enabled: allowed });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['duty-attendance-codes'] });
    void client.invalidateQueries({ queryKey: ['duty-attendance-holidays'] });
    void client.invalidateQueries({ queryKey: ['duty-attendance'] });
  };
  const resetEditor = () => { setEditingId(null); setDraft(blank()); };
  const saveCode = useMutation({
    mutationFn: () => editingId ? dutyAttendanceApi.updateCode(editingId, draft) : dutyAttendanceApi.createCode(draft),
    onSuccess: () => { toast.success(editingId ? 'Đã cập nhật ký hiệu' : 'Đã thêm ký hiệu'); resetEditor(); refresh(); },
    onError: (e: Error) => toast.error(e.message || 'Không lưu được ký hiệu'),
  });
  const deleteCode = useMutation({
    mutationFn: dutyAttendanceApi.deleteCode,
    onSuccess: (_data, id) => { if (editingId === id) resetEditor(); toast.success('Đã xóa ký hiệu chưa phát sinh dữ liệu'); refresh(); },
    onError: (e: Error) => toast.error(e.message || 'Không thể xóa ký hiệu'),
  });
  const saveHoliday = useMutation({
    mutationFn: (form: { holidayDate: string; name: string; note: string }) => dutyAttendanceApi.saveHoliday(form),
    onSuccess: () => { toast.success('Đã lưu ngày nghỉ/lễ'); refresh(); },
    onError: (e: Error) => toast.error(e.message || 'Không lưu được ngày nghỉ'),
  });
  const removeHoliday = useMutation({
    mutationFn: dutyAttendanceApi.deleteHoliday,
    onSuccess: () => { toast.success('Đã xóa ngày nghỉ/lễ'); refresh(); },
    onError: (e: Error) => toast.error(e.message || 'Không thể xóa'),
  });

  if (!allowed) return <EmptyState title="Bạn chưa có quyền quản lý danh mục chấm công" description="Liên hệ quản trị hệ thống để khai báo ký hiệu và ngày nghỉ/lễ." />;

  return <>
    <PageHeader title="Ký hiệu & ngày nghỉ chấm công" description="Khai báo mở rộng các ký hiệu và ngày nghỉ/lễ. Bảng trực được nhập riêng, không tự lấy từ lịch khám." actions={<Link href="/cham-cong-truc"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /> Bảng chấm công</Button></Link>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader title={editingId ? `Sửa ký hiệu ${draft.code}` : 'Thêm ký hiệu chấm công'} description="Ký hiệu có thể được sửa. Chỉ xóa được ký hiệu chưa từng phát sinh chấm công để bảo toàn lịch sử." actions={editingId ? <Button variant="outline" size="sm" onClick={resetEditor}><X className="h-4 w-4" /> Hủy sửa</Button> : undefined} />
        <CardBody>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveCode.mutate(); }}>
            <label className="grid gap-1.5 text-sm font-semibold">Mã ký hiệu <input required maxLength={16} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} className="h-10 rounded-lg border border-slate-200 px-3 uppercase outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="VD: T" /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Tên hiển thị <input required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="VD: Trực" /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Nhóm <input required maxLength={32} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value.toUpperCase() })} className="h-10 rounded-lg border border-slate-200 px-3 uppercase outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="DUTY / LEAVE / OTHER" /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Thứ tự <input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} className="h-10 rounded-lg border border-slate-200 px-3 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><input type="checkbox" checked={draft.countsAsDuty} onChange={(e) => setDraft({ ...draft, countsAsDuty: e.target.checked })} /> Tính là trực — tự cộng NN/NT</label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><input type="checkbox" checked={draft.showSummary} onChange={(e) => setDraft({ ...draft, showSummary: e.target.checked })} /> Hiện cột tổng trong bảng</label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Đang sử dụng</label>
            <label className="grid gap-1.5 text-sm font-semibold">Màu nhận diện <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-1" /></label>
            <label className="grid gap-1.5 text-sm font-semibold sm:col-span-2">Ghi chú <input maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="h-10 rounded-lg border border-slate-200 px-3 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={saveCode.isPending}><Save className="h-4 w-4" /> {editingId ? 'Lưu thay đổi' : 'Thêm ký hiệu'}</Button><Button type="button" variant="outline" onClick={resetEditor}>Làm trống</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader title="Ngày nghỉ / lễ" description="Thứ Bảy, Chủ nhật tự là ngày nghỉ. Khai báo thêm lễ/đặc biệt để trực T được tính NN." />
        <CardBody>
          <label className="mb-4 grid gap-1.5 text-sm font-semibold">Tháng cần xem<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-lg border border-slate-200 px-3" /></label>
          <form className="space-y-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); saveHoliday.mutate({ holidayDate: String(f.get('holidayDate')), name: String(f.get('name')).trim(), note: String(f.get('note')).trim() }); e.currentTarget.reset(); }}><input name="holidayDate" required type="date" className="h-10 w-full rounded-lg border border-slate-200 px-3" /><input name="name" required maxLength={160} placeholder="Tên ngày nghỉ/lễ" className="h-10 w-full rounded-lg border border-slate-200 px-3" /><input name="note" maxLength={500} placeholder="Ghi chú (nếu có)" className="h-10 w-full rounded-lg border border-slate-200 px-3" /><Button type="submit" className="mt-1 w-full" disabled={saveHoliday.isPending}><Plus className="h-4 w-4" /> Lưu ngày nghỉ</Button></form>
          <div className="mt-4 space-y-2">{holidays.isLoading ? <Skeleton className="h-20" /> : holidays.data?.length ? holidays.data.map((holiday) => <div key={holiday.id} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5"><CalendarDays className="h-4 w-4 shrink-0 text-amber-700" /><div className="min-w-0 flex-1"><p className="font-semibold text-slate-800">{holiday.holidayDate} · {holiday.name}</p>{holiday.note && <p className="truncate text-xs text-slate-500">{holiday.note}</p>}</div><Button size="icon" variant="ghost" className="text-rose-700 hover:bg-rose-100" aria-label={`Xóa ${holiday.name}`} onClick={() => { if (confirm(`Xóa ngày nghỉ “${holiday.name}”?`)) removeHoliday.mutate(holiday.id); }}><Trash2 className="h-4 w-4" /></Button></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Chưa có ngày nghỉ/lễ khai báo trong tháng này.</p>}</div>
        </CardBody>
      </Card>
    </div>

    <Card className="mt-5 border-slate-200 shadow-sm">
      <CardHeader title="Các ký hiệu đã khai báo" description="Nút Sửa mở biểu mẫu phía trên. Nút Xóa chỉ hoạt động khi ký hiệu chưa phát sinh dữ liệu chấm công." />
      <CardBody>{codes.isLoading ? <Skeleton className="h-36" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{codes.data?.map((code) => <article key={code.id} className={`rounded-xl border p-3 transition ${editingId === code.id ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}><div className="flex items-start gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: code.color }} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-sm">{code.code}</b><span className="font-semibold">{code.name}</span></div><p className="mt-1 text-xs text-slate-500">{code.countsAsDuty ? 'Tính trực NN/NT' : code.showSummary ? 'Có cột tổng' : 'Không có cột tổng'} · Nhóm {code.group}</p><div className="mt-2">{code.active ? <Badge tone="success"><Check className="h-3 w-3" /> Đang dùng</Badge> : <Badge tone="muted">Đã ngừng dùng</Badge>}</div></div></div><div className="mt-3 flex gap-2 border-t border-slate-100 pt-3"><Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { setEditingId(code.id); setDraft(draftFrom(code)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil className="h-4 w-4" /> Sửa</Button><Button type="button" variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-50" disabled={deleteCode.isPending} onClick={() => { if (confirm(`Xóa ký hiệu “${code.code} – ${code.name}”? Chỉ xóa được khi chưa có dữ liệu chấm công.`)) deleteCode.mutate(code.id); }}><Trash2 className="h-4 w-4" /><span className="sr-only">Xóa {code.code}</span></Button></div></article>)}</div>}</CardBody>
    </Card>
  </>;
}
