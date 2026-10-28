'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Database,
  FileJson,
  FileSpreadsheet,
  FileText,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  TableProperties,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const WRITE_CONFIRM_TEXT = 'THUC THI';
const INITIAL_SQL = `select id, username, full_name, active, created_at\nfrom users\norder by id\nlimit 100`;
const STORAGE_KEY = 'qlbs.sql-console.history.v1';

type ExportFormat = 'xlsx' | 'csv' | 'json';
interface SchemaColumn { name: string; type: string; nullable: boolean; default: string | null }
interface SchemaTable { name: string; columns: SchemaColumn[] }
interface SchemaResponse { tables: SchemaTable[] }
interface QueryResult {
  operation: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}
interface ExecuteResult { operation: string; affectedRows: number; elapsedMs: number; message: string }
interface HistoryEntry { statement: string; kind: 'QUERY' | 'WRITE'; at: string }

const snippets = [
  { label: 'Xem dữ liệu bảng', sql: 'select *\nfrom users\norder by id\nlimit 100' },
  { label: 'Đếm số dòng', sql: 'select count(*) as total\nfrom users' },
  { label: 'Tìm người dùng', sql: "select id, username, full_name, active\nfrom users\nwhere username ilike '%ten-can-tim%'\norder by username\nlimit 100" },
  { label: 'Kiểm tra kế hoạch', sql: 'explain\nselect *\nfrom users\nwhere active = true' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể thực hiện thao tác';
}

function sqlKind(statement: string): 'READ' | 'WRITE' | 'UNKNOWN' {
  const first = statement.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  if (['INSERT', 'UPDATE', 'DELETE'].includes(first ?? '')) return 'WRITE';
  if (['SELECT', 'WITH', 'EXPLAIN'].includes(first ?? '')) return 'READ';
  return 'UNKNOWN';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** SQL Console — công cụ kỹ thuật có kiểm soát, chỉ ADMIN/SUPER_ADMIN thấy và dùng được. */
export default function SqlConsolePage() {
  const user = useAuth((state) => state.user);
  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
  const [statement, setStatement] = useState(INITIAL_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [writeDialog, setWriteDialog] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showSchema, setShowSchema] = useState(true);
  const [resultFilter, setResultFilter] = useState('');

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as HistoryEntry[];
      setHistory(Array.isArray(value) ? value.slice(0, 12) : []);
    } catch {
      /* Bỏ qua lịch sử cục bộ hỏng. */
    }
  }, []);

  const remember = (kind: HistoryEntry['kind']) => {
    const clean = statement.trim();
    if (!clean) return;
    setHistory((previous) => {
      const next = [{ statement: clean, kind, at: new Date().toISOString() }, ...previous.filter((item) => item.statement !== clean)].slice(0, 12);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* localStorage có thể bị chặn */ }
      return next;
    });
  };

  const schema = useQuery({
    queryKey: ['sql-console-schema'],
    queryFn: () => apiFetch<SchemaResponse>('/admin/sql/schema'),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const query = useMutation({
    mutationFn: () => apiFetch<QueryResult>('/admin/sql/query', { method: 'POST', body: { statement } }),
    onSuccess: (data) => {
      setResult(data);
      setResultFilter('');
      remember('QUERY');
      toast.success(`Đã lấy ${data.rowCount.toLocaleString('vi-VN')} dòng trong ${data.elapsedMs} ms`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const execute = useMutation({
    mutationFn: () => apiFetch<ExecuteResult>('/admin/sql/execute', {
      method: 'POST', body: { statement, reason, confirm },
    }),
    onSuccess: (data) => {
      remember('WRITE');
      setResult(null);
      setWriteDialog(false);
      setReason('');
      setConfirm('');
      toast.success(data.message);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const kind = sqlKind(statement);
  const tableCount = schema.data?.tables.length ?? 0;
  const canExecuteWrite = kind === 'WRITE' && reason.trim().length >= 5 && confirm.trim().toUpperCase() === WRITE_CONFIRM_TEXT;
  const columns = result?.columns ?? [];
  const normalizedFilter = resultFilter.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('vi-VN');
  const visibleRows = useMemo(() => {
    if (!result || !normalizedFilter) return result?.rows ?? [];
    return result.rows.filter((row) => columns.some((column) => (
      formatValue(row[column]).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('vi-VN').includes(normalizedFilter)
    )));
  }, [columns, normalizedFilter, result]);
  const canExport = kind === 'READ' && !!statement.trim();

  const exportResult = async (format: ExportFormat) => {
    const extension = format === 'xlsx' ? 'xlsx' : format;
    try {
      await downloadFile('/admin/sql/export', `sql-console-${new Date().toISOString().slice(0, 10)}.${extension}`, {
        method: 'POST', body: { statement, format },
      });
      toast.success(`Đã xuất ${format.toUpperCase()}`);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const schemaTables = useMemo(() => schema.data?.tables ?? [], [schema.data]);

  if (!isAdmin) {
    return (
      <EmptyState
        title="SQL Console chỉ dành cho quản trị hệ thống"
        description="Công cụ này chỉ mở cho tài khoản có vai trò ADMIN hoặc SUPER_ADMIN. Mọi truy vấn đều được kiểm soát và ghi nhật ký kiểm toán."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="SQL Console"
        description="Truy vấn và điều chỉnh dữ liệu có kiểm soát. Chỉ dùng khi đã sao lưu và hiểu rõ tác động nghiệp vụ."
        actions={
          <>
            <Button variant="outline" onClick={() => schema.refetch()} loading={schema.isFetching}>
              <RefreshCw /> Làm mới schema
            </Button>
            <Button variant="outline" onClick={() => setShowSchema((value) => !value)}>
              <TableProperties /> {showSchema ? 'Ẩn schema' : `Schema (${tableCount})`}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardBody className="flex gap-3 py-3 text-sm text-amber-900 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <b>Vùng kỹ thuật có kiểm soát.</b> SELECT/WITH/EXPLAIN chạy ở giao dịch chỉ đọc. INSERT/UPDATE/DELETE cần lý do, gõ xác nhận và UPDATE/DELETE luôn phải có <code>WHERE</code>. Không hỗ trợ DDL, nhiều câu lệnh, hay sửa nhật ký/migration.
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Câu lệnh SQL"
              description="Không thêm dấu chấm phẩy. Kết quả xem trước tối đa 1.000 dòng; xuất tối đa 10.000 dòng."
              actions={<Badge tone={kind === 'WRITE' ? 'warning' : kind === 'READ' ? 'success' : 'muted'}>{kind === 'WRITE' ? 'Thao tác ghi' : kind === 'READ' ? 'Chỉ đọc' : 'Chưa hỗ trợ'}</Badge>}
            />
            <CardBody className="space-y-3">
              <Textarea
                aria-label="Câu lệnh SQL"
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                rows={12}
                spellCheck={false}
                className="min-h-[260px] resize-y font-mono text-sm leading-6"
              />
              <div className="flex flex-wrap gap-2">
                {snippets.map((item) => (
                  <Button key={item.label} size="sm" variant="outline" onClick={() => setStatement(item.sql)}>{item.label}</Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Button onClick={() => query.mutate()} loading={query.isPending} disabled={kind !== 'READ' || !statement.trim()}>
                  <Play /> Chạy truy vấn
                </Button>
                <Button variant="danger" onClick={() => setWriteDialog(true)} disabled={kind !== 'WRITE' || !statement.trim()}>
                  <AlertTriangle /> Thực thi thay đổi
                </Button>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">Mọi lệnh đã chạy được ghi vào Nhật ký kiểm toán.</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Kết quả truy vấn"
              description={result ? `${result.operation} · ${result.rowCount.toLocaleString('vi-VN')} dòng · ${result.elapsedMs} ms${result.truncated ? ' · đã rút gọn khi xem trước' : ''}${normalizedFilter ? ` · lọc còn ${visibleRows.length.toLocaleString('vi-VN')} dòng` : ''}` : 'Chạy một câu lệnh SELECT, WITH hoặc EXPLAIN để xem dữ liệu.'}
              actions={
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={!canExport} onClick={() => void exportResult('xlsx')} title="Xuất Excel"><FileSpreadsheet /> Excel</Button>
                  <Button size="sm" variant="outline" disabled={!canExport} onClick={() => void exportResult('csv')} title="Xuất CSV"><FileText /> CSV</Button>
                  <Button size="sm" variant="outline" disabled={!canExport} onClick={() => void exportResult('json')} title="Xuất JSON"><FileJson /> JSON</Button>
                </div>
              }
            />
            <CardBody className="p-0">
              {!result ? (
                <div className="p-8 text-center text-sm text-[var(--muted-foreground)]"><Terminal className="mx-auto mb-2 size-7 opacity-50" />Chưa có kết quả để hiển thị.</div>
              ) : columns.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">Truy vấn không trả về cột dữ liệu.</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                    <div className="relative min-w-0 flex-1">
                      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                      <Input
                        aria-label="Lọc kết quả hiện tại"
                        type="search"
                        value={resultFilter}
                        onChange={(event) => setResultFilter(event.target.value)}
                        placeholder="Lọc trong các dòng đang hiển thị…"
                        className="pl-9"
                      />
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {normalizedFilter ? `${visibleRows.length.toLocaleString('vi-VN')} / ${result.rows.length.toLocaleString('vi-VN')} dòng` : `${result.rows.length.toLocaleString('vi-VN')} dòng đang hiển thị`}
                    </span>
                  </div>
                  <TableWrap className="max-h-[540px] rounded-none border-0">
                    <thead className="sticky top-0 z-10 bg-[var(--card)]"><Tr>{columns.map((column) => <Th key={column} className="whitespace-nowrap font-mono text-xs">{column}</Th>)}</Tr></thead>
                    <tbody>
                      {visibleRows.length === 0 ? (
                        <Tr><Td colSpan={columns.length} className="p-6 text-center text-sm text-[var(--muted-foreground)]">Không tìm thấy dòng nào khớp bộ lọc hiện tại.</Td></Tr>
                      ) : visibleRows.map((row, index) => (
                        <Tr key={index}>
                          {columns.map((column) => (
                            <Td key={column} className="max-w-[360px] whitespace-pre-wrap break-words font-mono text-xs">{formatValue(row[column])}</Td>
                          ))}
                        </Tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          {showSchema ? (
            <Card>
              <CardHeader title="Schema CSDL" description={`${tableCount.toLocaleString('vi-VN')} bảng trong public`} />
              <CardBody className="thin-scroll max-h-[540px] space-y-2 overflow-y-auto">
                {schema.isLoading ? <Skeleton className="h-48 w-full" /> : null}
                {schemaTables.map((table) => (
                  <details key={table.name} className="rounded-lg border p-2" open={table.name === 'users'}>
                    <summary className="cursor-pointer font-mono text-sm font-semibold">{table.name} <span className="text-xs font-normal text-[var(--muted-foreground)]">({table.columns.length})</span></summary>
                    <div className="mt-2 space-y-1 border-t pt-2">
                      {table.columns.map((column) => <div key={column.name} className="font-mono text-[11px]"><b>{column.name}</b> <span className="text-[var(--muted-foreground)]">{column.type}{column.nullable ? '' : ' · not null'}</span></div>)}
                      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setStatement(`select *\nfrom ${table.name}\nlimit 100`)}><Database /> Xem 100 dòng</Button>
                    </div>
                  </details>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Lịch sử tại máy này" description="Tối đa 12 câu lệnh gần đây; lịch sử chính thức nằm trong Nhật ký kiểm toán." />
            <CardBody className="space-y-2">
              {history.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">Chưa có câu lệnh nào.</p> : history.map((item, index) => (
                <button key={`${item.at}-${index}`} type="button" onClick={() => setStatement(item.statement)} className="block w-full rounded-lg border p-2 text-left hover:bg-[var(--muted)]">
                  <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]"><ClipboardList className="size-3" /> {item.kind === 'WRITE' ? 'Ghi' : 'Đọc'} · {new Date(item.at).toLocaleString('vi-VN')}</span>
                  <span className="mt-1 line-clamp-3 block font-mono text-xs">{item.statement}</span>
                </button>
              ))}
            </CardBody>
          </Card>
        </aside>
      </div>

      <Dialog
        open={writeDialog}
        onClose={() => { if (!execute.isPending) { setWriteDialog(false); setConfirm(''); } }}
        title="Xác nhận thay đổi trực tiếp CSDL"
        description="Câu lệnh sẽ chạy trong giao dịch. Nếu có lỗi, toàn bộ câu lệnh được rollback. Hãy sao lưu trước các thay đổi lớn."
        footer={<><Button variant="ghost" onClick={() => setWriteDialog(false)} disabled={execute.isPending}>Huỷ</Button><Button variant="danger" disabled={!canExecuteWrite || execute.isPending} onClick={() => execute.mutate()} loading={execute.isPending}><CheckCircle2 /> Xác nhận thực thi</Button></>}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <b>{kind}</b> chỉ được thực hiện bởi ADMIN/SUPER_ADMIN. Toàn bộ câu lệnh, lý do, số dòng tác động và thời điểm được ghi vào Nhật ký kiểm toán.
          </div>
          <pre className="thin-scroll max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{statement}</pre>
          <div className="space-y-1.5"><Label htmlFor="sql-reason">Lý do thay đổi *</Label><Textarea id="sql-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: Sửa trạng thái dữ liệu nhập sai theo biên bản số…" /></div>
          <div className="space-y-1.5"><Label htmlFor="sql-confirm">Gõ <b>{WRITE_CONFIRM_TEXT}</b> để xác nhận *</Label><Input id="sql-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" /></div>
        </div>
      </Dialog>
    </div>
  );
}
