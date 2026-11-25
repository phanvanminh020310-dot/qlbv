'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, BarChart3, CheckCircle2, ClipboardCheck, Hourglass, Inbox, ListTodo, Plus, Send, Timer, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { DueBadge, PriorityBadge, TaskStatusBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { STATUS_COLOR, taskKeys, tasksApi, type TaskRow } from '@/lib/tasks';

const PRIORITY_COLOR: Record<string, string> = { LOW: '#94a3b8', NORMAL: '#0ea5e9', HIGH: '#f59e0b', URGENT: '#dc2626' };

function TaskMiniList({ items, empty, showAssignee }: { items: TaskRow[]; empty: string; showAssignee?: boolean }) {
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
                {showAssignee ? `Người làm: ${t.assigneeName ?? '—'} · ${t.progress}%` : `${t.assignerName ? `Giao bởi ${t.assignerName}` : ''}${t.assigneeName ? ` → ${t.assigneeName}` : ''}`}
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

function ListCard({ title, description, href, items, loading, empty, showAssignee }: { title: string; description?: string; href: string; items?: TaskRow[]; loading: boolean; empty: string; showAssignee?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={<Link className="text-xs text-[var(--primary)]" href={href}>Xem tất cả</Link>} />
      {loading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <TaskMiniList items={items ?? []} empty={empty} showAssignee={showAssignee} />}
    </Card>
  );
}

export default function TaskOverviewPage() {
  const [creating, setCreating] = useState(false);
  const summary = useQuery({ queryKey: taskKeys.summary, queryFn: tasksApi.summary });
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const c = summary.data?.counts ?? {};
  const st = summary.data?.stats;
  const n = (v?: number) => (summary.isLoading ? '…' : (v ?? 0));
  const statusData = (st?.byStatus ?? []).filter((s) => s.count > 0);
  const hasActivity = (st?.series ?? []).some((d) => d.assigned || d.done);
  const canAssign = meta.data?.permissions.canAssign;

  return (
    <div>
      <PageHeader
        title="Quản lý công việc"
        description="Giao việc, theo dõi tiến độ, duyệt kết quả và nhận nhắc hạn qua thông báo/Telegram."
        actions={
          <>
            {meta.data?.permissions.canReport ? <Link href="/cong-viec/bao-cao"><Button variant="outline"><BarChart3 /> Báo cáo đầy đủ</Button></Link> : null}
            <Button onClick={() => setCreating(true)}><Plus /> {canAssign ? 'Giao việc mới' : 'Tạo việc của tôi'}</Button>
          </>
        }
      />
      <TaskSubnav />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Link href="/cong-viec/danh-sach?view=mine&status=ASSIGNED"><StatCard label="Chờ tôi nhận" value={n(c.myToAccept)} tone="primary" icon={<Inbox className="size-4" />} hint={`${c.myOpen ?? 0} việc đang mở`} /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=ACCEPTED,IN_PROGRESS,RETURNED"><StatCard label="Tôi đang làm" value={n(c.myInProgress)} tone="success" icon={<ListTodo className="size-4" />} hint={c.myReturned ? `${c.myReturned} việc bị trả lại` : 'Đã nhận / đang thực hiện'} /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&due=overdue"><StatCard label="Tôi quá hạn" value={n(c.myOverdue)} tone="danger" icon={<AlarmClock className="size-4" />} hint={`${c.myDueToday ?? 0} việc đến hạn hôm nay`} /></Link>
        <Link href="/cong-viec/danh-sach?view=review&status=SUBMITTED"><StatCard label="Chờ tôi duyệt" value={n(c.toReview)} tone="warning" icon={<ClipboardCheck className="size-4" />} hint="Kết quả đã gửi lên" /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=SUBMITTED"><StatCard label="Tôi đã gửi duyệt" value={n(c.mySubmitted)} icon={<Send className="size-4" />} /></Link>
        <Link href="/cong-viec/danh-sach?view=mine&status=DONE"><StatCard label="Hoàn thành tháng này" value={n(c.myDoneThisMonth)} tone="success" icon={<CheckCircle2 className="size-4" />} /></Link>
        <StatCard
          label="Đúng hạn tháng này"
          value={summary.isLoading ? '…' : st?.onTimeRateMonth === null || st?.onTimeRateMonth === undefined ? '—' : `${Math.round(st.onTimeRateMonth * 1000) / 10}%`}
          tone="success"
          icon={<Timer className="size-4" />}
          hint="Trên các việc có hạn chót đã hoàn thành"
        />
        <Link href="/cong-viec/danh-sach?view=assigned"><StatCard label="Tôi đã giao (đang mở)" value={n(c.assignedOpen)} tone="primary" icon={<Hourglass className="size-4" />} /></Link>
        <Link href="/cong-viec/danh-sach?view=assigned&due=overdue"><StatCard label="Tôi giao — quá hạn" value={n(c.assignedOverdue)} tone="danger" icon={<Undo2 className="size-4" />} /></Link>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Việc của tôi — 30 ngày qua" description="Số việc được giao và hoàn thành theo ngày" />
          <CardBody className="h-64">
            {summary.isLoading ? <Skeleton className="h-full" /> : !hasActivity ? <EmptyState title="Chưa có hoạt động trong 30 ngày" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={st?.series ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="done" name="Hoàn thành" fill="#16a34a" />
                  <Bar dataKey="late" name="Trong đó trễ hạn" fill="#ea580c" />
                  <Line type="monotone" dataKey="assigned" name="Được giao" stroke="#0f766e" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Việc của tôi theo trạng thái" />
          <CardBody className="h-64">
            {summary.isLoading ? <Skeleton className="h-full" /> : statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {statusData.map((s) => <Cell key={s.status} fill={STATUS_COLOR[s.status]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Chưa có việc nào" />}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ListCard title="Quá hạn của tôi" description="Ưu tiên xử lý ngay" href="/cong-viec/danh-sach?view=mine&due=overdue" items={summary.data?.overdue} loading={summary.isLoading} empty="Không có việc quá hạn 🎉" />
        <ListCard title="Việc của tôi sắp đến hạn" href="/cong-viec/danh-sach?view=mine" items={summary.data?.upcoming} loading={summary.isLoading} empty="Chưa có việc đang mở" />
        <ListCard title="Chờ tôi duyệt" href="/cong-viec/danh-sach?view=review&status=SUBMITTED" items={summary.data?.review} loading={summary.isLoading} empty="Không có kết quả chờ duyệt" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ListCard title="Tôi đã giao — đang thực hiện" description="Theo dõi tiến độ việc đã giao cho người khác" href="/cong-viec/danh-sach?view=assigned" items={summary.data?.assigned} loading={summary.isLoading} empty="Chưa có việc đã giao đang mở" showAssignee />
        </div>
        <Card>
          <CardHeader title="Việc đang mở theo ưu tiên" />
          <CardBody className="h-60">
            {(st?.byPriority ?? []).length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={st?.byPriority ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Số việc">{(st?.byPriority ?? []).map((p) => <Cell key={p.priority} fill={PRIORITY_COLOR[p.priority]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Không có việc đang mở" />}
          </CardBody>
        </Card>
      </div>

      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
