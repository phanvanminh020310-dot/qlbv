'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { PROJECT_ROLE_LABEL, ProjectFormDialog } from '@/components/tasks/project-form-dialog';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, DueBadge, PriorityBadge, ProgressBar, TaskStatusBadge } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/tabs';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { STATUS_COLOR, fmtDate, taskKeys, tasksApi, type ProjectDetail } from '@/lib/tasks';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState('people');
  const detail = useQuery({ queryKey: taskKeys.project(id), queryFn: () => tasksApi.project(id), enabled: Number.isFinite(id) });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.all });
  const archive = useMutation({
    mutationFn: (archived: boolean) => tasksApi.updateProject(id, { archived }),
    onSuccess: (_d, a) => { toast.success(a ? 'Đã lưu trữ dự án' : 'Đã khôi phục dự án'); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => tasksApi.deleteProject(id),
    onSuccess: () => { toast.success('Đã xoá dự án'); void invalidate(); router.push('/cong-viec/du-an'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-72" /></div>;
  if (!detail.data) {
    return <EmptyState title="Không mở được dự án" description={(detail.error as Error | null)?.message} action={<Link href="/cong-viec/du-an"><Button variant="outline"><ArrowLeft /> Danh sách dự án</Button></Link>} />;
  }
  const p = detail.data;
  const s = p.stats;

  return (
    <div>
      <PageHeader
        breadcrumb={<span><Link href="/cong-viec/du-an" className="hover:underline">Dự án</Link> / <span className="font-mono">{p.code}</span></span>}
        title={<span className="inline-flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: p.color }} />{p.name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{p.statusLabel}</Badge>
            <PriorityBadge priority={p.priority} />
            {p.archived ? <Badge tone="muted">Đã lưu trữ</Badge> : null}
            <span>Chủ nhiệm: <b>{p.ownerName || '—'}</b></span>
            {p.departmentName ? <span>· {p.departmentName}</span> : null}
            {p.startDate || p.dueDate ? <span>· {fmtDate(p.startDate) || '…'} → {fmtDate(p.dueDate) || '…'}</span> : null}
          </span>
        }
        actions={
          <>
            {p.viewer.canAddTask && !p.archived ? <Button onClick={() => setAdding(true)}><Plus /> Giao việc trong dự án</Button> : null}
            {p.viewer.canManage ? (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>
                <Button variant="ghost" onClick={() => archive.mutate(!p.archived)} loading={archive.isPending}>{p.archived ? <><ArchiveRestore /> Khôi phục</> : <><Archive /> Lưu trữ</>}</Button>
                <Button variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
              </>
            ) : null}
          </>
        }
      />
      {p.description ? <p className="mb-4 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">{p.description}</p> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tiến độ" value={`${p.progress}%`} tone="primary" hint={`${s.done}/${s.total} việc`} />
        <StatCard label="Chờ nhận" value={s.waiting} />
        <StatCard label="Đang làm" value={s.inProgress} tone="success" />
        <StatCard label="Chờ duyệt" value={s.submitted} tone="warning" />
        <StatCard label="Quá hạn" value={s.overdue} tone="danger" />
        <StatCard label="Thành viên" value={p.members.length} hint={p.unassigned ? `${p.unassigned} việc chưa giao` : undefined} />
      </div>

      <Card className="mb-4 p-4">
        <div className="mb-2 flex justify-between text-sm"><b>Tiến độ chung</b><span>{p.openCount} việc đang mở</span></div>
        <div className="flex h-4 overflow-hidden rounded-full bg-[var(--muted)]">
          {p.byStatus.filter((b) => b.status !== 'DRAFT' && b.status !== 'CANCELLED').map((b) => (
            <div key={b.status} title={`${b.label}: ${b.count}`} style={{ width: `${(100 * b.count) / Math.max(1, s.total)}%`, background: STATUS_COLOR[b.status] }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {p.byStatus.map((b) => <span key={b.status} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: STATUS_COLOR[b.status] }} />{b.label} {b.count}</span>)}
        </div>
      </Card>

      <Card className="p-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: 'people', label: 'Ai làm gì', content: <PeopleTab project={p} /> },
            { key: 'tasks', label: 'Danh sách việc', badge: p.tasks.length || undefined, content: <TasksTab project={p} /> },
            { key: 'timeline', label: 'Dòng thời gian', content: <TimelineTab project={p} /> },
          ]}
        />
      </Card>

      <ProjectFormDialog open={editing} onClose={() => setEditing(false)} project={p} />
      {adding ? <TaskFormDialog open onClose={() => setAdding(false)} defaults={{ projectId: p.id, departmentId: p.departmentId }} onSaved={() => setTab('tasks')} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Xoá dự án?"
        message="Chỉ xoá được khi không còn công việc đang mở. Nếu muốn giữ lịch sử, hãy chọn Lưu trữ."
        confirmText="Xoá dự án"
        loading={remove.isPending}
      />
    </div>
  );
}

function PeopleTab({ project }: { project: ProjectDetail }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!project.members.length) return <EmptyState title="Dự án chưa có thành viên" description="Sửa dự án để thêm thành viên." />;
  return (
    <div className="divide-y rounded-lg border">
      {project.members.map((m) => {
        const expanded = open[m.userId] ?? m.tasks.length <= 3;
        return (
          <div key={m.userId}>
            <button type="button" onClick={() => setOpen({ ...open, [m.userId]: !expanded })} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--muted)]">
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <Avatar name={m.fullName} size={30} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.fullName} <span className="text-xs font-normal text-[var(--muted-foreground)]">· {PROJECT_ROLE_LABEL[m.role]}{m.title ? ` · ${m.title}` : ''}</span></div>
                <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted-foreground)]">
                  <span>{m.stats.total} việc</span>
                  <span className="text-emerald-700">{m.stats.done} xong</span>
                  {m.stats.inProgress ? <span>{m.stats.inProgress} đang làm</span> : null}
                  {m.stats.submitted ? <span className="text-amber-700">{m.stats.submitted} chờ duyệt</span> : null}
                  {m.stats.overdue ? <span className="text-red-600">{m.stats.overdue} quá hạn</span> : null}
                </div>
              </div>
              <div className="w-40"><ProgressBar value={m.progress} /><div className="mt-0.5 text-right text-[11px]">{m.progress}%</div></div>
            </button>
            {expanded && m.tasks.length ? (
              <ul className="mb-2 ml-12 mr-3 divide-y rounded-lg border bg-[var(--card)]">
                {m.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/cong-viec/${t.id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)]">
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{t.code}</span>
                      <span className={cn('min-w-0 flex-1 truncate', t.parentId && 'pl-3 text-[var(--muted-foreground)]')}>{t.parentId ? '↳ ' : ''}{t.title}</span>
                      <PriorityBadge priority={t.priority} compact />
                      <DueBadge dueAt={t.dueAt} status={t.status} />
                      <TaskStatusBadge status={t.status} label={t.statusLabel} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TasksTab({ project }: { project: ProjectDetail }) {
  if (!project.tasks.length) return <EmptyState title="Chưa có công việc trong dự án" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
          <tr><th className="px-3 py-2">Công việc</th><th className="px-3 py-2">Người thực hiện</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Hạn</th><th className="w-32 px-3 py-2">Tiến độ</th></tr>
        </thead>
        <tbody className="divide-y">
          {project.tasks.map((t) => (
            <tr key={t.id} className="hover:bg-[var(--muted)]">
              <td className="px-3 py-2">
                <Link href={`/cong-viec/${t.id}`} className="hover:underline"><span className="font-mono text-[11px] text-[var(--muted-foreground)]">{t.code}</span> <span className="font-medium">{t.parentId ? '↳ ' : ''}{t.title}</span></Link>
              </td>
              <td className="px-3 py-2">{t.assigneeName ?? <span className="text-amber-700">Chưa giao</span>}</td>
              <td className="px-3 py-2"><TaskStatusBadge status={t.status} /></td>
              <td className="px-3 py-2"><DueBadge dueAt={t.dueAt} status={t.status} /></td>
              <td className="px-3 py-2"><ProgressBar value={t.progress} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DAY = 86400_000;
const ymd = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

function TimelineTab({ project }: { project: ProjectDetail }) {
  const rows = project.timeline;
  const range = useMemo(() => {
    const pts: number[] = [];
    for (const r of rows) { if (r.start) pts.push(ymd(r.start)); if (r.end) pts.push(ymd(r.end)); }
    if (project.startDate) pts.push(ymd(project.startDate));
    if (project.dueDate) pts.push(ymd(project.dueDate));
    const today = ymd(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
    pts.push(today);
    const min = Math.min(...pts) - DAY;
    const max = Math.max(...pts) + 2 * DAY;
    return { min, max, span: max - min, today };
  }, [rows, project.startDate, project.dueDate]);
  if (!rows.length) return <EmptyState title="Chưa có việc nào có ngày bắt đầu/hạn chót" />;
  const pct = (t: number) => `${(100 * (t - range.min)) / range.span}%`;
  const months: Array<{ t: number; label: string }> = [];
  const d = new Date(range.min);
  d.setUTCDate(1);
  for (let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); m.getTime() < range.max; m.setUTCMonth(m.getUTCMonth() + 1)) {
    if (m.getTime() >= range.min) months.push({ t: m.getTime(), label: `T${m.getUTCMonth() + 1}/${m.getUTCFullYear()}` });
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="relative ml-[260px] h-6 border-b text-[11px] text-[var(--muted-foreground)]">
          {months.map((m) => <span key={m.t} className="absolute top-1 border-l pl-1" style={{ left: pct(m.t) }}>{m.label}</span>)}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-[260px] right-0">
            <div className="absolute inset-y-0 w-px bg-red-500/70" style={{ left: pct(range.today) }} title="Hôm nay" />
            {project.dueDate ? <div className="absolute inset-y-0 w-px border-l border-dashed border-slate-500" style={{ left: pct(ymd(project.dueDate) + DAY) }} title="Hạn dự án" /> : null}
          </div>
          {rows.map((r) => {
            const start = r.start ? ymd(r.start) : (r.end ? ymd(r.end) : range.today);
            const end = (r.end ? ymd(r.end) : start) + DAY;
            return (
              <div key={r.id} className="flex h-8 items-center border-b border-dashed text-sm last:border-0">
                <Link href={`/cong-viec/${r.id}`} className="w-[260px] shrink-0 truncate pr-2 hover:underline" title={r.title}>
                  <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{r.code}</span> {r.title}
                </Link>
                <div className="relative h-full flex-1">
                  <div
                    className={cn('absolute top-1.5 h-5 rounded-md text-[10px] leading-5 text-white', !r.end && 'opacity-60')}
                    style={{ left: pct(start), width: `max(6px, calc(${pct(end)} - ${pct(start)}))`, background: r.overdue ? '#dc2626' : r.done ? (r.late ? '#ea580c' : '#16a34a') : STATUS_COLOR[r.status] }}
                    title={`${r.title}\n${r.assigneeName ?? ''}\n${fmtDate(r.start)} → ${fmtDate(r.end)}`}
                  >
                    <span className="truncate px-1.5">{r.assigneeName}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-emerald-600" />Xong đúng hạn</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-orange-600" />Xong trễ hạn</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-red-600" />Quá hạn</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-red-500" />Hôm nay</span>
        </div>
      </div>
    </div>
  );
}
