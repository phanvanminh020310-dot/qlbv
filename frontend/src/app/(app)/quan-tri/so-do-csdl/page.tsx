'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Database, GitBranch, KeyRound, Network, RefreshCw, Search, TableProperties } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SqlSchemaResponse, SqlSchemaTable } from '@/lib/sql-schema';

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('vi-VN');
}

function TableNode({ table, focused, onFocus }: { table: SqlSchemaTable; focused: boolean; onFocus: (name: string) => void }) {
  const foreignKeys = table.foreignKeys ?? [];
  return <button type="button" onClick={() => onFocus(table.name)} className={`min-h-44 w-full rounded-xl border text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${focused ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-100' : 'border-slate-200 bg-white'}`}>
    <div className={`flex items-center justify-between gap-2 rounded-t-xl px-3 py-2.5 ${focused ? 'bg-sky-700 text-white' : 'bg-slate-800 text-white'}`}><span className="flex min-w-0 items-center gap-2 font-mono text-sm font-bold"><TableProperties className="size-4 shrink-0" />{table.name}</span><span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px]">{table.columns.length}</span></div>
    <div className="space-y-1.5 p-3 font-mono text-xs">
      {table.columns.slice(0, 11).map((column) => {
        const foreignKey = foreignKeys.find((item) => item.column === column.name);
        return <div key={column.name} className="flex items-start gap-1.5"><span className={`mt-0.5 shrink-0 ${column.primaryKey ? 'text-amber-600' : foreignKey ? 'text-violet-600' : 'text-slate-300'}`}>{column.primaryKey ? <KeyRound className="size-3" /> : foreignKey ? <GitBranch className="size-3" /> : '•'}</span><span className="min-w-0 flex-1"><b className={column.primaryKey ? 'text-amber-800' : ''}>{column.name}</b><span className="ml-1 text-[10px] text-slate-400">{column.type}</span>{foreignKey ? <span className="ml-1 text-[10px] text-violet-700">→ {foreignKey.referencedTable}.{foreignKey.referencedColumn}</span> : null}</span></div>;
      })}
      {table.columns.length > 11 ? <p className="pt-1 text-[10px] text-slate-500">… và {table.columns.length - 11} cột khác</p> : null}
    </div>
  </button>;
}

