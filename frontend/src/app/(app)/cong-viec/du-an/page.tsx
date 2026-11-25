'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, FolderKanban, Plus, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ProjectFormDialog } from '@/components/tasks/project-form-dialog';
import { Avatar, PriorityBadge, ProgressBar, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { PROJECT_STATUS_LABEL, fmtDate, taskKeys, tasksApi, type ProjectStatus } from '@/lib/tasks';

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'warning' | 'muted' | 'brand'> = {
  PLANNING: 'info',
  ACTIVE: 'brand',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'muted',
};

export default function ProjectsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const query = { q: q.trim() || undefined, status: status || undefined, archived: archived ? '1' : undefined };
  const list = useQuery({ queryKey: taskKeys.projects(query), queryFn: () => tasksApi.projects(query) });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });

  return (
    <div>
      <PageHeader
        title="Dự án"
        description="Nhóm công việc theo dự án: ai làm việc gì, tiến độ từng người, dòng thời gian."
        actions={meta.data?.permissions.canAssign ? <Button onClick={() => setCreating(true)}><Plus /> Tạo dự án</Button> : null}
      />
      <TaskSubnav />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã, tên dự án…" className="pl-8" />
        </div>
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Hiện dự án đã lưu trữ</label>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : !list.data?.length ? (
        <EmptyState title="Chưa có dự án" description="Tạo dự án để gom các công việc liên quan và theo dõi tiến độ chung." action={meta.data?.permissions.canAssign ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> Tạo dự án</Button> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((p) => (
            <Link key={p.id} href={`/cong-viec/du-an/${p.id}`}>
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                <div className="h-1.5" style={{ background: p.color }} />
                <div className="space-y-2.5 p-4">
                  <div className="flex items-start gap-2">
                    <FolderKanban className="mt-0.5 size-5 shrink-0" style={{ color: p.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-[var(--muted-foreground)]">{p.code}</div>
                      <div className="line-clamp-2 font-semibold">{p.name}</div>
                    </div>
                    <Badge tone={STATUS_TONE[p.status]}>{p.statusLabel}</Badge>
                  </div>
                  {p.description ? <p className="line-clamp-2 text-xs text-[var(--muted-foreground)]">{p.description}</p> : null}
                  <div>
                    <div className="mb-1 flex justify-between text-xs"><span>{p.taskDone}/{p.taskTotal} việc hoàn thành</span><b>{p.progress}%</b></div>
                    <ProgressBar value={p.progress} color={p.color} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1"><Avatar name={p.ownerName} size={18} />{p.ownerName || '—'}</span>
                    <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{p.memberCount}</span>
                    {p.taskOverdue ? <span className="inline-flex items-center gap-1 text-red-600"><AlarmClock className="size-3.5" />{p.taskOverdue} quá hạn</span> : null}
                    <PriorityBadge priority={p.priority} compact />
                    {p.dueDate ? <span>Hạn {fmtDate(p.dueDate)}</span> : null}
                    {p.archived ? <Badge tone="muted">Lưu trữ</Badge> : null}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
