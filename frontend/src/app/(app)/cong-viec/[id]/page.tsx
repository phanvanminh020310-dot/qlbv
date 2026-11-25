'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckSquare,
  Clock,
  Download,
  Eye,
  FileText,
  GitBranch,
  History,
  Link2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Repeat,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, DueBadge, Field, FilePicker, PriorityBadge, ProgressBar, TaskStatusBadge, UserPicker } from '@/components/tasks/task-ui';
import { TransitionDialog, instantAction, useTransition } from '@/components/tasks/transition-dialog';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { downloadFile, openFileUrl } from '@/lib/api';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import {
  ACTION_META,
  TASK_PRINT_DOCS,
  filesToPayload,
  fmtDate,
  fmtDateTime,
  fmtShort,
  formatBytes,
  printTaskDocument,
  taskKeys,
  tasksApi,
  todayVN,
  type TaskAction,
  type TaskAttachment,
  type TaskDetail,
} from '@/lib/tasks';

const RECUR_LABEL = { DAILY: 'ngày', WEEKLY: 'tuần', MONTHLY: 'tháng' } as const;

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [pending, setPending] = useState<TaskAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState('chat');

  const detail = useQuery({ queryKey: taskKeys.detail(id), queryFn: () => tasksApi.detail(id), enabled: Number.isFinite(id) });
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.all });
  const transition = useTransition();

  const follow = useMutation({
    mutationFn: (on: boolean) => tasksApi.follow(id, on),
    onSuccess: (_d, on) => { toast.success(on ? 'Đã theo dõi công việc' : 'Đã bỏ theo dõi'); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => tasksApi.remove(id),
    onSuccess: () => { toast.success('Đã xoá công việc'); void invalidate(); router.push('/cong-viec/danh-sach'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (detail.isError || !detail.data) {
    return <EmptyState title="Không mở được công việc" description={(detail.error as Error | null)?.message ?? 'Công việc không tồn tại hoặc bạn không có quyền xem.'} action={<Link href="/cong-viec/danh-sach"><Button variant="outline"><ArrowLeft /> Về danh sách</Button></Link>} />;
  }
  const t = detail.data;
  const v = t.viewer;
  const run = (a: TaskAction) => (instantAction(a) ? transition.mutate({ id, action: a }) : setPending(a));
  const canPrint = meta.data?.permissions.canPrint;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <span className="flex flex-wrap items-center gap-1">
            <Link href="/cong-viec" className="hover:underline">Công việc</Link>
            {t.projectId ? <>/<Link href={`/cong-viec/du-an/${t.projectId}`} className="hover:underline">{t.projectName}</Link></> : null}
            {t.parent ? <>/<Link href={`/cong-viec/${t.parent.id}`} className="hover:underline">{t.parent.code}</Link></> : null}
            /<span className="font-mono">{t.code}</span>
          </span>
        }
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <TaskStatusBadge status={t.status} label={t.statusLabel} />
            <PriorityBadge priority={t.priority} />
            <DueBadge dueAt={t.dueAt} status={t.status} />
            {t.recurrence ? <Badge tone="info"><Repeat className="size-3" /> Lặp mỗi {t.recurrence.interval > 1 ? `${t.recurrence.interval} ` : ''}{RECUR_LABEL[t.recurrence.freq]}</Badge> : null}
            {t.returnCount ? <Badge tone="warning">Bị trả lại {t.returnCount} lần</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => follow.mutate(!v.isWatching)} loading={follow.isPending} title="Nhận thông báo khi công việc thay đổi">
              {v.isWatching ? <><BellOff /> Bỏ theo dõi</> : <><Bell /> Theo dõi</>}
            </Button>
            {canPrint ? (
              <Button variant="outline" size="sm" onClick={() => printTaskDocument(TASK_PRINT_DOCS.slip, { cong_viec_id: t.id }, t.departmentId).catch((e: Error) => toast.error(e.message))}>
                <Printer /> In phiếu giao việc
              </Button>
            ) : null}
            {v.canEdit ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Sửa</Button> : null}
            {v.canDelete ? <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 /> Xoá</Button> : null}
          </>
        }
      />

      {v.allowedActions.length ? (
        <Card className="mb-4 flex flex-wrap items-center gap-2 border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/30">
          <span className="mr-1 text-sm font-medium">Thao tác:</span>
          {v.allowedActions.map((a) => (
            <Button key={a} size="sm" variant={ACTION_META[a].variant} loading={transition.isPending && transition.variables?.action === a} onClick={() => run(a)}>
              {ACTION_META[a].label}
            </Button>
          ))}
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">{actionHint(t)}</span>
        </Card>
      ) : null}

      {t.statusReason && ['DECLINED', 'ON_HOLD', 'RETURNED', 'CANCELLED'].includes(t.status) ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <b>Lý do {t.statusLabel.toLowerCase()}:</b> {t.statusReason}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Nội dung yêu cầu" />
            <CardBody>
              {t.description ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</div> : <p className="text-sm text-[var(--muted-foreground)]">Không có mô tả.</p>}
              <AttachmentList taskId={id} files={t.attachments.filter((a) => a.kind === 'REFERENCE')} className="mt-3" />
            </CardBody>
          </Card>

          {t.resultContent || t.attachments.some((a) => a.kind === 'RESULT') ? (
            <Card className="border-emerald-200 dark:border-emerald-900">
              <CardHeader title={`Kết quả thực hiện${t.submissionCount > 1 ? ` (lần gửi thứ ${t.submissionCount})` : ''}`} description={t.submittedAt ? `Gửi lúc ${fmtDateTime(t.submittedAt)}` : undefined} />
              <CardBody>
                {t.resultContent ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{t.resultContent}</div> : null}
                <AttachmentList taskId={id} files={t.attachments.filter((a) => a.kind === 'RESULT')} grouped className="mt-3" />
              </CardBody>
            </Card>
          ) : null}

          <Card className="p-3">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: 'chat', label: 'Trao đổi', icon: <MessageSquare className="size-4" />, badge: t.commentCount || undefined, content: <CommentsTab task={t} /> },
                { key: 'check', label: 'Danh mục kiểm tra', icon: <CheckSquare className="size-4" />, badge: t.checklistTotal ? `${t.checklistDone}/${t.checklistTotal}` : undefined, content: <ChecklistTab task={t} /> },
                {
                  key: 'sub',
                  label: 'Việc con',
                  icon: <GitBranch className="size-4" />,
                  badge: t.subtaskTotal ? `${t.subtaskDone}/${t.subtaskTotal}` : undefined,
                  content: <SubtasksTab task={t} onAdd={() => setAddingSub(true)} />,
                },
                { key: 'files', label: 'Tệp', icon: <Paperclip className="size-4" />, badge: t.attachments.length || undefined, content: <FilesTab task={t} /> },
                { key: 'work', label: 'Giờ công', icon: <Clock className="size-4" />, content: <WorklogTab task={t} /> },
                { key: 'log', label: 'Lịch sử', icon: <History className="size-4" />, content: <HistoryTab taskId={id} /> },
              ]}
            />
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Thông tin" />
            <CardBody className="space-y-3 text-sm">
              <Person label="Người thực hiện" name={t.assigneeName} />
              <Person label="Người giao" name={t.assignerName} />
              <Person label="Người duyệt" name={t.reviewerName ?? t.assignerName} hint={t.reviewerName ? undefined : '(người giao)'} />
              <Info label="Khoa/phòng">{t.departmentName ?? '—'}</Info>
              <Info label="Dự án">{t.projectId ? <Link className="text-[var(--primary)] hover:underline" href={`/cong-viec/du-an/${t.projectId}`}>{t.projectCode} · {t.projectName}</Link> : '—'}</Info>
              <Info label="Bắt đầu">{fmtDate(t.startDate) || '—'}</Info>
              <Info label="Hạn chót">{t.dueAt ? fmtDateTime(t.dueAt) : 'Không đặt hạn'}</Info>
              {t.estimateHours ? <Info label="Ước lượng">{Number(t.estimateHours)} giờ</Info> : null}
              {t.labels.length ? <Info label="Nhãn"><span className="flex flex-wrap gap-1">{t.labels.map((l) => <Badge key={l} tone="info">#{l}</Badge>)}</span></Info> : null}
              <ProgressEditor task={t} />
              <div className="border-t pt-2 text-xs text-[var(--muted-foreground)]">
                <div>Tạo lúc {fmtDateTime(t.createdAt)}</div>
                {t.acceptedAt ? <div>Nhận việc {fmtDateTime(t.acceptedAt)}</div> : null}
                {t.startedAt ? <div>Bắt đầu làm {fmtDateTime(t.startedAt)}</div> : null}
                {t.completedAt ? <div className={cn(t.late && 'text-orange-600')}>Hoàn thành {fmtDateTime(t.completedAt)}{t.late ? ' (trễ hạn)' : ''}</div> : null}
              </div>
            </CardBody>
          </Card>
          <WatchersCard task={t} />
          <DependenciesCard task={t} />
        </aside>
      </div>

      <TransitionDialog taskId={pending ? id : null} action={pending} title={`${t.code} · ${t.title}`} onClose={() => setPending(null)} />
      {editing ? <TaskFormDialog open task={t} onClose={() => setEditing(false)} onSaved={() => undefined} /> : null}
      {addingSub ? (
        <TaskFormDialog
          open
          onClose={() => setAddingSub(false)}
          parentLabel={`${t.code} · ${t.title}`}
          defaults={{ parentId: t.id, projectId: t.projectId, departmentId: t.departmentId, priority: t.priority }}
          onSaved={() => setTab('sub')}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Xoá công việc?"
        message={`${t.code} sẽ bị xoá khỏi danh sách (vẫn lưu nhật ký).`}
        confirmText="Xoá"
        loading={remove.isPending}
      />
    </div>
  );
}

function actionHint(t: TaskDetail): string {
  const v = t.viewer;
  if (t.status === 'ASSIGNED' && v.isAssignee) return 'Bạn được giao việc này — hãy nhận hoặc từ chối (kèm lý do).';
  if (t.status === 'SUBMITTED' && (v.isReviewer || v.isAssigner)) return 'Kết quả đang chờ bạn duyệt.';
  if (t.status === 'RETURNED' && v.isAssignee) return 'Việc bị trả lại — xem lý do, chỉnh sửa rồi gửi duyệt lại.';
  if (['ACCEPTED', 'IN_PROGRESS'].includes(t.status) && v.isAssignee) return 'Gửi duyệt cần nội dung kết quả hoặc tệp, và các việc con đã đóng.';
  return '';
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
function Person({ label, name, hint }: { label: string; name: string | null; hint?: string }) {
  return (
    <Info label={label}>
      {name ? <span className="inline-flex items-center gap-1.5"><Avatar name={name} size={22} />{name} {hint ? <span className="text-xs text-[var(--muted-foreground)]">{hint}</span> : null}</span> : '—'}
    </Info>
  );
}

/* --------------------------------------------------------------------- Tiến độ */
function ProgressEditor({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(task.progress);
  useEffect(() => setVal(task.progress), [task.progress]);
  const save = useMutation({
    mutationFn: (p: number) => tasksApi.update(task.id, { progress: p }),
    onSuccess: () => { toast.success('Đã cập nhật tiến độ'); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => { toast.error(e.message); setVal(task.progress); },
  });
  const editable = task.viewer.canUpdateProgress && !task.checklistTotal;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[var(--muted-foreground)]">Tiến độ</span>
        <span className="font-semibold">{val}%</span>
      </div>
      {editable ? (
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          onPointerUp={() => val !== task.progress && save.mutate(val)}
          onKeyUp={() => val !== task.progress && save.mutate(val)}
          className="w-full accent-teal-700"
        />
      ) : (
        <ProgressBar value={val} />
      )}
      {task.checklistTotal ? <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">Tự tính theo danh mục kiểm tra ({task.checklistDone}/{task.checklistTotal})</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Tệp đính kèm */
function AttachmentList({ taskId, files, grouped, className }: { taskId: number; files: TaskAttachment[]; grouped?: boolean; className?: string }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (aid: number) => tasksApi.deleteAttachment(taskId, aid),
    onSuccess: () => { toast.success('Đã xoá tệp'); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!files.length) return null;
  const groups = grouped ? [...new Set(files.map((f) => f.submissionNo))].sort((a, b) => b - a) : [null];
  return (
    <div className={cn('space-y-2', className)}>
      {groups.map((g) => (
        <div key={String(g)}>
          {grouped && groups.length > 1 ? <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Lần gửi {g}</div> : null}
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {files.filter((f) => g === null || f.submissionNo === g).map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
                <FileText className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate" title={f.fileName}>{f.fileName}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">{formatBytes(f.sizeBytes)} · {f.fullName} · {fmtShort(f.createdAt)}</div>
                </div>
                <button type="button" className="rounded p-1 hover:bg-[var(--muted)]" title="Xem" onClick={() => openFileUrl(tasksApi.attachmentUrl(taskId, f.id))}><Eye className="size-4" /></button>
                <button type="button" className="rounded p-1 hover:bg-[var(--muted)]" title="Tải về" onClick={() => downloadFile(`/tasks/${taskId}/attachments/${f.id}`, f.fileName).catch((e: Error) => toast.error(e.message))}><Download className="size-4" /></button>
                {f.canDelete ? <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" title="Xoá" onClick={() => confirm(`Xoá tệp “${f.fileName}”?`) && del.mutate(f.id)}><Trash2 className="size-4" /></button> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FilesTab({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const upload = useMutation({
    mutationFn: async () => tasksApi.upload(task.id, await filesToPayload(files)),
    onSuccess: () => { toast.success('Đã tải tệp lên'); setFiles([]); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sections: Array<[string, TaskAttachment['kind']]> = [['Tài liệu tham khảo', 'REFERENCE'], ['Tệp kết quả', 'RESULT'], ['Tệp trong trao đổi', 'COMMENT']];
  return (
    <div className="space-y-4">
      {task.viewer.canUpload ? (
        <div className="rounded-lg border border-dashed p-3">
          <FilePicker files={files} onChange={setFiles} label="Thêm tài liệu (ảnh, PDF, Word, Excel, PowerPoint… tối đa 15MB/tệp)" />
          {files.length ? <Button className="mt-2" size="sm" loading={upload.isPending} onClick={() => upload.mutate()}>Tải lên {files.length} tệp</Button> : null}
        </div>
      ) : null}
      {sections.map(([label, kind]) => {
        const list = task.attachments.filter((a) => a.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind}>
            <div className="mb-1.5 text-sm font-medium">{label} ({list.length})</div>
            <AttachmentList taskId={task.id} files={list} grouped={kind === 'RESULT'} />
          </div>
        );
      })}
      {!task.attachments.length ? <EmptyState title="Chưa có tệp nào" /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- Trao đổi */
function renderMentions(text: string) {
  return text.split(/(@[A-Za-z0-9_.-]{2,64})/g).map((part, i) => (part.startsWith('@') ? <b key={i} className="text-[var(--primary)]">{part}</b> : part));
}

function CommentsTab({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const comments = useQuery({ queryKey: taskKeys.comments(task.id), queryFn: () => tasksApi.comments(task.id) });
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [comments.data?.length]);
  const send = useMutation({
    mutationFn: async () => tasksApi.addComment(task.id, { content: text.trim(), files: files.length ? await filesToPayload(files) : undefined }),
    onSuccess: () => { setText(''); setFiles([]); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const del = useMutation({
    mutationFn: (cid: number) => tasksApi.deleteComment(task.id, cid),
    onSuccess: () => { setConfirmDel(null); toast.success('Đã xóa tin nhắn'); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const edit = useMutation({
    mutationFn: (v: { id: number; text: string }) => tasksApi.editComment(task.id, v.id, v.text.trim()),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: taskKeys.comments(task.id) }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const suggestions = useMemo(() => {
    if (mentionQ === null) return [];
    const q = mentionQ.toLowerCase();
    return task.participants.filter((p) => p.username.toLowerCase().includes(q) || p.fullName.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQ, task.participants]);
  const onType = (value: string) => {
    setText(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const m = /@([A-Za-z0-9_.-]*)$/.exec(value.slice(0, caret));
    setMentionQ(m ? m[1]! : null);
  };
  const pick = (username: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([A-Za-z0-9_.-]*)$/, `@${username} `);
    setText(before + text.slice(caret));
    setMentionQ(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };

  return (
    <div>
      <div className="thin-scroll max-h-[28rem] space-y-3 overflow-y-auto pr-1">
        {comments.isLoading ? <Skeleton className="h-16" /> : null}
        {comments.data?.length === 0 ? <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">Chưa có trao đổi. Gõ @tên_đăng_nhập để nhắc người liên quan.</p> : null}
        {comments.data?.map((c) => (
          <div key={c.id} className={cn('group flex gap-2', c.mine && 'flex-row-reverse')}>
            <Avatar name={c.fullName} size={28} />
            <div className={cn('max-w-[80%] rounded-xl px-3 py-2 text-sm', c.mine ? 'bg-teal-700 text-white' : 'bg-[var(--muted)]')}>
              <div className={cn('mb-0.5 flex items-center gap-2 text-[11px]', c.mine ? 'text-teal-100' : 'text-[var(--muted-foreground)]')}>
                <b>{c.fullName}</b> {fmtShort(c.createdAt)}
                {c.edited ? <span className="italic" title={`Sửa lúc ${fmtShort(c.updatedAt)}`}>(đã sửa)</span> : null}
                {editing?.id !== c.id && (c.canEdit || c.canDelete) ? (
                  <span className="ml-auto flex items-center gap-1.5 opacity-70 transition-opacity hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    {c.canEdit ? (
                      <button type="button" title="Sửa tin nhắn" aria-label="Sửa tin nhắn" className="p-0.5" onClick={() => setEditing({ id: c.id, text: c.content })}><Pencil className="size-3" /></button>
                    ) : null}
                    {c.canDelete ? (
                      <button type="button" title="Xóa tin nhắn" aria-label="Xóa tin nhắn" className="p-0.5" onClick={() => setConfirmDel(c.id)}><Trash2 className="size-3" /></button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {editing?.id === c.id ? (
                <div className="mt-1 min-w-[16rem] space-y-1.5">
                  <Textarea
                    autoFocus
                    rows={3}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) edit.mutate(editing);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="bg-[var(--card)] text-[var(--foreground)]"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Hủy</Button>
                    <Button size="sm" loading={edit.isPending} disabled={!editing.text.trim() && !c.files.length} onClick={() => edit.mutate(editing)}>Lưu</Button>
                  </div>
                </div>
              ) : c.content ? <div className="whitespace-pre-wrap break-words">{c.mine ? c.content : renderMentions(c.content)}</div> : null}
              {c.files.map((f) => (
                <button key={f.id} type="button" onClick={() => openFileUrl(tasksApi.attachmentUrl(task.id, f.id))} className={cn('mt-1 flex items-center gap-1 text-xs underline', c.mine ? 'text-teal-50' : 'text-[var(--primary)]')}>
                  <Paperclip className="size-3" /> {f.fileName} ({formatBytes(f.sizeBytes)})
                </button>
              ))}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ConfirmDialog
        open={confirmDel !== null}
        title="Xóa tin nhắn"
        message="Tin nhắn và tệp đính kèm trong tin nhắn sẽ bị ẩn khỏi cuộc trao đổi. Việc xóa được ghi vào lịch sử công việc."
        confirmText="Xóa"
        onConfirm={() => { if (confirmDel !== null) del.mutate(confirmDel); }}
        onClose={() => setConfirmDel(null)}
      />
      <div className="relative mt-3 space-y-2 border-t pt-3">
        {suggestions.length ? (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-lg border bg-[var(--card)] p-1 shadow-lg">
            {suggestions.map((p) => (
              <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p.username); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--muted)]">
                <Avatar name={p.fullName} size={20} /> {p.fullName} <span className="text-xs text-[var(--muted-foreground)]">@{p.username}</span>
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (text.trim() || files.length)) send.mutate();
            if (e.key === 'Escape') setMentionQ(null);
          }}
          placeholder="Nhập trao đổi… (@ để nhắc tên, Ctrl+Enter để gửi)"
        />
        <div className="flex items-start gap-2">
          <div className="flex-1"><FilePicker files={files} onChange={setFiles} compact /></div>
          <Button size="sm" loading={send.isPending} disabled={!text.trim() && !files.length} onClick={() => send.mutate()}><Send /> Gửi</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Danh mục kiểm tra */
function ChecklistTab({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const done = () => void qc.invalidateQueries({ queryKey: taskKeys.all });
  const err = (e: Error) => toast.error(e.message);
  const add = useMutation({ mutationFn: () => tasksApi.addChecklist(task.id, text.trim()), onSuccess: () => { setText(''); done(); }, onError: err });
  const toggle = useMutation({ mutationFn: (p: { itemId: number; done: boolean }) => tasksApi.updateChecklist(task.id, p.itemId, { done: p.done }), onSuccess: done, onError: err });
  const del = useMutation({ mutationFn: (itemId: number) => tasksApi.deleteChecklist(task.id, itemId), onSuccess: done, onError: err });
  const can = task.viewer.canChecklist;
  return (
    <div className="space-y-2">
      {task.checklistTotal ? <ProgressBar value={Math.round((task.checklistDone / task.checklistTotal) * 100)} /> : null}
      <ul className="divide-y rounded-lg border">
        {task.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
            <input type="checkbox" className="size-4 accent-teal-700" checked={c.done} disabled={!can} onChange={(e) => toggle.mutate({ itemId: c.id, done: e.target.checked })} />
            <span className={cn('flex-1', c.done && 'text-[var(--muted-foreground)] line-through')}>{c.content}</span>
            {c.doneAt ? <span className="text-[11px] text-[var(--muted-foreground)]">{fmtShort(c.doneAt)}</span> : null}
            {can ? <button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => del.mutate(c.id)}><Trash2 className="size-3.5 text-red-600" /></button> : null}
          </li>
        ))}
        {!task.checklist.length ? <li className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Chưa có mục kiểm tra</li> : null}
      </ul>
      {can ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Thêm mục cần làm…" />
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}><Plus /> Thêm</Button>
        </form>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------- Việc con */
function SubtasksTab({ task, onAdd }: { task: TaskDetail; onAdd: () => void }) {
  return (
    <div className="space-y-2">
      {task.viewer.canAddSubtask ? <Button size="sm" variant="outline" onClick={onAdd}><Plus /> Thêm việc con</Button> : null}
      {task.subtasks.length ? (
        <ul className="divide-y rounded-lg border">
          {task.subtasks.map((s) => (
            <li key={s.id}>
              <Link href={`/cong-viec/${s.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--muted)]">
                <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.code}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">{s.assigneeName}</span>
                <DueBadge dueAt={s.dueAt} status={s.status} />
                <TaskStatusBadge status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">Chưa có việc con. Việc cha chỉ gửi duyệt được khi mọi việc con đã đóng.</p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- Giờ công */
function WorklogTab({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const logs = useQuery({ queryKey: taskKeys.worklogs(task.id), queryFn: () => tasksApi.worklogs(task.id) });
  const [form, setForm] = useState({ workDate: todayVN(), hours: '1', content: '' });
  const add = useMutation({
    mutationFn: () => tasksApi.addWorklog(task.id, { workDate: form.workDate, hours: Number(form.hours), content: form.content.trim() }),
    onSuccess: () => { toast.success('Đã ghi giờ công'); setForm((f) => ({ ...f, content: '' })); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (wid: number) => tasksApi.deleteWorklog(task.id, wid),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.all }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Tổng: <b>{logs.data?.totalHours ?? 0} giờ</b></span>
        {task.estimateHours ? <span className="text-[var(--muted-foreground)]">/ ước lượng {Number(task.estimateHours)} giờ</span> : null}
      </div>
      {task.viewer.canWorklog ? (
        <form className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[150px_100px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Ngày"><Input type="date" value={form.workDate} max={todayVN()} onChange={(e) => setForm({ ...form, workDate: e.target.value })} /></Field>
          <Field label="Số giờ"><Input type="number" min={0.25} max={24} step={0.25} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></Field>
          <Field label="Nội dung"><Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Đã làm gì…" /></Field>
          <Button type="submit" className="self-end" loading={add.isPending} disabled={!form.content.trim() || !(Number(form.hours) > 0)}><Plus /> Ghi</Button>
        </form>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {logs.data?.items.map((w) => (
          <li key={w.id} className="group flex items-start gap-3 px-3 py-2 text-sm">
            <span className="w-20 shrink-0 text-xs text-[var(--muted-foreground)]">{fmtDate(w.workDate)}</span>
            <b className="w-14 shrink-0">{w.hours} giờ</b>
            <span className="flex-1">{w.content}<span className="ml-2 text-xs text-[var(--muted-foreground)]">— {w.fullName}</span></span>
            {w.mine || task.viewer.isManager ? <button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => del.mutate(w.id)}><Trash2 className="size-3.5 text-red-600" /></button> : null}
          </li>
        ))}
        {logs.data && !logs.data.items.length ? <li className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Chưa ghi giờ công</li> : null}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ Lịch sử */
function fmtChange(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtShort(v);
  if (Array.isArray(v)) return v.join(', ') || '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function HistoryTab({ taskId }: { taskId: number }) {
  const h = useQuery({ queryKey: taskKeys.history(taskId), queryFn: () => tasksApi.history(taskId) });
  if (h.isLoading) return <Skeleton className="h-24" />;
  const logs = h.data?.logs ?? [];
  return (
    <ol className="relative ml-2 space-y-3 border-l pl-4">
      {logs.map((l) => (
        <li key={l.id} className="text-sm">
          <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-teal-600" />
          <div className="flex flex-wrap items-center gap-1.5">
            <b>{l.fullName}</b>
            <span className="text-[var(--muted-foreground)]">{ACTION_LOG_LABEL[l.action] ?? l.action}</span>
            {l.fromStatus !== l.toStatus ? <span className="text-xs">{l.fromLabel} → <b>{l.toLabel}</b></span> : null}
            <span className="text-[11px] text-[var(--muted-foreground)]">{fmtDateTime(l.createdAt)}</span>
          </div>
          {l.note ? <div className="mt-0.5 whitespace-pre-wrap text-[var(--muted-foreground)]">{l.note}</div> : null}
          {l.changes ? (
            <ul className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {Object.entries(l.changes).map(([k, [a, b]]) => <li key={k}>{k}: {fmtChange(a)} → <b>{fmtChange(b)}</b></li>)}
            </ul>
          ) : null}
        </li>
      ))}
      {!logs.length ? <li className="text-sm text-[var(--muted-foreground)]">Chưa có lịch sử</li> : null}
    </ol>
  );
}

const ACTION_LOG_LABEL: Record<string, string> = {
  CREATE: 'giao việc',
  CREATE_DRAFT: 'lưu nháp',
  UPDATE: 'cập nhật',
  REASSIGN: 'giao lại',
  RECUR: 'tạo kỳ lặp tiếp theo',
  COMMENT: 'trao đổi',
  COMMENT_DELETE: 'xoá tin nhắn',
  COMMENT_EDIT: 'sửa tin nhắn',
  ATTACHMENT: 'đính kèm tệp',
  ATTACHMENT_DELETE: 'xoá tệp',
  WORKLOG: 'ghi giờ công',
  WORKLOG_DELETE: 'xoá giờ công',
  CHECKLIST: 'cập nhật danh mục',
  CHECKLIST_ADD: 'thêm mục kiểm tra',
  CHECKLIST_DELETE: 'xoá mục kiểm tra',
  WATCHERS: 'đổi người theo dõi',
  FOLLOW: 'theo dõi',
  UNFOLLOW: 'bỏ theo dõi',
  DEPENDENCIES: 'đổi việc tiên quyết',
  DELETE: 'xoá',
  ...Object.fromEntries(Object.entries(ACTION_META).map(([k, m]) => [k.toUpperCase(), m.label.toLowerCase()])),
};

/* ------------------------------------------------------------------- Theo dõi */
function WatchersCard({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [ids, setIds] = useState<number[]>(task.watchers.map((w) => w.id));
  useEffect(() => setIds(task.watchers.map((w) => w.id)), [task.watchers]);
  const save = useMutation({
    mutationFn: () => tasksApi.setWatchers(task.id, ids),
    onSuccess: () => { toast.success('Đã cập nhật người theo dõi'); setEdit(false); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const canEdit = task.viewer.isManager;
  return (
    <Card>
      <CardHeader title={`Người theo dõi (${task.watchers.length})`} actions={canEdit && !edit ? <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil /></Button> : null} />
      <CardBody className="text-sm">
        {edit ? (
          <div className="space-y-2">
            <UserPicker value={ids} onChange={setIds} multiple projectId={task.projectId} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit(false)}>Huỷ</Button>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
            </div>
          </div>
        ) : task.watchers.length ? (
          <ul className="space-y-1.5">{task.watchers.map((w) => <li key={w.id} className="flex items-center gap-2"><Avatar name={w.fullName} size={22} />{w.fullName}</li>)}</ul>
        ) : (
          <p className="text-[var(--muted-foreground)]">Chưa có. Người theo dõi nhận thông báo mọi thay đổi.</p>
        )}
      </CardBody>
    </Card>
  );
}

/* --------------------------------------------------------------- Việc tiên quyết */
function DependenciesCard({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const canEdit = task.viewer.isManager;
  const search = useQuery({
    queryKey: ['tasks', 'dep-search', q],
    queryFn: () => tasksApi.list({ q, pageSize: '8', sort: 'updated' }),
    enabled: canEdit && q.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: (ids: number[]) => tasksApi.setDependencies(task.id, ids),
    onSuccess: () => { setQ(''); void qc.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ids = task.dependencies.map((d) => d.id);
  if (!canEdit && !task.dependencies.length && !task.dependents.length) return null;
  return (
    <Card>
      <CardHeader title="Liên kết công việc" />
      <CardBody className="space-y-3 text-sm">
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Cần hoàn thành trước</div>
          {task.dependencies.length ? (
            <ul className="space-y-1">
              {task.dependencies.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <Link2 className="size-3.5 text-[var(--muted-foreground)]" />
                  <Link href={`/cong-viec/${d.id}`} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono text-[11px]">{d.code}</span> {d.title}</Link>
                  <TaskStatusBadge status={d.status} />
                  {canEdit ? <button type="button" onClick={() => save.mutate(ids.filter((x) => x !== d.id))}><X className="size-3.5" /></button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-[var(--muted-foreground)]">Không có</p>}
          {canEdit ? (
            <div className="relative mt-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã/tiêu đề để thêm…" />
              {search.data?.items.length ? (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-[var(--card)] p-1 shadow-lg">
                  {search.data.items.filter((x) => x.id !== task.id && !ids.includes(x.id)).map((x) => (
                    <button key={x.id} type="button" onClick={() => save.mutate([...ids, x.id])} className="block w-full truncate rounded px-2 py-1 text-left hover:bg-[var(--muted)]">
                      <span className="font-mono text-[11px]">{x.code}</span> {x.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {task.dependents.length ? (
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Đang chờ việc này</div>
            <ul className="space-y-1">
              {task.dependents.map((d) => (
                <li key={d.id}><Link href={`/cong-viec/${d.id}`} className="hover:underline"><span className="font-mono text-[11px]">{d.code}</span> {d.title}</Link></li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
