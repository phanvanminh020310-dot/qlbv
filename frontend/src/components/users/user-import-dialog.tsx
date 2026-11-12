'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileUp, Info, RotateCcw, Upload, XCircle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';

type Action = 'create' | 'update' | 'skip' | 'error';
interface PreviewRow {
  line: number;
  manv: string;
  username: string;
  usernameGenerated: boolean;
  fullName: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  roles: string[];
  action: Action;
  messages: { level: 'error' | 'warning' | 'info'; text: string }[];
}
interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  warningCount: number;
  newTitles: string[];
  titlesAdded: string[];
  defaultPassword: string | null;
  rows: PreviewRow[];
  file?: {
    name: string;
    format: string;
    encoding?: string;
    delimiter?: string;
    sheet?: string;
    ignoredColumns: string[];
    columns: { header: string; field: string | null }[];
  };
}

const ACTION_BADGE: Record<Action, { label: string; tone: 'success' | 'info' | 'muted' | 'danger' }> = {
  create: { label: 'Thêm mới', tone: 'success' },
  update: { label: 'Cập nhật', tone: 'info' },
  skip: { label: 'Bỏ qua', tone: 'muted' },
  error: { label: 'Lỗi', tone: 'danger' },
};

const FIELD_LABEL: Record<string, string> = {
  username: 'Tên đăng nhập',
  fullName: 'Họ tên',
  title: 'Chức danh',
  department: 'Khoa',
  email: 'Thư điện tử',
  phone: 'Điện thoại',
  note: 'Ghi chú',
  roles: 'Vai trò',
  password: 'Mật khẩu',
  employeeCode: 'Mã nhân viên',
};

type Filter = 'all' | 'problem' | Action;

/**
 * Nhập danh sách nhân viên từ Excel (.xlsx) / CSV / TXT theo 2 bước:
 * chạy thử để xem trước từng dòng → xác nhận nhập (ghi trong 1 giao dịch).
 */
