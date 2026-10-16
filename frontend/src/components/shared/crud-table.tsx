'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { AdvancedFilter } from '@/components/shared/advanced-filter';
import { ColorPicker } from '@/components/shared/color-picker';
import { cn } from '@/lib/utils';
import type { Paginated } from '@/types/api';

export interface CrudOption {
  value: string | number | boolean;
  label: string;
}

export interface CrudField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'switch' | 'date' | 'time' | 'datetime' | 'email' | 'tags' | 'color';
  options?: CrudOption[];
  /** Bảng màu cho kiểu 'color' (chọn bằng ô màu, không cần gõ mã) */
  palette?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Giá trị mặc định khi thêm mới */
  defaultValue?: unknown;
  /** Ẩn ở bảng danh sách */
  hideInTable?: boolean;
  /** Không cho sửa (hiện chỉ khi thêm mới) */
  createOnly?: boolean;
  /** Hiện cho biết trường bắt buộc nhập số */
  span?: 1 | 2;
  transform?: (value: unknown) => unknown;
}

export interface CrudColumn {
  key: string;
  label: string;
  className?: string;
  render?: (row: Record<string, unknown>) => ReactNode;
  /** Cho phép sắp xếp theo cột khi bấm tiêu đề (mặc định: bật; máy chủ tự quyết cột hợp lệ) */
  sortable?: boolean;
}

interface CrudTableProps {
  title: string;
  description?: string;
  endpoint: string;
  fields: CrudField[];
  columns?: CrudColumn[];
  searchPlaceholder?: string;
  /** Tham số cố định gửi kèm mọi truy vấn */
  fixedParams?: Record<string, string | number | boolean | undefined>;
  /** Mã tài nguyên lọc nâng cao (theo /meta/filters) — có thì hiện thanh lọc tự dựng */
  filterResource?: string;
  createLabel?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Tên trường dùng để hiển thị trong hộp thoại xoá */
  labelKey?: string;
  /** Nút thao tác thêm cho mỗi dòng */
  rowActions?: (row: Record<string, unknown>) => ReactNode;
  /** Phiên bản thẻ gọn cho màn hình nhỏ; nếu có, bảng chỉ hiện từ breakpoint sm trở lên. */
  mobileCard?: (row: Record<string, unknown>, actions: ReactNode) => ReactNode;
  onRowClick?: (row: Record<string, unknown>) => void;
  toolbar?: ReactNode;
  /** Dữ liệu trả về đã là danh sách phẳng (không phân trang) */
  pageSize?: number;
  /** Tắt chế độ sắp xếp bằng cách bấm tiêu đề cột (mặc định: bật) */
  sortEnabled?: boolean;
}

/**
 * Bảng CRUD dùng chung cho mọi danh mục quản trị.
 *
 * Nhờ vậy mỗi màn quản trị chỉ cần khai báo trường dữ liệu — không viết lại
 * phần tìm kiếm, phân trang, thêm/sửa/xoá.
 */
