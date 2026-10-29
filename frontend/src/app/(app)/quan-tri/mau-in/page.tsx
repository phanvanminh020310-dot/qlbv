'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, History, Plus, Printer, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { PrintDesigner } from '@/components/printing/print-designer';
import { emptyDocument, type PrintDocument } from '@/components/printing/print-types';
import { AdvancedFilter } from '@/components/shared/advanced-filter';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import type { Paginated } from '@/types/api';

interface PrintTemplateRow {
  id: number;
  code: string;
  name: string;
  description: string;
  module: string;
  docType: string;
  paperSize: string;
  orientation: string;
  version: number;
  active: boolean;
  departmentId: number | null;
  departmentName?: string | null;
  updatedAt: string;
  updatedByName?: string | null;
}

interface PrintTemplateDetail extends PrintTemplateRow {
  document: PrintDocument;
  pageMargins?: Record<string, number>;
}

const MODULES = ['HSBA', 'REPORT', 'ASSET', 'UTILITY', 'GENERIC'];
const DOC_TYPES = ['PHIEU_SUA_HSBA', 'BAO_CAO_KHOA', 'BAO_CAO_TONG_HOP', 'TEM_TAI_SAN', 'GENERIC'];

interface TemplateForm {
  code: string;
  name: string;
  description: string;
  module: string;
  docType: string;
  departmentId: number | null;
}

const EMPTY_FORM: TemplateForm = {
  code: '',
  name: '',
  description: '',
  module: 'HSBA',
  docType: 'PHIEU_SUA_HSBA',
  departmentId: null,
};

