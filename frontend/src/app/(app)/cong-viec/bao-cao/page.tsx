'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CheckCircle2, Download, FileSpreadsheet, FileText, ListChecks, Printer, Timer, TrendingUp, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { TaskSubnav } from '@/components/tasks/task-ui';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { STATUS_COLOR, TASK_PRINT_DOCS, printTaskDocument, taskKeys, tasksApi, todayVN, type PerfRow, type ReportQuery } from '@/lib/tasks';

const PRIORITY_COLOR: Record<string, string> = { LOW: '#94a3b8', NORMAL: '#0ea5e9', HIGH: '#f59e0b', URGENT: '#dc2626' };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

function monthStart() {
  const t = todayVN();
  return `${t.slice(0, 8)}01`;
}

const PRESETS: Array<{ key: string; label: string; range: () => [string, string] }> = [
  { key: 'month', label: 'Tháng này', range: () => [monthStart(), todayVN()] },
  {
    key: 'last',
    label: 'Tháng trước',
    range: () => {
      const [y, m] = todayVN().split('-').map(Number) as [number, number];
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return [`${py}-${String(pm).padStart(2, '0')}-01`, `${py}-${String(pm).padStart(2, '0')}-${last}`];
    },
  },
  {
    key: 'quarter',
    label: 'Quý này',
    range: () => {
      const [y, m] = todayVN().split('-').map(Number) as [number, number];
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return [`${y}-${String(qm).padStart(2, '0')}-01`, todayVN()];
    },
  },
  { key: 'year', label: 'Năm nay', range: () => [`${todayVN().slice(0, 4)}-01-01`, todayVN()] },
];

