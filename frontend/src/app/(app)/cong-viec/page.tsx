'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CheckCircle2, ClipboardCheck, Hourglass, Inbox, ListTodo, Plus, Send, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { DueBadge, PriorityBadge, TaskStatusBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { taskKeys, tasksApi, type TaskRow } from '@/lib/tasks';

function TaskMiniList({ items, empty }: { items: TaskRow[]; empty: string }) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/cong-viec/${t.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--muted)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{t.code}</span>
                <PriorityBadge priority={t.priority} compact />
                {t.projectName ? <span className="truncate text-[11px] text-[var(--muted-foreground)]">· {t.projectName}</span> : null}
              </div>
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                {t.assignerName ? `Giao bởi ${t.assignerName}` : ''}{t.assigneeName ? ` → ${t.assigneeName}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <TaskStatusBadge status={t.status} />
              <DueBadge dueAt={t.dueAt} status={t.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function TaskOverviewPage() {
  const [creating, setCreating] = useState(false);
  const summary = useQuery({ queryKey: taskKeys.summary, queryFn: tasksApi.summary });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const c = summary.data?.counts ?? {};
  const n = (v?: number) => (summary.isLoading ? '…' : (v ?? 0));

  return (
    <div>
      <PageHeader
        title="Quản lý công việc"
        description="Giao việc, theo dõi tiến độ, duyệt kết quả và nhận nhắc hạn qua thông báo/Telegram."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Giao việc mới</Button>}
      />
      <TaskSubnav />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/cong-viec/danh-sach?view=mine&status=ASSIGNED"><StatCard label="Chờ tôi nhận" value={n(c.myToAccept)} tone="primary" icon={<Inbox className="size-4" />} hint="Việc mới được giao" /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=ACCEPTED,IN_PROGRESS,RETURNED"><StatCard label="Tôi đang làm" value={n(c.myInProgress)} tone="success" icon={<ListTodo className="size-4" />} hint={c.myReturned ? `${c.myReturned} việc bị trả lại` : 'Đã nhận / đang thực hiện'} /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&due=overdue"><StatCard label="Tôi quá hạn" value={n(c.myOverdue)} tone="danger" icon={<AlarmClock className="size-4" />} hint={`${c.myDueToday ?? 0} việc đến hạn hôm nay`} /></Link>
        <Link href="/cong-viec/danh-sach?view=review&status=SUBMITTED"><StatCard label="Chờ tôi duyệt" value={n(c.toReview)} tone="warning" icon={<ClipboardCheck className="size-4" />} hint="Kết quả đã gửi lên" /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=SUBMITTED"><StatCard label="Tôi đã gửi duyệt" value={n(c.mySubmitted)} icon={<Send className="size-4" />} /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=DONE"><StatCard label="Hoàn thành tháng này" value={n(c.myDoneThisMonth)} tone="success" icon={<CheckCircle2 className="size-4" />} /></Link>
        <Link href="/cong-viec/danh-sach?view=assigned"><StatCard label="Tôi đã giao (đang mở)" value={n(c.assignedOpen)} tone="primary" icon={<Hourglass className="size-4" />} /></Link>
        <Link href="/cong-viec/danh-sach?view=assigned&due=overdue"><StatCard label="Tôi giao — quá hạn" value={n(c.assignedOverdue)} tone="danger" icon={<Undo2 className="size-4" />} /></Link>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Quá hạn của tôi" description="Ưu tiên xử lý ngay" actions={<Link className="text-xs text-[var(--primary)]" href="/cong-viec/danh-sach?view=mine&due=overdue">Xem tất cả</Link>} />
          {summary.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <TaskMiniList items={summary.data?.overdue ?? []} empty="Không có việc quá hạn 🎉" />}
        </Card>
        <Card>
          <CardHeader title="Việc của tôi sắp đến hạn" actions={<Link className="text-xs text-[var(--primary)]" href="/cong-viec/danh-sach?view=mine">Xem tất cả</Link>} />
          {summary.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <TaskMiniList items={summary.data?.upcoming ?? []} empty="Chưa có việc đang mở" />}
        </Card>
        <Card>
          <CardHeader title="Chờ tôi duyệt" actions={<Link className="text-xs text-[var(--primary)]" href="/cong-viec/danh-sach?view=review&status=SUBMITTED">Xem tất cả</Link>} />
          {summary.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <TaskMiniList items={summary.data?.review ?? []} empty="Không có kết quả chờ duyệt" />}
        </Card>
      </div>

      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