export default function PrintTemplatesPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [document, setDocument] = useState<PrintDocument>(emptyDocument());
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [savedForm, setSavedForm] = useState<TemplateForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<PrintTemplateRow | null>(null);
  const [duplicating, setDuplicating] = useState<PrintTemplateRow | null>(null);
  const [newCode, setNewCode] = useState('');
  const [versionsOf, setVersionsOf] = useState<PrintTemplateRow | null>(null);
  /** Bộ lọc nâng cao dựng từ /meta/filters/print-templates */
  const [deepFilters, setDeepFilters] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['print-templates', deepFilters],
    queryFn: () =>
      apiFetch<Paginated<PrintTemplateRow>>(
        `/print/templates?pageSize=100${deepFilters ? `&filters=${encodeURIComponent(deepFilters)}` : ''}`,
      ),
  });

  const versions = useQuery({
    queryKey: ['print-template-versions', versionsOf?.id],
    enabled: !!versionsOf,
    queryFn: () =>
      apiFetch<
        { id: number; version: number; note: string; createdByName?: string; createdAt: string }[]
      >(`/print/templates/${versionsOf?.id}/versions`),
  });

  const departments = useQuery({
    queryKey: ['departments-options'],
    queryFn: () => apiFetch<{ id: number; name: string }[]>('/departments/options'),
  });

  const openNew = (): void => {
    setForm(EMPTY_FORM);
    setSavedForm(EMPTY_FORM);
    setDocument(emptyDocument());
    setInfoOpen(true);
    setEditing('new');
  };

  const openEdit = async (row: PrintTemplateRow): Promise<void> => {
    setEditing(row.id);
    setLoadingDetail(true);
    setInfoOpen(false);
    const f: TemplateForm = {
      code: row.code,
      name: row.name,
      description: row.description ?? '',
      module: row.module,
      docType: row.docType,
      departmentId: row.departmentId,
    };
    setForm(f);
    setSavedForm(f);
    try {
      const detail = await apiFetch<PrintTemplateDetail>(`/print/templates/${row.id}`);
      setDocument(detail.document ?? emptyDocument());
    } catch (err) {
      toast.error(`Không tải được thiết kế: ${(err as Error).message}`);
      setDocument(emptyDocument());
    } finally {
      setLoadingDetail(false);
    }
  };

  const save = useMutation({
    mutationFn: async (nextDocument: PrintDocument) => {
      if (!form.code.trim() || !form.name.trim()) {
        setInfoOpen(true);
        throw new Error('Cần nhập mã và tên mẫu in (bấm “Thông tin mẫu”)');
      }
      const payload = {
        ...form,
        paperSize: nextDocument.paperSize,
        orientation: nextDocument.orientation,
        document: nextDocument,
      };
      if (typeof editing === 'number') {
        return apiFetch<PrintTemplateRow>(`/print/templates/${editing}`, { method: 'PUT', body: payload });
      }
      return apiFetch<PrintTemplateRow>('/print/templates', { method: 'POST', body: payload });
    },
    onSuccess: async (row) => {
      toast.success('Đã lưu mẫu in');
      // Giữ trình thiết kế mở để tiếp tục chỉnh; mẫu mới chuyển sang chế độ sửa
      if (row && typeof row.id === 'number') setEditing(row.id);
      setSavedForm(form);
      await queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const publish = useMutation({
    mutationFn: (payload: { id: number; active: boolean }) =>
      apiFetch(`/print/templates/${payload.id}/publish`, { method: 'PATCH', body: { active: payload.active } }),
    onSuccess: async () => {
      toast.success('Đã cập nhật trạng thái ban hành');
      await queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/print/templates/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Đã xoá mẫu in');
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const duplicate = useMutation({
    mutationFn: (payload: { id: number; code: string }) =>
      apiFetch(`/print/templates/${payload.id}/duplicate`, { method: 'POST', body: { code: payload.code } }),
    onSuccess: async () => {
      toast.success('Đã sao chép mẫu in');
      setDuplicating(null);
      setNewCode('');
      await queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const restore = useMutation({
    mutationFn: (payload: { id: number; version: number }) =>
      apiFetch(`/print/templates/${payload.id}/restore/${payload.version}`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Đã khôi phục phiên bản thiết kế');
      setVersionsOf(null);
      await queryClient.invalidateQueries({ queryKey: ['print-templates'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  /* ------------------------------------------------------------- Trình thiết kế */

  if (editing !== null) {
    const infoPanel = (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="t-code">Mã mẫu *</Label>
          <Input
            id="t-code"
            value={form.code}
            disabled={editing !== 'new'}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="PHIEU_SUA_HSBA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-name">Tên mẫu *</Label>
          <Input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-module">Phân hệ</Label>
          <Select id="t-module" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-doc">Loại chứng từ</Label>
          <Select id="t-doc" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-dept">Áp dụng cho khoa</Label>
          <Select
            id="t-dept"
            value={form.departmentId ?? ''}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— Toàn viện —</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-desc">Mô tả</Label>
          <Input id="t-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
    );

    if (loadingDetail) {
      return (
        <div className="app-viewport-fixed fixed inset-x-0 top-0 z-[45] flex items-center justify-center overflow-hidden bg-[var(--background)]">
          <div className="w-full max-w-3xl space-y-3 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-[60vh]" />
          </div>
        </div>
      );
    }

    return (
      <PrintDesigner
        document={document}
        title={editing === 'new' ? 'Mẫu in mới' : form.name || form.code}
        subtitle={`${form.code || 'Chưa có mã'} · ${form.module} · ${form.docType}`}
        saving={save.isPending}
        readOnly={!can(editing === 'new' ? 'print.template.create' : 'print.template.update')}
        onSave={(next) => save.mutateAsync(next)}
        extraDirty={JSON.stringify(form) !== JSON.stringify(savedForm)}
        infoPanel={infoPanel}
        infoOpen={infoOpen}
        setInfoOpen={setInfoOpen}
        canManageFonts={can('print.template.update') || can('print.template.create')}
        onClose={() => {
          setEditing(null);
          setInfoOpen(false);
        }}
      />
    );
  }

  /* ------------------------------------------------------------------ Danh sách */

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mẫu in & thiết kế bản in"
        description="Khung định dạng bản in chuyên nghiệp: khổ giấy, lề, font, khung viền, bảng động, chữ ký, mã QR — tất cả cấu hình được"
        actions={
          can('print.template.create') ? (
            <Button onClick={openNew}>
              <Plus /> Thêm mẫu in
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="border-b px-4 py-2.5">
          <AdvancedFilter
            resource="print-templates"
            value={deepFilters}
            onChange={setDeepFilters}
          />
        </div>
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-64" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Chưa có mẫu in nào"
            description="Tạo mẫu in đầu tiên rồi thiết kế trực quan bằng thanh công cụ kéo thả."
            action={
              can('print.template.create') ? (
                <Button onClick={openNew}>
                  <Plus /> Thêm mẫu in
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Mẫu in</Th>
                <Th>Loại chứng từ</Th>
                <Th>Khổ giấy</Th>
                <Th>Phiên bản</Th>
                <Th>Cập nhật</Th>
                <Th>Trạng thái</Th>
                <Th className="text-right">Thao tác</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Printer className="size-4 text-[var(--muted-foreground)]" />
                      <div>
                        <div className="font-medium">{row.name}</div>
                        <div className="font-mono text-[10px] text-[var(--muted-foreground)]">{row.code}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone="info">{row.module}</Badge>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">{row.docType}</div>
                  </Td>
                  <Td className="text-xs">
                    {row.paperSize} · {row.orientation === 'landscape' ? 'ngang' : 'dọc'}
                  </Td>
                  <Td className="text-xs tabular-nums">v{row.version}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    <div>{formatDateTime(row.updatedAt)}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]">{row.updatedByName ?? ''}</div>
                  </Td>
                  <Td>{row.active ? <Badge tone="success">Đang ban hành</Badge> : <Badge tone="muted">Ngừng dùng</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {can('print.template.update') ? (
                        <Button variant="outline" size="sm" onClick={() => void openEdit(row)}>
                          Thiết kế
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" title="Lịch sử phiên bản" onClick={() => setVersionsOf(row)}>
                        <History />
                      </Button>
                      {can('print.template.create') ? (
                        <Button variant="ghost" size="icon" title="Sao chép" onClick={() => setDuplicating(row)}>
                          <Copy />
                        </Button>
                      ) : null}
                      {can('print.template.publish') ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={row.active ? 'Ngừng sử dụng' : 'Ban hành'}
                          onClick={() => publish.mutate({ id: row.id, active: !row.active })}
                        >
                          <Upload />
                        </Button>
                      ) : null}
                      {can('print.template.delete') ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-[var(--danger)]"
                          title="Xoá"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Lịch sử phiên bản */}
      <Dialog
        open={!!versionsOf}
        onClose={() => setVersionsOf(null)}
        size="lg"
        title={`Phiên bản thiết kế: ${versionsOf?.name ?? ''}`}
        description="Khôi phục về bản cũ sẽ tạo phiên bản mới — không mất dữ liệu"
      >
        {versions.isLoading ? (
          <Skeleton className="h-40" />
        ) : (versions.data ?? []).length === 0 ? (
          <EmptyState title="Chưa có phiên bản nào" />
        ) : (
          <ul className="divide-y">
            {(versions.data ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-sm font-medium">Phiên bản {v.version}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    {v.note || '—'} · {v.createdByName ?? ''} · {formatDateTime(v.createdAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={restore.isPending}
                  onClick={() => versionsOf && restore.mutate({ id: versionsOf.id, version: v.version })}
                >
                  Khôi phục
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      {/* Sao chép */}
      <Dialog
        open={!!duplicating}
        onClose={() => setDuplicating(null)}
        title="Sao chép mẫu in"
        description="Thiết kế được sao chép nguyên trạng, có thể dùng mã khác và gán cho khoa khác"
        footer={
          <>
            <Button variant="outline" onClick={() => setDuplicating(null)}>
              Huỷ
            </Button>
            <Button
              loading={duplicate.isPending}
              disabled={!newCode.trim()}
              onClick={() => duplicating && duplicate.mutate({ id: duplicating.id, code: newCode.trim().toUpperCase() })}
            >
              Sao chép
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="dup-code">Mã mẫu mới *</Label>
          <Input
            id="dup-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder={`${duplicating?.code ?? ''}_COPY`}
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title="Xoá mẫu in"
        message={
          <>
            Xoá <b>{deleting?.name}</b>? Nếu mẫu đang được dùng, hệ thống sẽ chuyển sang trạng thái ngừng
            dùng thay vì xoá dữ liệu.
          </>
        }
        confirmText="Xoá"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
