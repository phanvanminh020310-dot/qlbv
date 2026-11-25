'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MessageSquare, Paperclip, Plus, RefreshCw, Repeat, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, DueBadge, PriorityBadge, ProgressBar, TaskStatusBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, taskKeys, tasksApi, type TaskListQuery, type TaskStatus } from '@/lib/tasks';

const VIEWS = [
  { key: '', label: 'Tất cả' },
  { key: 'mine', label: 'Việc của tôi' },
  { key: 'assigned', label: 'Tôi giao' },
  { key: 'review', label: 'Tôi duyệt' },
  { key: 'watching', label: 'Theo dõi' },
];
const STATUS_GROUPS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Mọi trạng thái' },
  { key: 'ASSIGNED,ACCEPTED,IN_PROGRESS,ON_HOLD,SUBMITTED,RETURNED,DECLINED', label: 'Đang mở' },
  ...(['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'RETURNED', 'DECLINED', 'DONE', 'CANCELLED', 'DRAFT'] as TaskStatus[]).map((s) => ({ key: s, label: STATUS_LABEL[s] })),
];

function ListInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [creating, setCreating] = useState(false);
  const filters: TaskListQuery = useMemo(() => {
    const o: TaskListQuery = {};
    for (const k of ['view', 'status', 'priority', 'departmentId', 'projectId', 'label', 'q', 'due', 'sort', 'page', 'includeSubtasks'] as const) {
      const v = sp?.get(k);
      if (v) o[k] = v;
    }
    return o;
  }, [sp]);
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);

  const set = (patch: Partial<TaskListQuery>) => {
    const next = new URLSearchParams(sp?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  };

  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const query = { ...filters, pageSize: '50', sort: filters.sort ?? 'updated' };
  const list = useQuery({ queryKey: taskKeys.list(query), queryFn: () => tasksApi.list(query), placeholderData: keepPreviousData });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });
  const page = Number(filters.page ?? 1);
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 50));

  return (
    <div>
      <PageHeader
        title="Danh sách công việc"
        description={list.data ? `${list.data.total} công việc phù hợp` : 'Lọc theo góc nhìn, trạng thái, hạn chót, dự án…'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}><RefreshCw className={cn(list.isFetching && 'animate-spin')} /> Làm mới</Button>
            <Button onClick={() => setCreating(true)}><Plus /> Giao việc</Button>
          </>
        }
      />
      <TaskSubnav />

      <div className="mb-3 flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => set({ view: v.key })}
            className={cn('rounded-full border px-3 py-1 text-sm', (filters.view ?? '') === v.key ? 'border-teal-700 bg-teal-700 text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]')}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Card className="mb-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <form className="relative lg:col-span-2" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }}>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== (filters.q ?? '') && set({ q: q.trim() })} placeholder="Tìm mã, tiêu đề, mô tả…" className="pl-8" />
          </form>
          <Select value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value })}>
            {STATUS_GROUPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
          <Select value={filters.due ?? ''} onChange={(e) => set({ due: e.target.value })}>
            <option value="">Mọi thời hạn</option>
            <option value="overdue">Quá hạn</option>
            <option value="today">Đến hạn hôm nay</option>
            <option value="week">Trong 7 ngày tới</option>
            <option value="none">Không đặt hạn</option>
          </Select>
          <Select value={filters.priority ?? ''} onChange={(e) => set({ priority: e.target.value })}>
            <option value="">Mọi mức ưu tiên</option>
            {meta.data?.priorities.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Select value={filters.sort ?? 'updated'} onChange={(e) => set({ sort: e.target.value })}>
            <option value="updated">Mới cập nhật</option>
            <option value="due">Hạn gần nhất</option>
            <option value="priority">Ưu tiên cao trước</option>
            <option value="created">Mới tạo</option>
          </Select>
          <Select value={filters.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">Mọi dự án</option>
            {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
          {meta.data && meta.data.departments.length > 1 ? (
            <Select value={filters.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value })}>
              <option value="">Mọi khoa/phòng</option>
              {meta.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          ) : null}
          {meta.data?.labels.length ? (
            <Select value={filters.label ?? ''} onChange={(e) => set({ label: e.target.value })}>
              <option value="">Mọi nhãn</option>
              {meta.data.labels.map((l) => <option key={l} value={l}>#{l}</option>)}
            </Select>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.includeSubtasks !== '0'} onChange={(e) => set({ includeSubtasks: e.target.checked ? '' : '0' })} />
            Hiện cả việc con
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState title="Không có công việc phù hợp" description="Thử đổi bộ lọc hoặc giao việc mới." action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> Giao việc</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2">Công việc</th>
                  <th className="px-3 py-2">Người thực hiện</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Hạn</th>
                  <th className="w-36 px-3 py-2">Tiến độ</th>
                  <th className="px-3 py-2">Giao bởi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.items.map((t) => (
                  <tr key={t.id} className={cn('cursor-pointer hover:bg-[var(--muted)]', t.overdue && 'bg-red-50/40 dark:bg-red-950/20')} onClick={() => router.push(`/cong-viec/${t.id}`)}>
                    <td className="max-w-[28rem] px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        <span className="font-mono">{t.code}</span>
                        {t.parentId ? <span>· việc con</span> : null}
                        {t.projectName ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: t.projectColor ?? '#0f766e' }} />{t.projectName}</span> : null}
                        {t.recurrence ? <Repeat className="size-3" /> : null}
                      </div>
                      <Link href={`/cong-viec/${t.id}`} className="line-clamp-2 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{t.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <PriorityBadge priority={t.priority} compact />
                        {t.labels.map((l) => <span key={l} className="text-[11px] text-sky-700">#{l}</span>)}
                        {t.commentCount ? <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--muted-foreground)]"><MessageSquare className="size-3" />{t.commentCount}</span> : null}
                        {t.attachmentCount ? <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--muted-foreground)]"><Paperclip className="size-3" />{t.attachmentCount}</span> : null}
                        {t.subtaskTotal ? <span className="text-[11px] text-[var(--muted-foreground)]">Việc con {t.subtaskDone}/{t.subtaskTotal}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {t.assigneeName ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.assigneeName} size={22} />{t.assigneeName}</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                      <div className="text-[11px] text-[var(--muted-foreground)]">{t.departmentName}</div>
                    </td>
                    <td className="px-3 py-2">
                      <TaskStatusBadge status={t.status} />
                      {t.returnCount ? <div className="mt-0.5 text-[11px] text-orange-600">Trả lại {t.returnCount} lần</div> : null}
                    </td>
                    <td className="px-3 py-2"><DueBadge dueAt={t.dueAt} status={t.status} /></td>
                    <td className="px-3 py-2">
                      <ProgressBar value={t.progress} />
                      <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{t.progress}%{t.checklistTotal ? ` · ${t.checklistDone}/${t.checklistTotal} mục` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">{t.assignerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft /></Button>
            Trang {page}/{totalPages}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => set({ page: String(page + 1) })}><ChevronRight /></Button>
          </div>
        ) : null}
      </Card>
      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export default function TaskListPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40" />}>
      <ListInner />
    </Suspense>
  );
}