export default function TaskReportPage() {
  const [q, setQ] = useState<ReportQuery>(() => ({ from: monthStart(), to: todayVN(), granularity: 'day' }));
  const [tab, setTab] = useState('people');
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const overview = useQuery({ queryKey: taskKeys.report('overview', q), queryFn: () => tasksApi.reportOverview(q) });
  const perf = useQuery({ queryKey: taskKeys.report('performance', q), queryFn: () => tasksApi.reportPerformance(q) });
  const perms = meta.data?.permissions;
  const k = overview.data?.kpi;

  const exportAs = (format: 'xlsx' | 'csv' | 'docx') =>
    downloadFile(tasksApi.reportExportPath(q, format), `bao-cao-cong-viec_${q.from}_${q.to}.${format}`).catch((e: Error) => toast.error(e.message));
  const printParams = { tu_ngay: q.from, den_ngay: q.to, khoa: q.departmentId ? Number(q.departmentId) : null };
  const print = (doc: string) => printTaskDocument(doc, printParams, q.departmentId ? Number(q.departmentId) : null).catch((e: Error) => toast.error(e.message));

  const statusData = useMemo(() => (overview.data?.byStatus ?? []).filter((s) => s.count > 0), [overview.data]);

  if (meta.data && !perms?.canReport) {
    return (
      <div>
        <PageHeader title="Báo cáo công việc" />
        <TaskSubnav />
        <EmptyState title="Bạn chưa có quyền xem báo cáo" description="Cần quyền “Xem báo cáo công việc” (task.report)." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Báo cáo & hiệu suất công việc"
        description="Thống kê theo kỳ: giao — hoàn thành — đúng/trễ hạn — bị trả lại — giờ công; xếp hạng hiệu suất nhân viên, khoa/phòng, dự án."
        actions={
          <>
            {perms?.canPrint ? (
              <>
                <Button variant="outline" size="sm" onClick={() => print(TASK_PRINT_DOCS.situation)}><Printer /> In tình hình</Button>
                <Button variant="outline" size="sm" onClick={() => print(TASK_PRINT_DOCS.performance)}><Printer /> In hiệu suất</Button>
              </>
            ) : null}
            {perms?.canExport ? (
              <>
                <Button variant="outline" size="sm" onClick={() => exportAs('xlsx')}><FileSpreadsheet /> Excel</Button>
                <Button variant="outline" size="sm" onClick={() => exportAs('docx')}><FileText /> Word</Button>
                <Button variant="ghost" size="sm" onClick={() => exportAs('csv')}><Download /> CSV</Button>
              </>
            ) : null}
          </>
        }
      />
      <TaskSubnav />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {PRESETS.map((p) => {
              const [f, t] = p.range();
              const on = q.from === f && q.to === t;
              return (
                <button key={p.key} type="button" onClick={() => setQ({ ...q, from: f, to: t, granularity: p.key === 'year' ? 'month' : p.key === 'quarter' ? 'week' : 'day' })}
                  className={cn('rounded-md border px-2.5 py-1.5 text-sm', on ? 'border-teal-700 bg-teal-700 text-white' : 'hover:bg-[var(--muted)]')}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <Input type="date" className="w-40" value={q.from} max={q.to} onChange={(e) => e.target.value && setQ({ ...q, from: e.target.value })} />
          <span className="pb-2">→</span>
          <Input type="date" className="w-40" value={q.to} min={q.from} onChange={(e) => e.target.value && setQ({ ...q, to: e.target.value })} />
          <Select className="w-32" value={q.granularity} onChange={(e) => setQ({ ...q, granularity: e.target.value as ReportQuery['granularity'] })}>
            <option value="day">Theo ngày</option>
            <option value="week">Theo tuần</option>
            <option value="month">Theo tháng</option>
          </Select>
          {meta.data && meta.data.departments.length > 1 ? (
            <Select className="w-56" value={q.departmentId ?? ''} onChange={(e) => setQ({ ...q, departmentId: e.target.value || undefined })}>
              <option value="">{perms?.seesAll ? 'Toàn viện' : 'Mọi khoa trong phạm vi'}</option>
              {meta.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          ) : null}
          <Select className="w-56" value={q.projectId ?? ''} onChange={(e) => setQ({ ...q, projectId: e.target.value || undefined })}>
            <option value="">Mọi dự án</option>
            {meta.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Kỳ báo cáo tính theo ngày giao việc; số hoàn thành theo ngày hoàn thành. Không tính việc nháp.</p>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Được giao" value={k?.assigned ?? '…'} icon={<ListChecks className="size-4" />} hint={k ? `${k.cancelled} đã hủy` : undefined} />
        <StatCard label="Hoàn thành" value={k?.done ?? '…'} tone="success" icon={<CheckCircle2 className="size-4" />} hint={k ? `Tỷ lệ ${pct(k.completionRate)}` : undefined} />
        <StatCard label="Đúng hạn" value={k ? pct(k.onTimeRate) : '…'} tone="success" icon={<Timer className="size-4" />} hint={k ? `${k.onTime} đúng · ${k.late} trễ` : undefined} />
        <StatCard label="Đang mở" value={k?.open ?? '…'} tone="primary" hint={k ? `${k.waiting} chờ nhận · ${k.inProgress} đang làm` : undefined} />
        <StatCard label="Chờ duyệt" value={k?.submitted ?? '…'} tone="warning" />
        <StatCard label="Quá hạn" value={k?.overdue ?? '…'} tone="danger" icon={<AlarmClock className="size-4" />} />
        <StatCard label="Bị trả lại" value={k ? pct(k.returnRate) : '…'} icon={<Undo2 className="size-4" />} hint={k ? `${k.returnTimes} lượt trả` : undefined} />
        <StatCard label="Điểm hiệu suất" value={k?.score ?? '—'} tone="primary" icon={<TrendingUp className="size-4" />} hint={k ? `${k.hours} giờ công` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Xu hướng giao & hoàn thành" />
          <CardBody className="h-72">
            {overview.isLoading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overview.data?.series ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="onTime" name="Xong đúng hạn" stackId="d" fill="#16a34a" />
                  <Bar dataKey="late" name="Xong trễ hạn" stackId="d" fill="#ea580c" />
                  <Line type="monotone" dataKey="assigned" name="Được giao" stroke="#0f766e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="done" name="Hoàn thành" stroke="#2563eb" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Theo trạng thái" />
          <CardBody className="h-72">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {statusData.map((s) => <Cell key={s.status} fill={STATUS_COLOR[s.status]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Không có dữ liệu" />}
          </CardBody>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Theo mức ưu tiên" />
          <CardBody className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.data?.byPriority ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Số việc">{(overview.data?.byPriority ?? []).map((p) => <Cell key={p.priority} fill={PRIORITY_COLOR[p.priority]} />)}</Bar>
                <Bar dataKey="overdue" name="Quá hạn" fill="#dc2626" opacity={0.55} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Theo khoa/phòng" />
          <CardBody className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(overview.data?.byDepartment ?? []).slice(0, 12)} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="onTime" name="Đúng hạn" stackId="a" fill="#16a34a" />
                <Bar dataKey="late" name="Trễ hạn" stackId="a" fill="#ea580c" />
                <Bar dataKey="open" name="Đang mở" stackId="a" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      <Card className="p-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: 'people', label: 'Nhân viên', badge: perf.data?.people.length || undefined, content: <PerfTable rows={perf.data?.people} loading={perf.isLoading} first="Nhân viên" /> },
            { key: 'depts', label: 'Khoa/phòng', content: <PerfTable rows={perf.data?.departments} loading={perf.isLoading} first="Khoa/phòng" /> },
            { key: 'projects', label: 'Dự án', content: <PerfTable rows={perf.data?.projects} loading={perf.isLoading} first="Dự án" /> },
          ]}
        />
        {perf.data?.formula ? <p className="mt-2 text-xs italic text-[var(--muted-foreground)]">{perf.data.formula}. Tỷ lệ bị trả lại tính trên số việc đã từng gửi duyệt.</p> : null}
      </Card>
    </div>
  );
}

function ScoreBar({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  const color = v >= 85 ? '#16a34a' : v >= 70 ? '#0ea5e9' : v >= 50 ? '#f59e0b' : '#dc2626';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full" style={{ width: `${v}%`, background: color }} /></div>
      <b style={{ color }}>{v}</b>
    </div>
  );
}

function PerfTable({ rows, loading, first }: { rows?: PerfRow[]; loading: boolean; first: string }) {
  if (loading) return <Skeleton className="h-40" />;
  if (!rows?.length) return <EmptyState title="Không có dữ liệu trong kỳ" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-[var(--muted)] text-right text-xs text-[var(--muted-foreground)]">
          <tr>
            <th className="w-8 px-2 py-2 text-left">#</th>
            <th className="px-2 py-2 text-left">{first}</th>
            <th className="px-2 py-2">Giao</th>
            <th className="px-2 py-2">Xong</th>
            <th className="px-2 py-2">Đúng hạn</th>
            <th className="px-2 py-2">Trễ</th>
            <th className="px-2 py-2">Đang mở</th>
            <th className="px-2 py-2">Quá hạn</th>
            <th className="px-2 py-2">Bị trả lại</th>
            <th className="px-2 py-2">Hoàn thành</th>
            <th className="px-2 py-2">Đúng hạn %</th>
            <th className="px-2 py-2">TB giờ/việc</th>
            <th className="px-2 py-2">Giờ công</th>
            <th className="px-2 py-2 text-left">Điểm</th>
          </tr>
        </thead>
        <tbody className="divide-y text-right">
          {rows.map((r, i) => (
            <tr key={`${r.key}-${i}`} className="hover:bg-[var(--muted)]">
              <td className="px-2 py-1.5 text-left text-[var(--muted-foreground)]">{i + 1}</td>
              <td className="px-2 py-1.5 text-left"><div className="font-medium">{r.name}</div>{r.extra ? <div className="text-[11px] text-[var(--muted-foreground)]">{r.extra}</div> : null}</td>
              <td className="px-2 py-1.5">{r.assigned}</td>
              <td className="px-2 py-1.5 text-emerald-700">{r.done}</td>
              <td className="px-2 py-1.5">{r.onTime}</td>
              <td className={cn('px-2 py-1.5', r.late && 'text-orange-600')}>{r.late}</td>
              <td className="px-2 py-1.5">{r.open}</td>
              <td className={cn('px-2 py-1.5', r.overdue && 'font-semibold text-red-600')}>{r.overdue}</td>
              <td className="px-2 py-1.5">{r.returned}{r.returnTimes > r.returned ? <span className="text-[11px] text-[var(--muted-foreground)]"> ({r.returnTimes} lượt)</span> : null}</td>
              <td className="px-2 py-1.5">{pct(r.completionRate)}</td>
              <td className="px-2 py-1.5">{pct(r.onTimeRate)}</td>
              <td className="px-2 py-1.5">{r.avgHours ?? '—'}</td>
              <td className="px-2 py-1.5">{r.hours}</td>
              <td className="px-2 py-1.5 text-left"><ScoreBar v={r.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
