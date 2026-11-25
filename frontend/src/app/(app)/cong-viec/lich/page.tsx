'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, DueBadge, PriorityBadge, TaskStatusBadge, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { STATUS_COLOR, STATUS_LABEL, taskKeys, tasksApi, type TaskRow, type TaskStatus } from '@/lib/tasks';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------- Ngày giờ (giờ Việt Nam) */
const VN = 7 * 3600_000;
const ymdOf = (d: Date | string) => new Date(new Date(d).getTime() + VN).toISOString().slice(0, 10);
const todayYmd = () => ymdOf(new Date());
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7; // 1 = Thứ Hai
const weekStart = (ymd: string) => addDays(ymd, 1 - weekday(ymd));
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const timeOf = (iso: string) => new Date(new Date(iso).getTime() + VN).toISOString().slice(11, 16);
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const WEEKDAY_FULL = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const FINAL: TaskStatus[] = ['DONE', 'CANCELLED'];
const OPEN_STATUSES = 'DRAFT,ASSIGNED,ACCEPTED,DECLINED,IN_PROGRESS,ON_HOLD,SUBMITTED,RETURNED';

type Mode = 'month' | 'week' | 'agenda';

export default function TaskCalendarPage() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(todayYmd);
  const [view, setView] = useState('mine');
  const [projectId, setProjectId] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const [dragging, setDragging] = useState<TaskRow | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  // Màn hình hẹp (điện thoại): mặc định xem dạng lịch biểu
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) setMode('agenda');
  }, []);

  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });

  // Khoảng ngày hiển thị
  const range = useMemo(() => {
    if (mode === 'week') {
      const from = weekStart(anchor);
      return { from, to: addDays(from, 6) };
    }
    const first = `${anchor.slice(0, 7)}-01`;
    if (mode === 'agenda') return { from: first, to: addDays(addMonths(first, 1), -1) };
    const from = weekStart(first);
    return { from, to: addDays(from, 41) };
  }, [mode, anchor]);

  const query = {
    view,
    projectId,
    dueFrom: range.from,
    dueTo: range.to,
    includeSubtasks: '1',
    sort: 'due',
    pageSize: '500',
    status: showDone ? `${OPEN_STATUSES},DONE` : OPEN_STATUSES,
  };
  const list = useQuery({ queryKey: taskKeys.calendar(query), queryFn: () => tasksApi.list(query) });
  const noDue = useQuery({
    queryKey: taskKeys.calendar({ view, projectId, due: 'none' }),
    queryFn: () => tasksApi.list({ view, projectId, due: 'none', status: OPEN_STATUSES, pageSize: '1', includeSubtasks: '1' }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of list.data?.items ?? []) {
      if (!t.dueAt) continue;
      const k = ymdOf(t.dueAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [list.data]);

  const canReschedule = (t: TaskRow) =>
    !FINAL.includes(t.status) && !!me && (!!meta.data?.permissions.canManage || t.assignerId === me.id || t.reviewerId === me.id || t.createdBy === me.id);

  const move = useMutation({
    mutationFn: (v: { task: TaskRow; dueAt: string }) => tasksApi.update(v.task.id, { dueAt: v.dueAt }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      const prev = v.task.dueAt;
      toast.success(`Đã dời hạn ${v.task.code} sang ${dm(ymdOf(v.dueAt))}`, {
        action: prev ? { label: 'Hoàn tác', onClick: () => move.mutate({ task: { ...v.task, dueAt: v.dueAt }, dueAt: prev }) } : undefined,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dropOn = (day: string) => {
    const t = dragging;
    setDragging(null);
    setOverDay(null);
    if (!t?.dueAt || ymdOf(t.dueAt) === day) return;
    if (!canReschedule(t)) return toast.warning('Chỉ người giao việc, người duyệt hoặc quản lý mới dời được hạn chót');
    move.mutate({ task: t, dueAt: `${day}T${timeOf(t.dueAt)}:00+07:00` });
  };

  const go = (dir: -1 | 1) => setAnchor((a) => (mode === 'week' ? addDays(a, dir * 7) : addMonths(a, dir)));
  const title =
    mode === 'week'
      ? `Tuần ${dm(range.from)} – ${dm(range.to)}/${range.to.slice(0, 4)}`
      : `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;
  const today = todayYmd();
  const total = list.data?.items.length ?? 0;
  const truncated = (list.data?.total ?? 0) > total;

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range]);

  const chip = (t: TaskRow, opts: { showTime?: boolean } = {}) => {
    const done = t.status === 'DONE';
    const draggable = canReschedule(t);
    return (
      <Link
        key={t.id}
        href={`/cong-viec/${t.id}`}
        draggable={draggable}
        onDragStart={(e) => { setDragging(t); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDragging(null); setOverDay(null); }}
        onClick={(e) => e.stopPropagation()}
        title={`${t.code} · ${t.title}\n${t.statusLabel} · ${t.assigneeName ?? '—'}${t.dueAt ? ` · hạn ${timeOf(t.dueAt)}` : ''}${draggable ? '\nKéo sang ngày khác để dời hạn' : ''}`}
        className={cn(
          'flex items-center gap-1 truncate rounded border-l-[3px] px-1.5 py-0.5 text-[11px] leading-4 transition-colors',
          t.overdue ? 'bg-red-50 text-red-800 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-200' : 'bg-[var(--muted)] hover:bg-teal-50 dark:hover:bg-teal-950/40',
          done && 'opacity-60 line-through',
          draggable && 'cursor-grab active:cursor-grabbing',
          dragging?.id === t.id && 'opacity-40',
        )}
        style={{ borderLeftColor: STATUS_COLOR[t.status] }}
      >
        {t.priority === 'URGENT' || t.priority === 'HIGH' ? <span className={cn('size-1.5 shrink-0 rounded-full', t.priority === 'URGENT' ? 'bg-red-600' : 'bg-amber-500')} /> : null}
        {opts.showTime && t.dueAt ? <span className="shrink-0 font-mono text-[10px] text-[var(--muted-foreground)]">{timeOf(t.dueAt)}</span> : null}
        <span className="truncate">{t.title}</span>
      </Link>
    );
  };

  const dayDropProps = (day: string) => ({
    onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); setOverDay(day); } },
    onDragLeave: () => setOverDay((d) => (d === day ? null : d)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOn(day); },
  });

  return (
    <div>
      <PageHeader
        title="Lịch công việc"
        description="Công việc theo hạn chót. Kéo thẻ sang ngày khác để dời hạn (người giao/duyệt/quản lý); bấm ngày để giao việc có hạn vào ngày đó."
        actions={<Button onClick={() => setCreateOn(today)}><Plus /> Giao việc</Button>}
      />
      <TaskSubnav />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => go(-1)} aria-label="Trước"><ChevronLeft /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayYmd())}>Hôm nay</Button>
          <Button size="sm" variant="outline" onClick={() => go(1)} aria-label="Sau"><ChevronRight /></Button>
        </div>
        <h2 className="min-w-[10rem] text-base font-semibold">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5 text-sm">
            {([['month', 'Tháng', CalendarDays], ['week', 'Tuần', CalendarDays], ['agenda', 'Lịch biểu', List]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={cn('flex items-center gap-1 rounded-md px-2.5 py-1', mode === k ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          <Select className="w-40" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="mine">Việc của tôi</option>
            <option value="assigned">Tôi giao</option>
            <option value="review">Tôi duyệt</option>
            <option value="watching">Tôi theo dõi</option>
            <option value="">Tất cả trong phạm vi</option>
          </Select>
          <Select className="w-56" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Mọi dự án</option>
            {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Hiện việc đã xong
          </label>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
        <span>{list.isLoading ? 'Đang tải…' : `${total} việc có hạn trong khoảng này`}</span>
        {truncated ? <span className="text-amber-700">Chỉ hiển thị 500 việc đầu — hãy lọc theo dự án/phạm vi.</span> : null}
        {noDue.data?.total ? (
          <Link href={`/cong-viec/danh-sach?view=${view}&due=none`} className="text-[var(--primary)] underline-offset-2 hover:underline">
            {noDue.data.total} việc đang mở chưa có hạn chót
          </Link>
        ) : null}
      </div>

      {list.isLoading ? (
        <Skeleton className="h-[32rem]" />
      ) : mode === 'agenda' ? (
        <Card className="p-0">
          {days.filter((d) => byDay.has(d)).length === 0 ? (
            <EmptyState title="Không có việc nào có hạn trong tháng này" />
          ) : (
            <ul className="divide-y">
              {days.filter((d) => byDay.has(d)).map((d) => (
                <li key={d} className="flex gap-3 px-3 py-2.5">
                  <div className={cn('w-14 shrink-0 text-center', d === today && 'text-[var(--primary)]')}>
                    <div className="text-[11px] uppercase text-[var(--muted-foreground)]">{WEEKDAY_SHORT[weekday(d) - 1]}</div>
                    <div className={cn('text-xl font-semibold leading-6', d < today && 'text-[var(--muted-foreground)]')}>{d.slice(8, 10)}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]">th {Number(d.slice(5, 7))}</div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {byDay.get(d)!.map((t) => <AgendaRow key={t.id} t={t} />)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-[var(--card)]">
          <div className="grid grid-cols-7 border-b bg-[var(--muted)] text-center text-xs font-medium text-[var(--muted-foreground)]">
            {WEEKDAY_SHORT.map((w, i) => <div key={w} className={cn('py-1.5', i >= 5 && 'text-red-600/80')}>{mode === 'week' ? `${w} ${dm(days[i]!)}` : w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const items = byDay.get(d) ?? [];
              const inMonth = mode === 'week' || d.slice(0, 7) === anchor.slice(0, 7);
              const limit = mode === 'week' ? 30 : 3;
              const overdueCount = items.filter((t) => t.overdue).length;
              return (
                <div
                  key={d}
                  {...dayDropProps(d)}
                  onClick={() => (items.length ? setDayOpen(d) : setCreateOn(d))}
                  className={cn(
                    'group relative cursor-pointer border-b border-r p-1 transition-colors [&:nth-child(7n)]:border-r-0',
                    mode === 'week' ? 'min-h-[24rem]' : 'min-h-[6.5rem]',
                    !inMonth && 'bg-[var(--muted)]/40',
                    overDay === d && 'bg-teal-50 ring-2 ring-inset ring-teal-600 dark:bg-teal-950/40',
                    'hover:bg-[var(--muted)]/50',
                  )}
                >
                  <div className="mb-1 flex items-center gap-1">
                    <span
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs',
                        d === today ? 'bg-[var(--primary)] font-semibold text-white' : inMonth ? 'font-medium' : 'text-[var(--muted-foreground)]',
                      )}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                    {overdueCount ? <span className="rounded bg-red-100 px-1 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{overdueCount} trễ</span> : null}
                    <button
                      type="button"
                      className="ml-auto rounded p-0.5 text-[var(--muted-foreground)] opacity-0 hover:bg-[var(--muted)] hover:text-[var(--foreground)] group-hover:opacity-100"
                      title={`Giao việc hạn ${dm(d)}`}
                      onClick={(e) => { e.stopPropagation(); setCreateOn(d); }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, limit).map((t) => chip(t, { showTime: mode === 'week' }))}
                    {items.length > limit ? (
                      <button type="button" className="w-full rounded px-1 text-left text-[11px] font-medium text-[var(--primary)] hover:underline" onClick={(e) => { e.stopPropagation(); setDayOpen(d); }}>
                        +{items.length - limit} việc khác
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
        {(['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'RETURNED', 'DONE'] as TaskStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><span className="h-3 w-1 rounded" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-red-600" />Khẩn</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />Cao</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-4 rounded bg-red-100 dark:bg-red-950" />Quá hạn</span>
      </div>

      <Dialog
        open={dayOpen !== null}
        onClose={() => setDayOpen(null)}
        title={dayOpen ? `${WEEKDAY_FULL[weekday(dayOpen)]}, ${dm(dayOpen)}/${dayOpen.slice(0, 4)}` : ''}
        description={dayOpen ? `${byDay.get(dayOpen)?.length ?? 0} việc có hạn trong ngày` : undefined}
        size="lg"
        footer={<Button onClick={() => { const d = dayOpen; setDayOpen(null); setCreateOn(d); }}><Plus /> Giao việc hạn ngày này</Button>}
      >
        <div className="space-y-1.5">
          {(dayOpen ? byDay.get(dayOpen) ?? [] : []).map((t) => <AgendaRow key={t.id} t={t} />)}
        </div>
      </Dialog>

      <TaskFormDialog
        open={createOn !== null}
        onClose={() => setCreateOn(null)}
        defaults={createOn ? { dueAt: `${createOn}T17:00:00+07:00`, projectId: projectId ? Number(projectId) : undefined } : undefined}
      />
    </div>
  );
}

function AgendaRow({ t }: { t: TaskRow }) {
  return (
    <div
      className={cn('flex items-start gap-2 rounded-lg border-l-4 bg-[var(--muted)]/50 px-2.5 py-1.5 hover:bg-[var(--muted)]', t.status === 'DONE' && 'opacity-70')}
      style={{ borderLeftColor: STATUS_COLOR[t.status] }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <span className="font-mono">{t.code}</span>
          {t.dueAt ? <span>· {timeOf(t.dueAt)}</span> : null}
          {t.projectName ? <span className="truncate">· {t.projectName}</span> : null}
        </div>
        <Link href={`/cong-viec/${t.id}`} className={cn('block truncate text-sm font-medium hover:underline', t.status === 'DONE' && 'line-through')}>{t.title}</Link>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <Avatar name={t.assigneeName} size={16} /> {t.assigneeName ?? '—'} {t.progress > 0 && t.status !== 'DONE' ? `· ${t.progress}%` : ''}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <TaskStatusBadge status={t.status} />
        <div className="flex gap-1"><PriorityBadge priority={t.priority} compact /><DueBadge dueAt={t.dueAt} status={t.status} /></div>
      </div>
    </div>
  );
}
