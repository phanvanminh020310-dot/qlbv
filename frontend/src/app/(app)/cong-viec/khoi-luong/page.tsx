'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownUp, Coffee, Flame, Gauge, Plus, Send, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { TaskFormDialog } from '@/components/tasks/task-form-dialog';
import { Avatar, TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { taskKeys, tasksApi, type WorkloadPerson } from '@/lib/tasks';
import { cn } from '@/lib/utils';

const LEVEL: Record<WorkloadPerson['level'], { label: string; tone: 'success' | 'muted' | 'default' | 'danger' }> = {
  idle: { label: 'Đang rảnh', tone: 'success' },
  low: { label: 'Nhẹ', tone: 'muted' },
  normal: { label: 'Bình thường', tone: 'default' },
  high: { label: 'Quá tải', tone: 'danger' },
};

type SortKey = 'active' | 'overdue' | 'remainingHours' | 'dueWeek' | 'done30' | 'name';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function WorkloadPage() {
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sort, setSort] = useState<SortKey>('active');
  const [assignTo, setAssignTo] = useState<number | null>(null);
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const q = { departmentId, projectId };
  const data = useQuery({ queryKey: taskKeys.workload(q), queryFn: () => tasksApi.workload(q) });
  useRealtimeInvalidate({ tasks: [[...taskKeys.all]] });

  const people = useMemo(() => {
    const list = [...(data.data?.people ?? [])];
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return list.sort((a, b) => (b[sort] as number) - (a[sort] as number) || a.name.localeCompare(b.name, 'vi'));
  }, [data.data, sort]);

  const chartData = useMemo(
    () =>
      [...(data.data?.people ?? [])]
        .filter((p) => p.active + p.submitted > 0)
        .sort((a, b) => b.active - a.active)
        .slice(0, 30)
        .map((p) => ({ name: p.name, 'Chờ nhận': p.waiting, 'Đang làm': p.inProgress, 'Tạm hoãn': p.onHold, 'Chờ duyệt': p.submitted, overdue: p.overdue })),
    [data.data],
  );
  const t = data.data?.totals;
  const canAssign = !!meta.data?.permissions.canAssign;
  const listHref = (p: WorkloadPerson, extra = '') => `/cong-viec/danh-sach?view=&status=ASSIGNED,ACCEPTED,IN_PROGRESS,ON_HOLD,SUBMITTED,RETURNED,DECLINED&assigneeId=${p.userId}${projectId ? `&projectId=${projectId}` : ''}${extra}`;

  return (
    <div>
      <PageHeader
        title="Khối lượng công việc"
        description="Số việc đang xử lý của từng người ngay lúc này — để giao việc cân bằng, phát hiện người quá tải hoặc đang rảnh."
      />
      <TaskSubnav />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-56" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">{meta.data && meta.data.departments.length > 1 ? 'Mọi khoa/phòng trong phạm vi' : 'Khoa/phòng của tôi'}</option>
          {meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select className="w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Mọi dự án</option>
          {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </Select>
      </div>

      {data.isError ? (
        <Card><CardBody><EmptyState title="Không xem được khối lượng" description={(data.error as Error).message} /></CardBody></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Nhân viên" value={t?.people ?? '…'} icon={<Users className="size-4" />} />
            <StatCard label="Việc đang xử lý" value={t?.active ?? '…'} tone="primary" icon={<Gauge className="size-4" />} hint={t ? `TB ${t.avgActive} việc/người` : undefined} />
            <StatCard label="Đang chờ duyệt" value={t?.submitted ?? '…'} icon={<Send className="size-4" />} />
            <StatCard label="Quá hạn" value={t?.overdue ?? '…'} tone="danger" icon={<AlertTriangle className="size-4" />} />
            <StatCard label="Quá tải" value={t?.high ?? '…'} tone="warning" icon={<Flame className="size-4" />} />
            <StatCard label="Đang rảnh" value={t?.idle ?? '…'} tone="success" icon={<Coffee className="size-4" />} />
          </div>

          <Card className="mt-4">
            <CardHeader title="Việc đang xử lý theo người" description="Cột chồng theo trạng thái (30 người nhiều việc nhất). Đường đứt nét = trung bình." />
            <CardBody>
              <div style={{ height: Math.max(220, chartData.length * 28 + 70) }}>
              {data.isLoading ? <Skeleton className="h-full" /> : chartData.length === 0 ? <EmptyState title="Không ai đang có việc" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} interval={0} />
                    <Tooltip
                      formatter={(v, n) => [v, n]}
                      labelFormatter={(label, payload) => {
                        const od = (payload?.[0]?.payload as { overdue?: number } | undefined)?.overdue;
                        return `${label}${od ? ` — ${od} quá hạn` : ''}`;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Chờ nhận" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="Đang làm" stackId="a" fill="#0f766e" />
                    <Bar dataKey="Tạm hoãn" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="Chờ duyệt" stackId="a" fill="#a855f7" />
                    {t && t.avgActive > 0 ? <ReferenceLine x={t.avgActive} stroke="#64748b" strokeDasharray="4 4" /> : null}
                  </BarChart>
                </ResponsiveContainer>
              )}
              </div>
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Chi tiết theo nhân viên"
              description={data.data?.note}
              actions={
                <div className="flex items-center gap-1.5 text-xs">
                  <ArrowDownUp className="size-3.5 text-[var(--muted-foreground)]" />
                  <Select className="h-8 w-44 text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    <option value="active">Nhiều việc nhất</option>
                    <option value="overdue">Quá hạn nhiều nhất</option>
                    <option value="remainingHours">Giờ còn lại nhiều nhất</option>
                    <option value="dueWeek">Đến hạn 7 ngày nhiều nhất</option>
                    <option value="done30">Hoàn thành 30 ngày nhiều nhất</option>
                    <option value="name">Theo tên</option>
                  </Select>
                </div>
              }
            />
            {data.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : people.length === 0 ? (
              <EmptyState title="Không có nhân viên trong phạm vi" description="Chọn một khoa/phòng để xem cả người chưa có việc." />
            ) : (
              <div className="thin-scroll overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="bg-[var(--muted)] text-xs text-[var(--muted-foreground)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Nhân viên</th>
                      <th className="px-2 py-2 text-left font-medium">Mức tải</th>
                      <th className="px-2 py-2 text-right font-medium" title="Chờ nhận + đang làm + tạm hoãn">Đang xử lý</th>
                      <th className="px-2 py-2 text-left font-medium">Phân bố</th>
                      <th className="px-2 py-2 text-right font-medium">Chờ duyệt</th>
                      <th className="px-2 py-2 text-right font-medium">Quá hạn</th>
                      <th className="px-2 py-2 text-right font-medium" title="Đến hạn trong 7 ngày tới">Hạn 7 ngày</th>
                      <th className="px-2 py-2 text-right font-medium" title="Ưu tiên Cao/Khẩn">Ưu tiên cao</th>
                      <th className="px-2 py-2 text-right font-medium" title="Tổng giờ ước lượng × (100% − tiến độ)">Giờ còn lại</th>
                      <th className="px-2 py-2 text-right font-medium" title="Giờ đã ghi nhật ký 7 ngày qua">Giờ 7 ngày</th>
                      <th className="px-2 py-2 text-right font-medium" title="Hoàn thành 30 ngày qua · tỷ lệ đúng hạn">Xong 30 ngày</th>
                      {canAssign ? <th className="px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {people.map((p) => {
                      const max = Math.max(1, ...people.map((x) => x.active + x.submitted));
                      const seg = (n: number, color: string, label: string) =>
                        n > 0 ? <span key={label} title={`${label}: ${n}`} style={{ width: `${(n / max) * 100}%`, background: color }} className="h-full" /> : null;
                      return (
                        <tr key={p.userId} className={cn('hover:bg-[var(--muted)]/50', p.level === 'high' && 'bg-red-50/40 dark:bg-red-950/20')}>
                          <td className="px-3 py-2">
                            <Link href={listHref(p)} className="flex items-center gap-2 hover:underline">
                              <Avatar name={p.name} size={26} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{p.name}</span>
                                <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{p.extra}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-2 py-2"><Badge tone={LEVEL[p.level].tone}>{LEVEL[p.level].label}</Badge></td>
                          <td className="px-2 py-2 text-right text-base font-semibold tabular-nums">{p.active}</td>
                          <td className="w-40 px-2 py-2">
                            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
                              {seg(p.waiting, '#0ea5e9', 'Chờ nhận')}
                              {seg(p.inProgress, '#0f766e', 'Đang làm')}
                              {seg(p.onHold, '#f59e0b', 'Tạm hoãn')}
                              {seg(p.submitted, '#a855f7', 'Chờ duyệt')}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.submitted || ''}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {p.overdue ? <Link href={listHref(p, '&due=overdue')} className="font-semibold text-red-600 hover:underline">{p.overdue}</Link> : ''}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.dueWeek || ''}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.urgent ? <span className="text-amber-700">{p.urgent}</span> : ''}</td>
                          <td className="px-2 py-2 text-right tabular-nums" title={p.noEstimate ? `${p.noEstimate} việc chưa ước lượng giờ` : undefined}>
                            {p.remainingHours ? `${p.remainingHours} g` : ''}{p.noEstimate ? <span className="text-[10px] text-[var(--muted-foreground)]"> +{p.noEstimate}?</span> : null}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.hours7 ? `${p.hours7} g` : ''}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.done30 ? <>{p.done30} <span className="text-[11px] text-[var(--muted-foreground)]">· {pct(p.onTimeRate30)}</span></> : ''}</td>
                          {canAssign ? (
                            <td className="px-2 py-2 text-right">
                              <Button size="sm" variant="ghost" title={`Giao việc cho ${p.name}`} onClick={() => setAssignTo(p.userId)}><Plus /> Giao</Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <TaskFormDialog
        open={assignTo !== null}
        onClose={() => setAssignTo(null)}
        defaults={assignTo ? { assigneeIds: [assignTo], projectId: projectId ? Number(projectId) : undefined } : undefined}
      />
    </div>
  );
}