/** ERD read-only generated from PostgreSQL PK/FK metadata. */
export default function DatabaseRelationModelPage() {
  const user = useAuth((state) => state.user);
  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
  const [filter, setFilter] = useState('');
  const [focusedTable, setFocusedTable] = useState('');
  const schema = useQuery({ queryKey: ['sql-console-schema'], queryFn: () => apiFetch<SqlSchemaResponse>('/admin/sql/schema'), enabled: isAdmin, staleTime: 5 * 60_000 });
  const allTables = schema.data?.tables ?? [];
  const relations = useMemo(() => allTables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ sourceTable: table.name, ...foreignKey }))), [allTables]);
  const normalizedFilter = normalize(filter.trim());
  const displayedTables = useMemo(() => allTables.filter((table) => !normalizedFilter || normalize(`${table.name} ${table.columns.map((column) => column.name).join(' ')}`).includes(normalizedFilter)).sort((left, right) => left.name.localeCompare(right.name)), [allTables, normalizedFilter]);
  const activeName = focusedTable || displayedTables[0]?.name || '';
  const activeTable = allTables.find((table) => table.name === activeName);
  const relatedToActive = useMemo(() => relations.filter((relation) => relation.sourceTable === activeName || relation.referencedTable === activeName), [activeName, relations]);

  if (!isAdmin) return <EmptyState title="Sơ đồ quan hệ CSDL chỉ dành cho quản trị hệ thống" description="Thông tin bảng, khóa chính và khóa ngoại chỉ được mở cho ADMIN hoặc SUPER_ADMIN." />;

  return <div className="space-y-5">
    <PageHeader title="Sơ đồ quan hệ CSDL" description="Mô hình dữ liệu được đọc trực tiếp từ PostgreSQL: PK, FK và luồng tham chiếu luôn khớp schema đang chạy." actions={<><Link href="/quan-tri/truy-van-sql"><Button variant="outline"><ArrowLeft /> SQL Console</Button></Link><Button variant="outline" onClick={() => schema.refetch()} loading={schema.isFetching}><RefreshCw /> Làm mới</Button></>} />

    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="border-sky-200 bg-sky-50/60"><CardBody className="flex items-center gap-3 py-3"><Database className="size-7 text-sky-700" /><div><p className="text-2xl font-bold text-sky-950">{allTables.length}</p><p className="text-xs text-sky-800">Bảng public</p></div></CardBody></Card>
      <Card className="border-amber-200 bg-amber-50/60"><CardBody className="flex items-center gap-3 py-3"><KeyRound className="size-7 text-amber-700" /><div><p className="text-2xl font-bold text-amber-950">{allTables.reduce((total, table) => total + table.primaryKey.length, 0)}</p><p className="text-xs text-amber-800">Cột khóa chính</p></div></CardBody></Card>
      <Card className="border-violet-200 bg-violet-50/60"><CardBody className="flex items-center gap-3 py-3"><GitBranch className="size-7 text-violet-700" /><div><p className="text-2xl font-bold text-violet-950">{relations.length}</p><p className="text-xs text-violet-800">Liên kết khóa ngoại</p></div></CardBody></Card>
    </div>

    <Card className="border-slate-200"><CardBody className="flex flex-wrap items-center gap-3 py-3"><div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc theo bảng hoặc cột…" className="pl-9" /></div><div className="flex flex-wrap items-center gap-3 text-xs text-slate-600"><span className="inline-flex items-center gap-1"><KeyRound className="size-3.5 text-amber-600" /> PK</span><span className="inline-flex items-center gap-1"><GitBranch className="size-3.5 text-violet-600" /> FK → bảng đích</span><span>Chọn một bảng để xem luồng liên quan.</span></div></CardBody></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden border-slate-200"><CardHeader title="Bản đồ bảng và khóa" description="Mỗi thẻ là một bảng. Mũi tên tại cột FK chỉ tới bảng/cột được tham chiếu." actions={<Badge tone="muted">{displayedTables.length}/{allTables.length} bảng</Badge>} /><CardBody className="thin-scroll max-h-[calc(100vh-18rem)] overflow-auto bg-slate-50 p-4"><div className="grid min-w-[46rem] gap-4 md:grid-cols-2 2xl:grid-cols-3">{schema.isLoading ? Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-52" />) : displayedTables.map((table) => <TableNode key={table.name} table={table} focused={table.name === activeName} onFocus={setFocusedTable} />)}</div>{!schema.isLoading && displayedTables.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Không tìm thấy bảng/cột phù hợp.</div> : null}</CardBody></Card>

      <aside className="space-y-5">
        <Card className="border-sky-200"><CardHeader title="Luồng quan hệ" description={activeTable ? `Các liên kết đi/đến ${activeTable.name}` : 'Chọn bảng trong sơ đồ'} /><CardBody className="space-y-3">{activeTable ? <><div className="rounded-lg bg-slate-900 p-3 font-mono text-sm text-white"><Network className="mr-2 inline size-4 text-sky-300" />{activeTable.name}<span className="ml-2 text-xs text-slate-300">PK: {activeTable.primaryKey.join(', ') || '—'}</span></div>{relatedToActive.length ? relatedToActive.map((relation) => <div key={`${relation.name}:${relation.sourceTable}:${relation.column}`} className="rounded-lg border border-violet-200 bg-violet-50/60 p-3"><p className="flex flex-wrap items-center gap-1 font-mono text-xs font-semibold text-violet-950"><span>{relation.sourceTable}.{relation.column}</span><span className="text-violet-500">→</span><span>{relation.referencedTable}.{relation.referencedColumn}</span></p><p className="mt-1 text-[11px] text-violet-800">{relation.name} · khi xóa: {relation.onDelete} · khi sửa khóa: {relation.onUpdate}</p></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Bảng này hiện không có liên kết khóa ngoại khai báo trong schema public.</p>}</> : <p className="text-sm text-slate-500">Chưa có dữ liệu schema.</p>}</CardBody></Card>
        <Card><CardHeader title="Cách đọc" /><CardBody className="space-y-2 text-sm text-slate-600"><p><b className="text-amber-700">PK</b> định danh duy nhất một dòng.</p><p><b className="text-violet-700">FK</b> là cột tham chiếu đến PK/unique key ở bảng khác; hướng mũi tên là từ bảng lưu khóa ngoại đến bảng đích.</p><p>Dùng SQL Console khi cần xem dữ liệu; sơ đồ này chỉ đọc metadata, không có khả năng thay đổi CSDL.</p></CardBody></Card>
      </aside>
    </div>
  </div>;
}
