'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArchiveRestore,
  DatabaseBackup,
  Download,
  FileSearch,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/utils';

interface BackupItem {
  name: string;
  /** Tổng dung lượng bộ backup: JSON CSDL + archive uploads nếu có. */
  size: number;
  databaseSize: number;
  storageName: string | null;
  storageSize: number;
  storageIncluded: boolean;
  createdAt: string;
  kind: 'normal' | 'pre-restore' | 'uploaded';
  legacy: boolean;
}

interface BackupList {
  dir: string;
  items: BackupItem[];
  total: number;
  totalSize: number;
  diskFree: number | null;
  restoring: boolean;
  retention: { keepCount: number; exportRetentionDays: number; temporaryRetentionHours: number };
}

interface BackupDetail {
  name: string;
  size: number;
  databaseSize: number;
  createdAt: string;
  version: number;
  tables: number;
  totalRows: number;
  counts: Record<string, number>;
  storage: { included: boolean; portable: boolean; fileName: string | null; size: number };
  restorable: boolean;
  reason?: string;
}

interface RestoreResult {
  message: string;
  safetyBackup: string;
  rows: number;
  tables: number;
}

const CONFIRM_TEXT = 'PHUC HOI';

/** Tên bảng → nhãn dễ hiểu cho người dùng */
const TABLE_LABELS: Record<string, string> = {
  users: 'Người dùng',
  roles: 'Vai trò',
  permissions: 'Quyền',
  role_permissions: 'Quyền của vai trò',
  user_roles: 'Vai trò của người dùng',
  user_department_scopes: 'Phạm vi khoa',
  departments: 'Khoa / phòng',
  hsba_requests: 'Phiếu hồ sơ bệnh án',
  hsba_signatures: 'Chữ ký phiếu HSBA',
  hsba_logs: 'Nhật ký phiếu HSBA',
  hsba_workflows: 'Quy trình ký HSBA',
  report_templates: 'Mẫu báo cáo',
  report_entries: 'Số liệu báo cáo',
  report_entry_audits: 'Lịch sử sửa số liệu',
  report_snapshots: 'Bản chốt báo cáo',
  print_templates: 'Mẫu in',
  print_template_versions: 'Phiên bản mẫu in',
  audit_logs: 'Nhật ký kiểm toán',
  login_logs: 'Nhật ký đăng nhập',
  notifications: 'Thông báo',
  settings: 'Cấu hình',
  scheduled_jobs: 'Tác vụ định kỳ',
  job_runs: 'Lịch sử chạy tác vụ',
  utilities: 'Tiện ích',
  attachments: 'Tệp đính kèm',
};

function formatSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function KindBadge({ item }: { item: BackupItem }) {
  if (item.legacy) return <Badge tone="muted">Định dạng cũ</Badge>;
  if (item.kind === 'pre-restore') return <Badge tone="warning">Trước phục hồi</Badge>;
  if (item.kind === 'uploaded') return <Badge tone="info">Tải lên</Badge>;
  if (item.name.includes('thu-cong')) return <Badge tone="brand">Thủ công</Badge>;
  return <Badge tone="success">Tự động</Badge>;
}

