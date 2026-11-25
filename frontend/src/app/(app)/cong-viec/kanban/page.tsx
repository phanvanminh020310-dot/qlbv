'use client';

import { useQuery } from '@tanstack/react-query';
import { GripVertical, MessageSquare, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, DueBadge, PriorityBadge, ProgressBar, TaskStatusBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { TransitionDialog, instantAction, useTransition } from '@/components/tasks/transition-dialog';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { ACTION_META, KANBAN_COLUMNS, actionForMove, taskKeys, tasksApi, type TaskAction, type TaskRow, type TaskStatus } from '@/lib/tasks';

export default function KanbanPage() {
  const [view, setView] = useState('mine');
  const [projectId, setProjectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<TaskRow | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [pending, setPending] = useState<{ task: TaskRow; action: TaskAction } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const query = { view, projectId, includeSubtasks: '1' };
  const board = useQuery({ queryKey: taskKeys.board(query), queryFn: () => tasksApi.board(query) });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const transition = useTransition();

  const columns = useMemo(() => {
    const items = board.data?.items ?? [];
    return KANBAN_COLUMNS.map((c) => ({ ...c, items: items.filter((t) => c.statuses.includes(t.status)) }));
  }, [board.data]);

  const run = (task: TaskRow, action: TaskAction) => {
    if (instantAction(action)) transition.mutate({ id: task.id, action });
    else setPending({ task, action });
  };

  const drop = (target: TaskStatus | undefined) => {
    const task = dragging;
    setDragging(null);
    setOverCol(null);
    if (!task || !target) return;
    // Thả vào "Hoàn thành" từ cột chờ duyệt = duyệt; "Đang làm" từ chờ duyệt = trả lại
    let action = actionForMove(task.status, target);
    if (!action && target === 'IN_PROGRESS' && task.status === 'SUBMITTED') action = 'return';
    if (!action && target === 'ACCEPTED' && task.status === 'ASSIGNED') action = 'accept';
    if (!action) {
      if (KANBAN_COLUMNS.find((c) => c.drop === target)?.statuses.includes(task.status)) return;
      toast.warning(`Không thể chuyển “${task.statusLabel}” sang cột này. Dùng menu “Chuyển sang…” để xem thao tác hợp lệ.`);
      return;
    }
    run(task, action);
  };

  return (
    <div>
      <PageHeader
        title="Bảng Kanban"
        description="Kéo thả thẻ giữa các cột để nhận việc, bắt đầu, gửi duyệt, duyệt — hệ thống kiểm tra quyền và luồng hợp lệ."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Giao việc</Button>}
      />
      <TaskSubnav />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-44" value={view} onChange={(e) => setView(e.target.value)}>
          <option value="mine">Việc của tôi</option>
          <option value="assigned">Tôi giao</option>
          <option value="review">Tôi duyệt</option>
          <option value="watching">Tôi theo dõi</option>
          <option value="">Tất cả trong phạm vi</option>
        </Select>
        <Select className="w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Mọi dự án</option>
          {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </Select>
        {board.data?.truncated ? <span className="self-center text-xs text-amber-700">Chỉ hiển thị 500 việc đầu — hãy lọc thêm.</span> : null}
      </div>

      {board.isLoading ? (
        <div className="grid gap-3 md:grid-cols-5">{KANBAN_COLUMNS.map((c) => <Skeleton key={c.key} className="h-80" />)}</div>
      ) : (
        <div className="thin-scroll flex gap-3 overflow-x-auto pb-3">
          {columns.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); drop(col.drop); }}
              className={cn('flex w-72 shrink-0 flex-col rounded-xl border bg-[var(--muted)]/60 transition-colors', overCol === col.key && 'border-teal-600 bg-teal-50 dark:bg-teal-950/40')}
            >
              <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                {col.label}
                <span className="rounded-full bg-[var(--card)] px-2 text-xs font-medium text-[var(--muted-foreground)]">{col.items.length}</span>
              </div>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {col.items.map((t) => (
                  <Card key={t.id} className={cn('relative p-0 transition-shadow hover:shadow-md', dragging?.id === t.id && 'opacity-50', t.overdue && 'border-red-300')}>
                    <div draggable onDragStart={(e) => { setDragging(t); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(null); setOverCol(null); }} className="cursor-grab p-2.5 active:cursor-grabbing">
                      <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                        <GripVertical className="size-3" />
                        <span className="font-mono">{t.code}</span>
                        {t.projectName ? <span className="ml-1 inline-flex min-w-0 items-center gap-1 truncate"><span className="size-2 shrink-0 rounded-full" style={{ background: t.projectColor ?? '#0f766e' }} />{t.projectName}</span> : null}
                        <button type="button" className="ml-auto rounded p-0.5 hover:bg-[var(--muted)]" onClick={() => setMenu(menu === t.id ? null : t.id)} aria-label="Chuyển sang…">
                          <MoreHorizontal className="size-4" />
                        </button>
                      </div>
                      <Link href={`/cong-viec/${t.id}`} className="mt-1 line-clamp-3 block text-sm font-medium hover:underline">{t.title}</Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {col.statuses.length > 1 ? <TaskStatusBadge status={t.status} /> : null}
                        <PriorityBadge priority={t.priority} compact />
                        <DueBadge dueAt={t.dueAt} status={t.status} />
                      </div>
                      {t.progress > 0 && t.status !== 'DONE' ? <ProgressBar value={t.progress} className="mt-2" /> : null}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <Avatar name={t.assigneeName} size={20} />
                        <span className="min-w-0 flex-1 truncate">{t.assigneeName}</span>
                        {t.checklistTotal ? <span>☑ {t.checklistDone}/{t.checklistTotal}</span> : null}
                        {t.commentCount ? <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{t.commentCount}</span> : null}
                        {t.attachmentCount ? <span className="inline-flex items-center gap-0.5"><Paperclip className="size-3" />{t.attachmentCount}</span> : null}
                      </div>
                    </div>
                    {menu === t.id ? <MoveMenu task={t} onPick={(a) => { setMenu(null); run(t, a); }} onClose={() => setMenu(null)} /> : null}
                  </Card>
                ))}
                {col.items.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-center text-xs text-[var(--muted-foreground)]">Thả thẻ vào đây</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <TransitionDialog taskId={pending?.task.id ?? null} action={pending?.action ?? null} title={pending ? `${pending.task.code} · ${pending.task.title}` : ''} onClose={() => setPending(null)} />
      <TaskFormDialog open={creating} onClose={() => setCreating(false)} onSaved={() => undefined} />
    </div>
  );
}

/** Menu thao tác hợp lệ (lấy từ chi tiết công việc — đúng quyền của người dùng). */
function MoveMenu({ task, onPick, onClose }: { task: TaskRow; onPick: (a: TaskAction) => void; onClose: () => void }) {
  const detail = useQuery({ queryKey: taskKeys.detail(task.id), queryFn: () => tasksApi.detail(task.id) });
  const actions = detail.data?.viewer.allowedActions ?? [];
  return (
    <div className="absolute right-2 top-8 z-20 w-52 rounded-lg border bg-[var(--card)] p-1 shadow-lg" onMouseLeave={onClose}>
      <div className="px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">Chuyển sang…</div>
      {detail.isLoading ? <div className="px-2 py-1.5 text-xs">Đang tải…</div> : null}
      {!detail.isLoading && actions.length === 0 ? <div className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">Bạn không có thao tác nào với việc này</div> : null}
      {actions.map((a) => (
        <button key={a} type="button" onClick={() => onPick(a)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--muted)]">
          {ACTION_META[a].label}
        </button>
      ))}
    </div>
  );
}
