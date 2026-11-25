'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, Save, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import {
  PRIORITY_LABEL,
  filesToPayload,
  fromLocalInput,
  taskKeys,
  tasksApi,
  toLocalInput,
  type TaskDetail,
  type TaskInput,
  type TaskPriority,
  type TaskRecurrence,
} from '@/lib/tasks';
import { Field, FilePicker, UserPicker } from './task-ui';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sửa công việc có sẵn */
  task?: TaskDetail | null;
  /** Mặc định khi tạo mới */
  defaults?: Partial<TaskInput>;
  /** Tên việc cha (khi tạo việc con) */
  parentLabel?: string;
  onSaved?: (id: number) => void;
}

const splitLabels = (s: string) => [...new Set(s.split(/[,;#]/).map((x) => x.trim()).filter(Boolean))].slice(0, 10);

export function TaskFormDialog({ open, onClose, task, defaults, parentLabel, onSaved }: Props) {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useAuth((s) => s.user);
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000, enabled: open });
  const editing = !!task;

  const [templateId, setTemplateId] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<number[]>([]);
  const [reviewer, setReviewer] = useState<number[]>([]);
  const [watchers, setWatchers] = useState<number[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [startDate, setStartDate] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [estimate, setEstimate] = useState('');
  const [labels, setLabels] = useState('');
  const [checklist, setChecklist] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>({ freq: 'WEEKLY', interval: 1, until: null });
  const [files, setFiles] = useState<File[]>([]);

  // Chỉ khởi tạo lại khi mở hộp thoại / đổi công việc — `defaults` thường là object inline
  // nên không đưa vào deps (tránh xoá nội dung đang nhập mỗi lần trang cha render lại).
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const pendingTemplate = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const src = task ?? null;
    const defaults = defaultsRef.current;
    pendingTemplate.current = !src && defaults?.templateId ? defaults.templateId : null;
    setTemplateId('');
    setTitle(src?.title ?? defaults?.title ?? '');
    setDescription(src?.description ?? defaults?.description ?? '');
    setAssignees(src?.assigneeId ? [src.assigneeId] : (defaults?.assigneeIds ?? (defaults?.assigneeId ? [defaults.assigneeId] : [])));
    setReviewer(src?.reviewerId ? [src.reviewerId] : defaults?.reviewerId ? [defaults.reviewerId] : []);
    setWatchers(defaults?.watcherIds ?? []);
    setProjectId(src?.projectId ?? defaults?.projectId ?? '');
    setPriority(src?.priority ?? defaults?.priority ?? 'NORMAL');
    setStartDate(src?.startDate ?? '');
    setDueAt(toLocalInput(src?.dueAt ?? defaults?.dueAt ?? null));
    setEstimate(src?.estimateHours ? String(Number(src.estimateHours)) : '');
    setLabels((src?.labels ?? defaults?.labels ?? []).join(', '));
    setChecklist('');
    setRecurring(!!src?.recurrence);
    setRecurrence(src?.recurrence ?? { freq: 'WEEKLY', interval: 1, until: null });
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const applyTemplate = (id: number | '') => {
    setTemplateId(id);
    const tpl = meta.data?.templates.find((t) => t.id === id);
    if (!tpl) return;
    if (tpl.title) setTitle(tpl.title);
    if (tpl.description) setDescription(tpl.description);
    setPriority(tpl.priority);
    if (tpl.estimateHours) setEstimate(String(Number(tpl.estimateHours)));
    if (tpl.labels.length) setLabels(tpl.labels.join(', '));
    if (tpl.checklist.length) setChecklist(tpl.checklist.join('\n'));
    if (tpl.dueDays) setDueAt(toLocalInput(new Date(Date.now() + tpl.dueDays * 86400_000).toISOString()));
  };

  useEffect(() => {
    if (!open || pendingTemplate.current === null || !meta.data) return;
    const id = pendingTemplate.current;
    pendingTemplate.current = null;
    applyTemplate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meta.data]);

  const save = useMutation({
    mutationFn: async (draft: boolean) => {
      const payloadFiles = files.length ? await filesToPayload(files) : undefined;
      const common = {
        title: title.trim(),
        description,
        priority,
        projectId: projectId === '' ? null : projectId,
        startDate: startDate || null,
        dueAt: fromLocalInput(dueAt),
        estimateHours: estimate ? Number(estimate) : null,
        labels: splitLabels(labels),
        reviewerId: reviewer[0] ?? null,
        recurrence: recurring ? { ...recurrence, until: recurrence.until || null } : null,
      };
      if (editing && task) {
        const saved = await tasksApi.update(task.id, { ...common, assigneeId: assignees[0] ?? null });
        if (payloadFiles) await tasksApi.upload(task.id, payloadFiles);
        return { id: saved.id, count: 1, code: saved.code };
      }
      const res = await tasksApi.create({
        ...common,
        assigneeIds: assignees,
        parentId: defaults?.parentId ?? null,
        departmentId: defaults?.departmentId ?? null,
        checklist: checklist.split('\n').map((s) => s.trim()).filter(Boolean),
        watcherIds: watchers,
        templateId: templateId === '' ? null : templateId,
        draft,
        files: payloadFiles,
      });
      return { id: res.id, count: res.ids.length, code: res.code };
    },
    onSuccess: (r, draft) => {
      toast.success(editing ? 'Đã lưu thay đổi' : draft ? `Đã lưu nháp ${r.code}` : r.count > 1 ? `Đã giao ${r.count} công việc (mỗi người một việc)` : `Đã giao việc ${r.code}`);
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      onClose();
      if (onSaved) onSaved(r.id);
      else if (!editing && r.count === 1) router.push(`/cong-viec/${r.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selfOnly = assignees.length === 1 && assignees[0] === me?.id;
  const canAssignOthers = meta.data?.permissions.canAssign;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Sửa công việc ${task?.code}` : parentLabel ? 'Thêm việc con' : 'Giao việc mới'}
      description={
        parentLabel
          ? `Thuộc: ${parentLabel}`
          : editing
            ? 'Thay đổi người thực hiện sẽ đưa công việc về trạng thái chờ nhận.'
            : canAssignOthers
              ? 'Chọn nhiều người thực hiện để tạo mỗi người một việc riêng; tự giao cho mình thì không cần bước nhận việc.'
              : 'Bạn có thể tự tạo việc cho chính mình. Giao cho người khác cần quyền giao việc.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          {!editing ? (
            <Button variant="subtle" loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate(true)}>
              <Save /> Lưu nháp
            </Button>
          ) : null}
          <Button loading={save.isPending} disabled={!title.trim() || (!editing && assignees.length === 0)} onClick={() => save.mutate(false)}>
            {editing ? <><Save /> Lưu</> : <><Send /> {selfOnly ? 'Tạo việc' : 'Giao việc'}</>}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {!editing && meta.data?.templates.length ? (
          <Field label="Mẫu công việc" className="md:col-span-2">
            <Select value={templateId} onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— Không dùng mẫu —</option>
              {meta.data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Tiêu đề *" className="md:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Ví dụ: Tổng hợp báo cáo giao ban tuần" autoFocus />
        </Field>
        <Field label="Mô tả / yêu cầu chi tiết" className="md:col-span-2">
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mục tiêu, yêu cầu đầu ra, tiêu chí hoàn thành…" />
        </Field>
        <Field label={editing ? 'Người thực hiện' : 'Người thực hiện * (chọn được nhiều)'} className="md:col-span-2">
          <UserPicker value={assignees} onChange={setAssignees} multiple={!editing} projectId={projectId || null} />
        </Field>
        <Field label="Người duyệt kết quả" hint="Bỏ trống = người giao việc duyệt">
          <UserPicker value={reviewer} onChange={setReviewer} projectId={projectId || null} placeholder="Mặc định: người giao" />
        </Field>
        <Field label="Dự án">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} disabled={!!defaults?.parentId}>
            <option value="">— Không thuộc dự án —</option>
            {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Mức ưu tiên">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
        </Field>
        <Field label="Hạn hoàn thành">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Ngày bắt đầu">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Ước lượng (giờ)">
          <Input type="number" min={0} step={0.5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </Field>
        <Field label="Nhãn" hint="Ngăn cách bằng dấu phẩy" className="md:col-span-2">
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="HSBA, Giao ban, Chất lượng" list="task-label-list" />
          <datalist id="task-label-list">{meta.data?.labels.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
        {!editing ? (
          <>
            <Field label="Danh mục cần làm (mỗi dòng một mục)" className="md:col-span-2">
              <Textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={'Thu thập số liệu\nĐối chiếu\nTrình ký'} />
            </Field>
            <Field label="Người theo dõi (nhận thông báo)" className="md:col-span-2">
              <UserPicker value={watchers} onChange={setWatchers} multiple projectId={projectId || null} placeholder="Thêm người theo dõi…" />
            </Field>
          </>
        ) : null}
        <div className="space-y-2 rounded-lg border p-3 md:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            <Repeat className="size-4 text-teal-700" /> Lặp lại định kỳ
            <span className="text-xs font-normal text-[var(--muted-foreground)]">— duyệt hoàn thành sẽ tự sinh việc kỳ tiếp theo</span>
          </label>
          {recurring ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Mỗi
              <Input type="number" min={1} max={365} className="w-20" value={recurrence.interval} onChange={(e) => setRecurrence({ ...recurrence, interval: Math.max(1, Number(e.target.value) || 1) })} />
              <Select className="w-32" value={recurrence.freq} onChange={(e) => setRecurrence({ ...recurrence, freq: e.target.value as TaskRecurrence['freq'] })}>
                <option value="DAILY">ngày</option>
                <option value="WEEKLY">tuần</option>
                <option value="MONTHLY">tháng</option>
              </Select>
              đến hết
              <Input type="date" className="w-40" value={recurrence.until ?? ''} onChange={(e) => setRecurrence({ ...recurrence, until: e.target.value || null })} />
              <span className="text-xs text-[var(--muted-foreground)]">(trống = không giới hạn)</span>
            </div>
          ) : null}
        </div>
        <div className="md:col-span-2">
          <FilePicker files={files} onChange={setFiles} label="Đính kèm tài liệu tham khảo" />
        </div>
      </div>
    </Dialog>
  );
}
