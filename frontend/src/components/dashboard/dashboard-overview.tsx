'use client';

/**
 * Lớp tổng quan mặc định cho Dashboard. Đây là lớp đọc số liệu, hoàn toàn độc
 * lập với Studio bên dưới: người dùng luôn có bảng vận hành rõ ràng, còn các
 * trang Studio vẫn giữ nguyên để tự thiết kế khi cần.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  HeartPulse,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Card, CardBody, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { RealtimeDot, useRealtimeInvalidate } from '@/lib/realtime';
import { cn, formatDateTime, formatNumber } from '@/lib/utils';

type DashboardSummary = {
  scope: { dataScope: 'OWN' | 'DEPT' | 'ALL'; departmentIds: number[]; departmentId: number | null; isSuperAdmin: boolean };
  hsba: {
    total: number;
    pending: number;
    completed: number;
    returned: number;
    today: number;
    trend: Array<{ day: string; total: number; completed: number }>;
  };
  reports: {
    departments: number;
    departmentsToday: number;
    entriesToday: number;
    entriesPeriod: number;
    trend: Array<{ day: string; cells: number }>;
  };
  users: { users: number; active: number };
  departments: { total: number; reportable: number };
  jobs: Array<{ id: number; name: string; cron: string; active: boolean; lastStatus: string | null; lastRunAt: string | null; failCount?: number }>;
  recentAudit: Array<{ id: number; fullName: string; username: string; description: string; module: string; entity: string | null; createdAt: string }>;
};

function scopeLabel(scope?: DashboardSummary['scope']): string {
  if (!scope) return 'Đang nạp phạm vi dữ liệu';
  if (scope.isSuperAdmin || scope.dataScope === 'ALL') return 'Phạm vi toàn viện';
  if (scope.dataScope === 'DEPT') return 'Phạm vi khoa được phân công';
  return 'Dữ liệu của tôi';
}

function dateLabel(day: string): string {
  const parts = day.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: ReactNode;
  tone: 'blue' | 'emerald' | 'amber' | 'violet';
  href?: string;
}) {
  const tones = {
    blue: 'from-blue-600 to-cyan-500 shadow-blue-500/20',
    emerald: 'from-emerald-600 to-teal-500 shadow-emerald-500/20',
    amber: 'from-amber-500 to-orange-500 shadow-amber-500/20',
    violet: 'from-violet-600 to-fuchsia-500 shadow-violet-500/20',
  };
  const body = (
    <Card className="group h-full overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardBody className="relative flex min-h-31 items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--muted-foreground)]">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
          <div className="mt-2 truncate text-xs text-[var(--muted-foreground)]">{hint}</div>
        </div>
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg', tones[tone])}>
          {icon}
        </div>
        {href ? <ArrowRight className="absolute bottom-3 right-3 size-4 text-[var(--muted-foreground)] opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" /> : null}
      </CardBody>
    </Card>
  );
  return href ? <Link href={href} className="block min-w-0">{body}</Link> : body;
}

function JobStatus({ status, active }: { status: string | null; active: boolean }) {
  if (!active) return <Badge tone="muted">Tạm dừng</Badge>;
  if (status === 'SUCCESS') return <Badge tone="success"><CheckCircle2 className="size-3" /> Ổn định</Badge>;
  if (status === 'FAILED') return <Badge tone="danger">Cần kiểm tra</Badge>;
  return <Badge tone="warning">Chờ chạy</Badge>;
}

export function DashboardOverview() {
  const user = useAuth((state) => state.user);
  const can = useAuth((state) => state.can);
  const [now, setNow] = useState(() => new Date());
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<DashboardSummary>('/dashboard/summary?days=14'),
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // SSE làm mới ngay các chỉ số bị ảnh hưởng; polling 60 giây chỉ là lưới an
  // toàn cho tab ngủ hoặc kết nối tạm mất.
  useRealtimeInvalidate({
    hsba: [['dashboard-summary']],
    report: [['dashboard-summary']],
    system: [['dashboard-summary']],
  }, 1_000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const greeting = now.getHours() < 12 ? 'Chào buổi sáng' : now.getHours() < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const firstName = (user?.fullName ?? '').trim().split(/\s+/).at(-1) ?? '';
  const data = summary.data;
  const trend = useMemo(
    () => (data?.hsba.trend ?? []).map((item) => ({ ...item, label: dateLabel(item.day) })),
    [data?.hsba.trend],
  );
  const quickLinks = [
    can('hsba.request.view') ? { href: '/ho-so-benh-an', label: 'Hồ sơ bệnh án', note: 'Theo dõi yêu cầu', icon: ClipboardList, tone: 'text-blue-700 bg-blue-50 dark:bg-blue-950/45 dark:text-blue-300' } : null,
    can('report.view.view') ? { href: '/bao-cao', label: 'Báo cáo khoa', note: 'Nhập và xem số liệu', icon: BarChart3, tone: 'text-violet-700 bg-violet-50 dark:bg-violet-950/45 dark:text-violet-300' } : null,
    can('duty.manage') || can('duty.manage-all') ? { href: '/lich-truc/theo-doi-xac-thuc', label: 'Ca trực', note: 'Theo dõi xác thực', icon: HeartPulse, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/45 dark:text-emerald-300' } : null,
    can('asset.view') ? { href: '/tai-san', label: 'Tài sản', note: 'Tra cứu nhanh', icon: Building2, tone: 'text-amber-700 bg-amber-50 dark:bg-amber-950/45 dark:text-amber-300' } : null,
  ].filter((item): item is NonNullable<typeof item> => !!item);

  return (
    <section className="space-y-4" aria-label="Tổng quan vận hành">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-blue-900 to-cyan-700 px-5 py-5 text-white shadow-xl shadow-blue-950/15 sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute -right-14 -top-20 size-64 rounded-full bg-cyan-300/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-64 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-cyan-50 backdrop-blur">
              <LayoutDashboard className="size-3.5" /> Trung tâm điều hành
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-blue-100">Nắm bắt vận hành bệnh viện từ các chỉ số quan trọng, cập nhật theo thời gian thực trong đúng phạm vi được cấp quyền.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded-xl border border-white/15 bg-slate-950/20 px-3 py-2 backdrop-blur">
              <div className="text-blue-100/80">{scopeLabel(data?.scope)}</div>
              <div className="mt-0.5 font-medium text-white">{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now)}</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-slate-950/20 px-3 py-2 backdrop-blur">
              <RealtimeDot className="text-white [&_span:last-child]:text-blue-50" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Hồ sơ chờ xử lý" value={data ? formatNumber(data.hsba.pending) : '—'} hint={`${data ? formatNumber(data.hsba.today) : '—'} hồ sơ tạo hôm nay`} icon={<ClipboardList className="size-5" />} tone="blue" href={can('hsba.request.view') ? '/ho-so-benh-an' : undefined} />
        <MetricCard label="Hoàn tất trong kỳ" value={data ? formatNumber(data.hsba.completed) : '—'} hint={`${data ? formatNumber(data.hsba.total) : '—'} hồ sơ trong phạm vi`} icon={<CheckCircle2 className="size-5" />} tone="emerald" href={can('hsba.request.view') ? '/ho-so-benh-an' : undefined} />
        <MetricCard label="Báo cáo hôm nay" value={data ? formatNumber(data.reports.entriesToday) : '—'} hint={`${data ? formatNumber(data.reports.departmentsToday) : '—'} khoa đã nhập dữ liệu`} icon={<FileSpreadsheet className="size-5" />} tone="violet" href={can('report.view.view') ? '/bao-cao' : undefined} />
        <MetricCard label="Người dùng hoạt động" value={data ? formatNumber(data.users.active) : '—'} hint={`${data ? formatNumber(data.departments.reportable) : '—'} khoa có báo cáo`} icon={<Users className="size-5" />} tone="amber" href={can('user.view') ? '/quan-tri/nguoi-dung' : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.8fr)]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
            <div>
              <div className="text-base font-semibold">Nhịp độ hồ sơ 14 ngày</div>
              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Số hồ sơ phát sinh và hoàn tất theo ngày</div>
            </div>
            <Badge tone={data?.hsba.pending ? 'warning' : 'success'}>{data?.hsba.pending ? `${formatNumber(data.hsba.pending)} cần xử lý` : 'Không có tồn đọng'}</Badge>
          </div>
          <CardBody className="h-64 p-3 sm:h-[17.5rem] sm:p-4">
            {summary.isLoading ? <Skeleton className="h-full" /> : trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardTotal" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="dashboardDone" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} minTickGap={22} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, borderColor: 'var(--border)', background: 'var(--card)', fontSize: 12 }} labelStyle={{ color: 'var(--muted-foreground)' }} />
                  <Area type="monotone" dataKey="total" name="Phát sinh" stroke="#2563eb" strokeWidth={2.5} fill="url(#dashboardTotal)" />
                  <Area type="monotone" dataKey="completed" name="Hoàn tất" stroke="#10b981" strokeWidth={2.5} fill="url(#dashboardDone)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Chưa có dữ liệu hồ sơ trong 14 ngày gần nhất</div>}
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3.5">
            <div>
              <div className="text-base font-semibold">Truy cập nhanh</div>
              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Các phân hệ bạn được phép sử dụng</div>
            </div>
            <Activity className="size-4 text-[var(--primary)]" />
          </div>
          <CardBody className="grid gap-2 p-3">
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition hover:border-[var(--primary)]/30 hover:bg-[var(--accent)]">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', item.tone)}><Icon className="size-4.5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="block truncate text-xs text-[var(--muted-foreground)]">{item.note}</span></span>
                  <ArrowRight className="size-4 shrink-0 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--primary)]" />
                </Link>
              );
            })}
            {!quickLinks.length ? <div className="px-2 py-8 text-center text-sm text-[var(--muted-foreground)]">Chưa có phân hệ nào được cấp quyền.</div> : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3.5">
            <div><div className="text-base font-semibold">Hoạt động gần đây</div><div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Nhật ký thao tác hệ thống mới nhất</div></div>
            <BellRing className="size-4 text-[var(--primary)]" />
          </div>
          <CardBody className="p-0">
            {summary.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : data?.recentAudit.length ? (
              <div className="divide-y">
                {data.recentAudit.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 shadow-sm shadow-blue-400/40" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm"><span className="font-semibold">{item.fullName || item.username}</span> <span className="text-[var(--muted-foreground)]">{item.description || item.module}</span></div><div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{item.module} · {formatDateTime(item.createdAt)}</div></div>
                  </div>
                ))}
              </div>
            ) : <div className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">Chưa có hoạt động để hiển thị</div>}
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3.5">
            <div><div className="text-base font-semibold">Tình trạng tác vụ hệ thống</div><div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Theo dõi các tác vụ định kỳ đang bật</div></div>
            <ShieldCheck className="size-4 text-emerald-600" />
          </div>
          <CardBody className="p-0">
            {summary.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : data?.jobs.length ? (
              <div className="divide-y">
                {data.jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--muted)] text-[var(--muted-foreground)]"><Clock3 className="size-4" /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{job.name}</div><div className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">{job.cron} · {job.lastRunAt ? formatDateTime(job.lastRunAt) : 'chưa chạy'}</div></div>
                    <JobStatus status={job.lastStatus} active={job.active} />
                  </div>
                ))}
              </div>
            ) : <div className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">Chưa có tác vụ định kỳ đang bật</div>}
          </CardBody>
        </Card>
      </div>

      {summary.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>Không thể nạp một phần số liệu tổng quan. Các phân hệ khác vẫn hoạt động bình thường.</span>
          <Button size="sm" variant="outline" onClick={() => void summary.refetch()}><RefreshCw className="size-3.5" /> Thử lại</Button>
        </div>
      ) : null}
    </section>
  );
}