/** Sao lưu & phục hồi CSDL: tạo bản sao lưu, tải về/tải lên, phục hồi toàn bộ dữ liệu. */
export default function BackupsPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [confirm, setConfirm] = useState('');

  const canCreate = can('backup.create');
  const canRestore = can('backup.restore');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiFetch<BackupList>('/backups'),
  });

  const activeDetail = detailName ?? restoreName;
  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['backup-detail', activeDetail],
    enabled: !!activeDetail,
    queryFn: () => apiFetch<BackupDetail>(`/backups/${encodeURIComponent(activeDetail!)}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backups'] });

  const create = useMutation({
    mutationFn: () => apiFetch<{ message: string }>('/backups', { method: 'POST' }),
    onMutate: () => toast.loading('Đang sao lưu dữ liệu…', { id: 'backup' }),
    onSuccess: async (res) => {
      toast.success(res?.message ?? 'Đã sao lưu', { id: 'backup', duration: 8000 });
      await refresh();
    },
    onError: (err) => toast.error((err as Error).message, { id: 'backup', duration: 10000 }),
  });

  const cleanup = useMutation({
    mutationFn: () => apiFetch<{ message: string }>("/backups/cleanup", { method: "POST" }),
    onMutate: () => toast.loading("Đang dọn theo chính sách lưu trữ…", { id: "backup-cleanup" }),
    onSuccess: async (res) => {
      toast.success(res.message, { id: "backup-cleanup", duration: 8000 });
      setConfirmCleanup(false);
      await refresh();
    },
    onError: (err) => toast.error((err as Error).message, { id: "backup-cleanup", duration: 10000 }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const isPortableBundle = file.name.toLowerCase().endsWith('.bundle.tar.gz');
      return apiFetch<{ message: string; name: string }>(
        `${isPortableBundle ? '/backups/upload/bundle' : '/backups/upload'}?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file },
      );
    },
    onMutate: () => toast.loading('Đang tải backup lên và kiểm tra toàn vẹn…', { id: 'upload' }),
    onSuccess: async (res) => {
      toast.success(`${res.message} → ${res.name}`, { id: 'upload', duration: 8000 });
      await refresh();
      setDetailName(res.name);
    },
    onError: (err) => toast.error((err as Error).message, { id: 'upload', duration: 10000 }),
  });

  const remove = useMutation({
    mutationFn: (name: string) => apiFetch<{ message: string }>(`/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: async (res) => {
      toast.success(res.message);
      setDeleteName(null);
      await refresh();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const restore = useMutation({
    mutationFn: (name: string) =>
      apiFetch<RestoreResult>(`/backups/${encodeURIComponent(name)}/restore`, {
        method: 'POST',
        body: { confirm },
      }),
    onMutate: () => {
      window.__qlbsRestoring = true;
      toast.loading('Đang phục hồi dữ liệu — vui lòng không đóng trang…', { id: 'restore' });
    },
    onSettled: () => {
      window.__qlbsRestoring = false;
    },
    onSuccess: (res) => {
      toast.success(res.message, { id: 'restore', duration: 15000 });
      setRestoreName(null);
      setConfirm('');
      // Dữ liệu đã thay đổi toàn bộ → tải lại ứng dụng để mọi màn hình đọc dữ liệu mới
      setTimeout(() => window.location.reload(), 2500);
    },
    onError: (err) => toast.error((err as Error).message, { id: 'restore', duration: 15000 }),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  };

  const download = async (name: string) => {
    try {
      await downloadFile(`/backups/${encodeURIComponent(name)}/download`, name);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const downloadStorage = async (name: string, storageName: string) => {
    try {
      await downloadFile(`/backups/${encodeURIComponent(name)}/storage/download`, storageName);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const downloadPortableBundle = async (name: string) => {
    try {
      await downloadFile(`/backups/${encodeURIComponent(name)}/bundle/download`, `${name.replace(/\.json(?:\.gz)?$/, '')}.bundle.tar.gz`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Sao lưu & phục hồi"
        description="Sao lưu đầy đủ CSDL và tệp lưu trữ; tự xoay vòng an toàn theo cấu hình, tải về hoặc phục hồi hệ thống về một thời điểm trước đó."
        actions={
          <>
            <Button variant="outline" onClick={() => refetch()} loading={isFetching && !isLoading}>
              <RefreshCw /> Làm mới
            </Button>
            {canCreate ? (
              <Button variant="outline" onClick={() => setConfirmCleanup(true)} loading={cleanup.isPending}>
                <Trash2 /> Dọn theo chính sách
              </Button>
            ) : null}
            {canRestore ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".bundle.tar.gz,.gz,.json,application/gzip,application/json"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button variant="outline" onClick={() => fileInput.current?.click()} loading={upload.isPending}>
                  <Upload /> Tải lên backup / bundle
                </Button>
              </>
            ) : null}
            {canCreate ? (
              <Button onClick={() => create.mutate()} loading={create.isPending}>
                <DatabaseBackup /> Sao lưu ngay
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="px-4 py-3">
          <div className="text-xs text-[var(--muted-foreground)]">Số bản sao lưu</div>
          <div className="text-lg font-semibold">{data ? formatNumber(data.total) : '—'}</div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-xs text-[var(--muted-foreground)]">Dung lượng đang dùng</div>
          <div className="text-lg font-semibold">{data ? formatSize(data.totalSize) : '—'}</div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-xs text-[var(--muted-foreground)]">Ổ đĩa còn trống</div>
          <div className="text-lg font-semibold">{data ? formatSize(data.diskFree) : '—'}</div>
        </Card>
      </div>

      <div className="mb-4 flex gap-2 rounded-[var(--radius-card)] border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <div>
            Bản sao lưu được lưu trên chính máy chủ (thư mục <code className="font-mono text-xs">{data?.dir ?? '…'}</code>
). Nếu máy chủ hỏng ổ đĩa, các bản này cũng mất — mở chi tiết một bộ đầy đủ, chọn <b>Tải bộ đầy đủ</b> (.bundle.tar.gz) và cất ở nơi khác. Tệp đó có thể tải lên lại để phục hồi cả CSDL lẫn tệp lưu trữ.
          </div>
          <div className="text-xs opacity-80">
            Mỗi bộ mới gồm CSDL và tệp lưu trữ (HSBA, phông, ảnh khuôn mặt). Hệ thống chạy lúc 23:30 hằng ngày, đang giữ {data?.retention?.keepCount ?? 3} bộ mới nhất; chỉnh tại <i>Cấu hình hệ thống → Sao lưu & lưu trữ</i>.
          </div>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Chưa có bản sao lưu nào"
            description="Bấm “Sao lưu ngay” để tạo bản đầu tiên."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Thời điểm</Th>
                  <Th>Tệp</Th>
                  <Th>Loại</Th>
                  <Th className="text-right">Dung lượng</Th>
                  <Th className="text-right">Thao tác</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Tr key={item.name}>
                    <Td className="whitespace-nowrap">{formatDateTime(item.createdAt)}</Td>
                    <Td>
                      <span className="font-mono text-xs break-all">{item.name}</span>
                      <div className={`mt-0.5 text-[10px] ${item.storageIncluded ? 'text-teal-700 dark:text-teal-300' : 'text-[var(--muted-foreground)]'}`}>
                        {item.storageIncluded ? `Đầy đủ: CSDL + tệp lưu trữ (${formatSize(item.storageSize)})` : 'Chỉ có phần CSDL / định dạng cũ'}
                      </div>
                    </Td>
                    <Td>
                      <KindBadge item={item} />
                    </Td>
                    <Td className="text-right whitespace-nowrap">{formatSize(item.size)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Xem chi tiết" onClick={() => setDetailName(item.name)}>
                          <FileSearch />
                        </Button>
                        <Button size="sm" variant="ghost" title="Tải về máy" onClick={() => download(item.name)}>
                          <Download />
                        </Button>
                        {canRestore ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={item.legacy}
                            title={item.legacy ? 'Định dạng cũ — không phục hồi được' : 'Phục hồi từ bản này'}
                            onClick={() => {
                              setConfirm('');
                              setRestoreName(item.name);
                            }}
                          >
                            <ArchiveRestore /> Phục hồi
                          </Button>
                        ) : null}
                        {canCreate ? (
                          <Button size="sm" variant="ghost" title="Xoá tệp" onClick={() => setDeleteName(item.name)}>
                            <Trash2 className="text-[var(--danger)]" />
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Chi tiết */}
      <Dialog
        open={!!detailName}
        onClose={() => setDetailName(null)}
        title="Chi tiết bản sao lưu"
        description={detailName ?? undefined}
        footer={
          detailName ? (
            <>
              <Button variant="outline" onClick={() => download(detailName)}>
                <Download /> Tải CSDL
              </Button>
              {detail?.storage.included && detail.storage.fileName ? (
                <>
                  {detail.storage.portable ? (
                    <Button variant="outline" onClick={() => downloadPortableBundle(detailName)}>
                      <Download /> Tải bộ đầy đủ
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => downloadStorage(detailName, detail.storage.fileName!)}>
                    <Download /> Tải tệp lưu trữ
                  </Button>
                </>
              ) : null}
              {canRestore && detail?.restorable ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirm('');
                    setRestoreName(detailName);
                    setDetailName(null);
                  }}
                >
                  <ArchiveRestore /> Phục hồi từ bản này
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        <DetailBody detail={detail} loading={detailLoading} error={detailError as Error | null} />
      </Dialog>

      {/* Phục hồi */}
      <Dialog
        open={!!restoreName}
        onClose={() => (restore.isPending ? undefined : setRestoreName(null))}
        title="Phục hồi dữ liệu"
        description={restoreName ?? undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setRestoreName(null)} disabled={restore.isPending}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              disabled={confirm.trim().toUpperCase() !== CONFIRM_TEXT || !detail?.restorable}
              loading={restore.isPending}
              onClick={() => restoreName && restore.mutate(restoreName)}
            >
              <ArchiveRestore /> Phục hồi
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex gap-2 rounded-lg border border-red-300/70 bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-medium">
                Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu trong bản sao lưu
                {detail ? ` lúc ${formatDateTime(detail.createdAt)}` : ''}.
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                <li>Mọi thay đổi sau thời điểm đó (phiếu, chữ ký, số liệu, tài khoản…) sẽ mất.</li>
                <li>
                  Hệ thống <b>tự tạo một bản sao lưu an toàn</b> của dữ liệu hiện tại trước khi phục hồi, để có thể quay lại
                  nếu cần.
                </li>
                <li>Nếu có lỗi giữa chừng, toàn bộ thao tác được huỷ và dữ liệu hiện tại giữ nguyên.</li>
                <li>
                  Trong lúc phục hồi, hệ thống tạm khoá với mọi người dùng khác (họ thấy thông báo “đang phục hồi” và
                  trang tự tải lại khi xong). Nội dung họ đang nhập dở mà chưa lưu sẽ phải nhập lại.
                </li>
              </ul>
            </div>
          </div>
          <DetailBody detail={detail} loading={detailLoading} error={detailError as Error | null} compact />
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted-foreground)]" htmlFor="restore-confirm">
              Gõ <b className="font-mono text-[var(--foreground)]">{CONFIRM_TEXT}</b> để xác nhận
            </label>
            <Input
              id="restore-confirm"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_TEXT}
              disabled={restore.isPending}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmCleanup}
        title="Dọn theo chính sách lưu trữ"
        message={`Chỉ giữ ${data?.retention?.keepCount ?? 3} bộ backup mới nhất và xoá tệp QLBS ghi dở dang đã quá ${data?.retention?.temporaryRetentionHours ?? 24} giờ. Tệp HSBA, ảnh khuôn mặt, phông, uploads hoàn chỉnh và dữ liệu CSDL không bị xoá.`}
        confirmText="Dọn an toàn"
        loading={cleanup.isPending}
        onConfirm={() => cleanup.mutate()}
        onClose={() => setConfirmCleanup(false)}
      />

      <ConfirmDialog
        open={!!deleteName}
        title="Xoá bản sao lưu"
        message={
          <span>
            Xoá vĩnh viễn tệp <b className="font-mono text-xs break-all">{deleteName}</b>? Thao tác không thể hoàn tác.
          </span>
        }
        confirmText="Xoá"
        loading={remove.isPending}
        onConfirm={() => deleteName && remove.mutate(deleteName)}
        onClose={() => setDeleteName(null)}
      />
    </div>
  );
}

function DetailBody({
  detail,
  loading,
  error,
  compact,
}: {
  detail?: BackupDetail;
  loading: boolean;
  error: Error | null;
  compact?: boolean;
}) {
  if (loading) return <Skeleton className="h-24" />;
  if (error) return <div className="text-sm text-[var(--danger)]">{error.message}</div>;
  if (!detail) return null;
  const rows = Object.entries(detail.counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Thời điểm</div>
          <div className="font-medium">{formatDateTime(detail.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Số bảng</div>
          <div className="font-medium">{formatNumber(detail.tables)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Tổng số dòng</div>
          <div className="font-medium">{formatNumber(detail.totalRows)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Dung lượng</div>
          <div className="font-medium">{formatSize(detail.size)}</div>
        </div>
      </div>
      {detail.storage.included ? (
        <div className="rounded-lg border border-teal-300/70 bg-teal-50 p-2 text-xs text-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
          Bộ đầy đủ: CSDL ({formatSize(detail.databaseSize)}) và tệp lưu trữ ({formatSize(detail.storage.size)}) gồm file HSBA, phông tải lên và ảnh khuôn mặt.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Bản cũ chỉ có phần CSDL. Ảnh khuôn mặt vẫn được phục hồi từ dữ liệu sinh trắc học trong CSDL; tệp đính kèm HSBA/phông không có archive đi kèm.
        </div>
      )}
      {!detail.restorable ? (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {detail.reason ?? 'Bản sao lưu này không phục hồi được'}
        </div>
      ) : null}
      <div className={compact ? 'max-h-40 overflow-y-auto rounded-lg border' : 'rounded-lg border'}>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([table, n]) => (
              <tr key={table} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  {TABLE_LABELS[table] ?? table}
                  {TABLE_LABELS[table] ? (
                    <span className="ml-1 font-mono text-[10px] text-[var(--muted-foreground)]">{table}</span>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