export function UserImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [addTitles, setAddTitles] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const run = useMutation({
    mutationFn: (args: { file: File; dryRun: boolean }) => {
      const q = new URLSearchParams({
        name: args.file.name,
        dryRun: String(args.dryRun),
        overwrite: String(overwrite),
        addTitles: String(addTitles),
      });
      return apiFetch<ImportResult>(`/users/import/file?${q}`, { method: 'POST', body: args.file });
    },
    onSuccess: async (res) => {
      if (res.dryRun) {
        setPreview(res);
        setFilter(res.errorCount || res.warningCount ? 'problem' : 'all');
        return;
      }
      setDone(res);
      setPreview(res);
      setFilter('all');
      toast.success(`Đã nhập: ${res.created} thêm mới, ${res.updated} cập nhật`);
      await queryClient.invalidateQueries({ queryKey: ['/users'] });
      await queryClient.invalidateQueries({ queryKey: ['job-titles-options'] });
    },
    onError: (err) => toast.error((err as Error).message, { duration: 10000 }),
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDone(null);
    setFilter('all');
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const choose = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setDone(null);
    run.mutate({ file: f, dryRun: true });
  };

  // Đổi tuỳ chọn → chạy thử lại để bảng xem trước khớp với lúc nhập thật
  const changeOption = (setter: (v: boolean) => void, v: boolean) => {
    setter(v);
    if (file && !done) {
      setTimeout(() => run.mutate({ file, dryRun: true }), 0);
    }
  };

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    if (filter === 'all') return all;
    if (filter === 'problem') return all.filter((r) => r.action === 'error' || r.messages.some((m) => m.level === 'warning'));
    return all.filter((r) => r.action === filter);
  }, [preview, filter]);

  const writable = preview ? preview.created + preview.updated : 0;

  const template = async () => {
    try {
      await downloadFile('/users/import/template', 'mau-nhap-nhan-vien.xlsx');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="full"
      title="Nhập danh sách nhân viên"
      description="Từ tệp Excel (.xlsx), CSV hoặc TXT. Chỉ bắt buộc cột Họ và tên — thư điện tử, điện thoại, ghi chú… có thể để trống."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {done ? 'Đóng' : 'Huỷ'}
          </Button>
          {preview && !done ? (
            <Button
              onClick={() => file && run.mutate({ file, dryRun: false })}
              loading={run.isPending && !!preview}
              disabled={!writable}
              title={writable ? undefined : 'Không có dòng nào để nhập'}
            >
              <Upload /> Nhập {writable} nhân viên
            </Button>
          ) : null}
          {done ? (
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Nhập tệp khác
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".xlsx,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <Button onClick={() => input.current?.click()} loading={run.isPending && !preview} disabled={!!done}>
            <FileUp /> {file ? 'Chọn tệp khác' : 'Chọn tệp…'}
          </Button>
          <Button variant="outline" onClick={template}>
            <Download /> Tải tệp mẫu
          </Button>
          {file ? (
            <span className="truncate text-sm text-[var(--muted-foreground)]">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={overwrite} onCheckedChange={(v) => changeOption(setOverwrite, v)} />
            <span>
              <span className="font-medium">Ghi đè tài khoản đã có</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                Cập nhật họ tên, chức danh, khoa… theo tệp. Ô trống không xoá dữ liệu cũ, mật khẩu không đổi.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={addTitles} onCheckedChange={(v) => changeOption(setAddTitles, v)} />
            <span>
              <span className="font-medium">Tự thêm chức danh mới vào danh mục</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                Chức danh trong tệp chưa có ở Danh mục → Chức danh sẽ được thêm.
              </span>
            </span>
          </label>
        </div>

        {!preview && !run.isPending ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-[var(--muted-foreground)]">
            <div
              className="flex cursor-pointer flex-col items-center gap-2 text-center"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files?.[0]);
              }}
            >
              <FileUp className="size-8" />
              <div className="font-medium text-[var(--foreground)]">Kéo thả tệp vào đây hoặc bấm để chọn</div>
              <div>
                Các cột nhận diện được (không phân biệt dấu, hoa thường, thứ tự): <b>Họ và tên</b>, Tên đăng nhập, Chức
                danh, Mã khoa (hoặc tên khoa), Thư điện tử, Điện thoại, Vai trò, Ghi chú, Mật khẩu, MANV.
              </div>
              <div>MANV để trống sẽ lấy 4 ký tự đầu tên đăng nhập; tên đăng nhập bỏ trống sẽ tự tạo từ họ tên: “Nguyễn Văn An” → annv.</div>
            </div>
          </div>
        ) : null}

        {preview ? (
          <>
            {done ? (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                <div>
                  <div className="font-medium">
                    Đã nhập xong: {done.created} thêm mới, {done.updated} cập nhật, {done.skipped} bỏ qua, {done.errorCount}{' '}
                    lỗi.
                  </div>
                  {done.defaultPassword && done.created ? (
                    <div>
                      Tài khoản mới dùng mật khẩu <b>{done.defaultPassword}</b> và phải đổi mật khẩu khi đăng nhập lần đầu.
                    </div>
                  ) : null}
                  {done.titlesAdded.length ? <div>Đã thêm chức danh: {done.titlesAdded.join(', ')}</div> : null}
                  <div className="text-xs text-[var(--muted-foreground)]">Vai trò có thể gán thêm ở từng người dùng.</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border p-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
                <div className="space-y-0.5">
                  <div>
                    <b>Xem trước — chưa ghi gì vào hệ thống.</b> Kiểm tra bảng bên dưới rồi bấm “Nhập {writable} nhân viên”.
                  </div>
                  {preview.file ? (
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {preview.file.format.toUpperCase()}
                      {preview.file.sheet ? ` · trang “${preview.file.sheet}”` : ''}
                      {preview.file.encoding ? ` · bảng mã ${preview.file.encoding}` : ''}
                      {preview.file.delimiter ? ` · phân cách “${preview.file.delimiter}”` : ''} · cột nhận diện:{' '}
                      {preview.file.columns
                        .filter((c) => c.field)
                        .map((c) => `${c.header} → ${FIELD_LABEL[c.field!] ?? c.field}`)
                        .join(', ')}
                      {preview.file.ignoredColumns.length ? ` · bỏ qua cột: ${preview.file.ignoredColumns.join(', ')}` : ''}
                    </div>
                  ) : null}
                  {preview.newTitles.length ? (
                    <div className="text-xs">
                      Chức danh chưa có trong danh mục: {preview.newTitles.join(', ')}
                      {addTitles ? ' — sẽ được thêm.' : ' — vẫn lưu cho nhân viên nhưng không thêm vào danh mục.'}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', `Tất cả (${preview.total})`],
                  ['problem', `Cần xem (${preview.rows.filter((r) => r.action === 'error' || r.messages.some((m) => m.level === 'warning')).length})`],
                  ['create', `Thêm mới (${preview.created})`],
                  ['update', `Cập nhật (${preview.updated})`],
                  ['skip', `Bỏ qua (${preview.skipped})`],
                  ['error', `Lỗi (${preview.errorCount})`],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    filter === key ? 'border-[var(--primary)] bg-[var(--accent)] font-semibold' : 'hover:bg-[var(--muted)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <TableWrap className="max-h-[50vh] overflow-auto">
                <thead className="sticky top-0 z-10 bg-[var(--card)]">
                  <tr>
                    <Th>Dòng</Th>
                    <Th>Kết quả</Th>
                    <Th>MANV</Th>
                    <Th>Tên đăng nhập</Th>
                    <Th>Họ tên</Th>
                    <Th>Chức danh</Th>
                    <Th>Khoa</Th>
                    <Th>Thư điện tử</Th>
                    <Th>Điện thoại</Th>
                    <Th>Ghi chú kiểm tra</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const badge = ACTION_BADGE[r.action];
                    return (
                      <Tr key={r.line}>
                        <Td className="text-[var(--muted-foreground)]">{r.line}</Td>
                        <Td>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </Td>
                        <Td className="font-mono text-xs">{r.manv || '—'}</Td>
                        <Td className="font-mono text-xs">
                          {r.username || '—'}
                          {r.usernameGenerated ? <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">(tự tạo)</span> : null}
                        </Td>
                        <Td>{r.fullName || <span className="text-[var(--danger)]">(trống)</span>}</Td>
                        <Td>{r.title || '—'}</Td>
                        <Td>{r.department || '—'}</Td>
                        <Td>{r.email || '—'}</Td>
                        <Td>{r.phone || '—'}</Td>
                        <Td className="min-w-64">
                          <div className="space-y-0.5">
                            {r.messages.map((m, i) => (
                              <div
                                key={i}
                                className={cn(
                                  'flex items-start gap-1 text-xs',
                                  m.level === 'error' && 'text-[var(--danger)]',
                                  m.level === 'warning' && 'text-[var(--warning)]',
                                  m.level === 'info' && 'text-[var(--muted-foreground)]',
                                )}
                              >
                                {m.level === 'error' ? (
                                  <XCircle className="mt-0.5 size-3 shrink-0" />
                                ) : m.level === 'warning' ? (
                                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                ) : (
                                  <Info className="mt-0.5 size-3 shrink-0" />
                                )}
                                <span>{m.text}</span>
                              </div>
                            ))}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                  {!rows.length ? (
                    <Tr>
                      <Td colSpan={10} className="py-6 text-center text-[var(--muted-foreground)]">
                        Không có dòng nào
                      </Td>
                    </Tr>
                  ) : null}
                </tbody>
            </TableWrap>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