export function CrudTable({
  title,
  description,
  endpoint,
  fields,
  columns,
  searchPlaceholder = 'Tìm kiếm…',
  fixedParams,
  filterResource,
  createLabel = 'Thêm mới',
  canCreate = true,
  canEdit = true,
  canDelete = true,
  labelKey = 'name',
  rowActions,
  mobileCard,
  onRowClick,
  toolbar,
  pageSize = 15,
  sortEnabled = true,
}: CrudTableProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  /** Bộ lọc sâu dựng từ /meta/filters (chuỗi field:op:value) */
  const [deepFilters, setDeepFilters] = useState('');
  /** Sắp xếp theo cột — bấm tiêu đề: tăng → giảm → bỏ sắp xếp */
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' } | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    if (search) p.set('q', search);
    for (const [k, v] of Object.entries(fixedParams ?? {})) {
      if (v !== undefined && v !== '') p.set(k, String(v));
    }
    if (deepFilters) p.set('filters', deepFilters);
    if (sort) {
      p.set('sortBy', sort.by);
      p.set('sortDir', sort.dir);
    }
    return p.toString();
  }, [page, pageSize, search, fixedParams, deepFilters, sort]);

  const queryKey = [endpoint, params];
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => apiFetch<Paginated<Record<string, unknown>>>(`${endpoint}?${params}`),
  });

  const tableColumns: CrudColumn[] =
    columns ??
    fields
      .filter((f) => !f.hideInTable)
      .map((f) => ({
        key: f.name,
        label: f.label,
        render: (row) => {
          const value = row[f.name];
          if (typeof value === 'boolean') {
            return <Badge tone={value ? 'success' : 'muted'}>{value ? 'Có' : 'Không'}</Badge>;
          }
          if (f.name === 'active') {
            return <Badge tone={value ? 'success' : 'muted'}>{value ? 'Đang dùng' : 'Ngừng'}</Badge>;
          }
          if (f.type === 'select' && f.options) {
            const found = f.options.find((o) => String(o.value) === String(value));
            if (found) return found.label;
          }
          if (value === null || value === undefined || value === '') return <span className="text-[var(--muted-foreground)]">—</span>;
          return String(value);
        },
      }));

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: [endpoint] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const id = editing?.id;
      return apiFetch(id ? `${endpoint}/${id}` : endpoint, {
        method: id ? 'PUT' : 'POST',
        body: payload,
      });
    },
    onSuccess: async () => {
      toast.success(editing ? 'Đã cập nhật' : 'Đã thêm mới');
      setEditing(null);
      setCreating(false);
      setForm({});
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`${endpoint}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Đã xoá');
      setDeleting(null);
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const openCreate = (): void => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) initial[f.name] = f.defaultValue ?? (f.type === 'switch' ? true : '');
    setForm(initial);
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (row: Record<string, unknown>): void => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) initial[f.name] = row[f.name] ?? (f.type === 'switch' ? false : '');
    setForm(initial);
    setEditing(row);
    setCreating(false);
  };

  const dialogOpen = creating || !!editing;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      if (editing && f.createOnly) continue;
      let value = form[f.name];
      if (f.type === 'number' && value !== '' && value !== undefined && value !== null) value = Number(value);
      if (f.type === 'tags' && typeof value === 'string') {
        value = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (f.transform) value = f.transform(value);
      if (value !== undefined) payload[f.name] = value;
    }
    saveMutation.mutate(payload);
  };

  const rows = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const toggleSort = (key: string): void => {
    setPage(1);
    setSort((cur) => {
      if (!cur || cur.by !== key) return { by: key, dir: 'asc' };
      if (cur.dir === 'asc') return { by: key, dir: 'desc' };
      return null;
    });
  };

  const renderActions = (row: Record<string, unknown>): ReactNode => (
    <>
      {rowActions?.(row)}
      {canEdit ? (
        <Button variant="ghost" size="icon" title="Sửa" aria-label={`Sửa ${String(row[labelKey] ?? '')}`} onClick={() => openEdit(row)}>
          <Pencil />
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          variant="ghost"
          size="icon"
          title="Xoá"
          aria-label={`Xoá ${String(row[labelKey] ?? '')}`}
          className="text-[var(--danger)]"
          onClick={() => setDeleting(row)}
        >
          <Trash2 />
        </Button>
      ) : null}
    </>
  );

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-base font-semibold">{title}</div>
          {description ? <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{description}</div> : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {toolbar}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(keyword.trim());
            }}
            className="relative order-last w-full min-w-0 sm:order-none sm:w-56"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full pl-8 text-sm sm:h-8.5"
            />
          </form>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => refetch()} title="Tải lại" aria-label="Tải lại danh sách">
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
          </Button>
          {canCreate ? (
            <Button size="sm" className="ml-auto shrink-0 sm:ml-0" onClick={openCreate}>
              <Plus /> {createLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {filterResource ? (
        <div className="border-b bg-[var(--muted)]/20 px-4 py-3">
          <AdvancedFilter
            resource={filterResource}
            value={deepFilters}
            onChange={(next) => {
              setDeepFilters(next);
              setPage(1);
            }}
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Chưa có dữ liệu" description="Bấm “Thêm mới” để tạo bản ghi đầu tiên." />
      ) : (
        <>
          {mobileCard ? (
            <div className="divide-y sm:hidden">
              {rows.map((row) => mobileCard(row, renderActions(row)))}
            </div>
          ) : null}
          <TableWrap className={mobileCard ? 'hidden sm:block' : undefined}>
            <thead>
              <tr>
                {tableColumns.map((c) => {
                  const sortable = sortEnabled && c.sortable !== false;
                  const activeSort = sort?.by === c.key ? sort : null;
                  return (
                    <Th
                      key={c.key}
                      className={cn(c.className, sortable && 'cursor-pointer select-none hover:text-[var(--foreground)]')}
                      onClick={sortable ? () => toggleSort(c.key) : undefined}
                      title={sortable ? 'Bấm để sắp xếp (tăng / giảm / bỏ)' : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortable ? (
                          activeSort?.dir === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : activeSort?.dir === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )
                        ) : null}
                      </span>
                    </Th>
                  );
                })}
                {canEdit || canDelete || rowActions ? <Th className="w-px text-right">Thao tác</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={String(row.id)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {tableColumns.map((c) => (
                    <Td key={c.key} className={c.className}>
                      {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                    </Td>
                  ))}
                  {canEdit || canDelete || rowActions ? (
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        {renderActions(row)}
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {data && data.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-[var(--muted-foreground)]">
          <div>
            Tổng <span className="font-semibold text-[var(--foreground)]">{data.total}</span> bản ghi · Trang{' '}
            {data.page}/{Math.max(1, totalPages)}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft /> Trước
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Sửa: ${String(editing[labelKey] ?? '')}` : createLabel}
        description={editing ? 'Cập nhật thông tin rồi bấm Lưu' : 'Điền thông tin để tạo bản ghi mới'}
        footer={
          <>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Huỷ
            </Button>
            <Button type="submit" form="crud-form" loading={saveMutation.isPending}>
              Lưu
            </Button>
          </>
        }
      >
        <form id="crud-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            if (editing && f.createOnly) return null;
            const span = f.span === 2 || f.type === 'textarea' || f.type === 'tags' ? 'sm:col-span-2' : '';
            return (
              <div key={f.name} className={cn('space-y-1.5', span)}>
                <Label htmlFor={`f-${f.name}`}>
                  {f.label}
                  {f.required ? <span className="text-[var(--danger)]"> *</span> : null}
                </Label>
                {f.type === 'textarea' ? (
                  <Textarea
                    id={`f-${f.name}`}
                    value={String(form[f.name] ?? '')}
                    onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={5}
                  />
                ) : f.type === 'switch' ? (
                  <div className="flex items-center gap-2 pt-1.5">
                    <Switch
                      checked={Boolean(form[f.name])}
                      onCheckedChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))}
                    />
                    <span className="text-sm text-[var(--muted-foreground)]">
                      {form[f.name] ? 'Bật' : 'Tắt'}
                    </span>
                  </div>
                ) : f.type === 'select' ? (
                  <Select
                    id={`f-${f.name}`}
                    value={String(form[f.name] ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const opt = f.options?.find((o) => String(o.value) === raw);
                      setForm((s) => ({ ...s, [f.name]: opt ? opt.value : raw }));
                    }}
                  >
                    <option value="">— Chọn —</option>
                    {form[f.name] !== undefined &&
                    form[f.name] !== null &&
                    form[f.name] !== '' &&
                    !f.options?.some((o) => String(o.value) === String(form[f.name])) ? (
                      // Giá trị cũ không còn trong danh sách (vd. chức danh chưa khai báo) — giữ nguyên, không mất dữ liệu
                      <option value={String(form[f.name])}>{String(form[f.name])} (ngoài danh mục)</option>
                    ) : null}
                    {f.options?.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === 'color' ? (
                  <ColorPicker
                    id={`f-${f.name}`}
                    value={String(form[f.name] ?? '')}
                    palette={f.palette ?? []}
                    onChange={(hex) => setForm((s) => ({ ...s, [f.name]: hex }))}
                  />
                ) : f.type === 'tags' ? (
                  <Input
                    id={`f-${f.name}`}
                    value={Array.isArray(form[f.name]) ? (form[f.name] as string[]).join(', ') : String(form[f.name] ?? '')}
                    onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <Input
                    id={`f-${f.name}`}
                    type={
                      f.type === 'number' ? 'number'
                        : f.type === 'date' ? 'date'
                        : f.type === 'time' ? 'time'
                        : f.type === 'datetime' ? 'datetime-local'
                        : f.type === 'password' ? 'password'
                        : 'text'
                    }
                    value={String(form[f.name] ?? '')}
                    onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    required={f.required}
                  />
                )}
                {f.help ? <div className="text-[11px] text-[var(--muted-foreground)]">{f.help}</div> : null}
              </div>
            );
          })}
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title="Xác nhận xoá"
        message={
          <>
            Bạn có chắc muốn xoá <b>{String(deleting?.[labelKey] ?? '')}</b>? Thao tác này có thể ảnh hưởng tới dữ
            liệu liên quan.
          </>
        }
        confirmText="Xoá"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(Number(deleting.id))}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
