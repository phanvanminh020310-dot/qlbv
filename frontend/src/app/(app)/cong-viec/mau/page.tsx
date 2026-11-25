'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Field, PriorityBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { PRIORITY_LABEL, taskKeys, tasksApi, type TaskPriority, type TaskTemplate } from '@/lib/tasks';

type Draft = { id: number | null; name: string; title: string; description: string; priority: TaskPriority; estimateHours: string; dueDays: string; checklist: string; labels: string; departmentId: string; active: boolean };
const empty: Draft = { id: null, name: '', title: '', description: '', priority: 'NORMAL', estimateHours: '', dueDays: '', checklist: '', labels: '', departmentId: '', active: true };

export default function TaskTemplatesPage() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const list = useQuery({ queryKey: [...taskKeys.all, 'templates'], queryFn: tasksApi.templates });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [useTpl, setUseTpl] = useState<TaskTemplate | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      tasksApi.saveTemplate(d.id, {
        name: d.name.trim(),
        title: d.title.trim(),
        description: d.description,
        priority: d.priority,
        estimateHours: d.estimateHours ? Number(d.estimateHours) : null,
        dueDays: d.dueDays ? Number(d.dueDays) : null,
        checklist: d.checklist.split('\n').map((s) => s.trim()).filter(Boolean),
        labels: d.labels.split(/[,;#]/).map((s) => s.trim()).filter(Boolean),
        departmentId: d.departmentId ? Number(d.departmentId) : null,
        active: d.active,
      }),
    onSuccess: () => { toast.success('Đã lưu mẫu công việc'); setDraft(null); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => tasksApi.deleteTemplate(id),
    onSuccess: () => { toast.success('Đã xoá mẫu'); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = (t: TaskTemplate) =>
    setDraft({
      id: t.id, name: t.name, title: t.title, description: t.description, priority: t.priority, estimateHours: t.estimateHours ? String(Number(t.estimateHours)) : '',
      dueDays: t.dueDays ? String(t.dueDays) : '', checklist: t.checklist.join('\n'), labels: t.labels.join(', '), departmentId: t.departmentId ? String(t.departmentId) : '', active: t.active,
    });
  const deptName = (id: number | null) => (id ? meta.data?.departments.find((d) => d.id === id)?.name ?? `Khoa #${id}` : 'Dùng chung');

  return (
    <div>
      <PageHeader
        title="Mẫu công việc"
        description="Công việc lặp lại thường xuyên (báo cáo tuần, kiểm kê, trực…) — lưu sẵn tiêu đề, mô tả, danh mục kiểm tra, hạn mặc định."
        actions={meta.data?.permissions.canAssign ? <Button onClick={() => setDraft({ ...empty })}><Plus /> Tạo mẫu</Button> : null}
      />
      <TaskSubnav />
      {list.isLoading ? <Skeleton className="h-40" /> : !list.data?.length ? (
        <EmptyState title="Chưa có mẫu công việc" description="Tạo mẫu để giao các việc lặp lại chỉ với vài cú bấm." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.name}</div>
                  <div className="truncate text-sm text-[var(--muted-foreground)]">{t.title || '—'}</div>
                </div>
                <PriorityBadge priority={t.priority} compact />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <Badge tone="muted">{deptName(t.departmentId)}</Badge>
                {t.dueDays ? <Badge tone="info">Hạn +{t.dueDays} ngày</Badge> : null}
                {t.estimateHours ? <Badge tone="muted">{Number(t.estimateHours)} giờ</Badge> : null}
                {t.checklist.length ? <Badge tone="muted">{t.checklist.length} mục kiểm tra</Badge> : null}
                {t.labels.map((l) => <span key={l} className="text-sky-700">#{l}</span>)}
              </div>
              <div className="mt-auto flex gap-1 pt-3">
                <Button size="sm" onClick={() => setUseTpl(t)}><Copy /> Giao theo mẫu</Button>
                {meta.data?.permissions.canAssign ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => edit(t)}><Pencil /></Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => confirm(`Xoá mẫu “${t.name}”?`) && remove.mutate(t.id)}><Trash2 /></Button>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {draft ? (
        <Dialog
          open
          onClose={() => setDraft(null)}
          size="lg"
          title={draft.id ? 'Sửa mẫu công việc' : 'Tạo mẫu công việc'}
          footer={<><Button variant="outline" onClick={() => setDraft(null)}>Huỷ</Button><Button loading={save.isPending} disabled={draft.name.trim().length < 2} onClick={() => save.mutate(draft)}>Lưu mẫu</Button></>}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tên mẫu *"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></Field>
            <Field label="Phạm vi dùng">
              <Select value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}>
                <option value="">Dùng chung toàn viện</option>
                {meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Tiêu đề công việc" className="md:col-span-2"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="VD: Báo cáo tình hình khoa tuần" /></Field>
            <Field label="Mô tả / yêu cầu" className="md:col-span-2"><Textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <Field label="Ưu tiên">
              <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hạn sau (ngày)"><Input type="number" min={0} max={365} value={draft.dueDays} onChange={(e) => setDraft({ ...draft, dueDays: e.target.value })} /></Field>
              <Field label="Ước lượng (giờ)"><Input type="number" min={0} step={0.5} value={draft.estimateHours} onChange={(e) => setDraft({ ...draft, estimateHours: e.target.value })} /></Field>
            </div>
            <Field label="Danh mục kiểm tra (mỗi dòng một mục)" className="md:col-span-2"><Textarea rows={4} value={draft.checklist} onChange={(e) => setDraft({ ...draft, checklist: e.target.value })} /></Field>
            <Field label="Nhãn (phân cách dấu phẩy)"><Input value={draft.labels} onChange={(e) => setDraft({ ...draft, labels: e.target.value })} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> Đang sử dụng</label>
          </div>
        </Dialog>
      ) : null}
      {useTpl ? <TaskFormDialog open onClose={() => setUseTpl(null)} defaults={{ templateId: useTpl.id }} /> : null}
    </div>
  );
}
