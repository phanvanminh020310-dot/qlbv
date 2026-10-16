'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Camera,
  Crown,
  Eye,
  FileUp,
  KeyRound,
  Lock,
  LockOpen,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CrudTable, type CrudField } from '@/components/shared/crud-table';
import { PageHeader } from '@/components/shared/page-header';
import { UserImportDialog } from '@/components/users/user-import-dialog';
import { BiometricEnrollDialog } from '@/components/users/biometric-enroll-dialog';
import { Badge, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/**
 * Chuẩn hoá danh sách vai trò của một người dùng.
 * API `/users` trả mảng `{ name, code, color }`; vẫn nhận dạng chuỗi cũ `tên|mã|màu;;…`.
 */
function parseUserRoles(value: unknown): { name: string; code: string; color?: string }[] {
  if (Array.isArray(value)) {
    return value
      .map((r) => (typeof r === 'string' ? { name: r, code: r } : { name: String(r?.name ?? r?.code ?? ''), code: String(r?.code ?? ''), color: r?.color ? String(r.color) : undefined }))
      .filter((r) => r.code);
  }
  if (typeof value === 'string' && value) {
    return value
      .split(';;')
      .map((part) => {
        const [name = '', code = '', color = ''] = part.split('|');
        return { name: name || code, code, color: color || undefined };
      })
      .filter((r) => r.code);
  }
  return [];
}

interface RoleOption {
  id: number;
  code: string;
  name: string;
  color: string;
  dataScope: 'OWN' | 'DEPT' | 'ALL';
  description?: string;
  active: boolean;
}

interface DeptOption {
  id: number;
  code: string;
  name: string;
  level: number;
}

interface EffectivePermissions {
  user: { id: number; username: string; fullName: string };
  isSuperAdmin: boolean;
  roles: { code: string; name: string; color?: string; dataScope: string }[];
  dataScope: string;
  departmentIds: number[];
  permissions: { code: string; name: string; module: string; fromRoles?: string[] }[];
  permissionCount: number;
}

const SCOPE_LABEL: Record<string, string> = {
  ALL: 'Toàn viện',
  DEPT: 'Theo khoa',
  OWN: 'Cá nhân',
};

const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Tổng quan',
  department: 'Khoa — phòng ban',
  'hsba.request': 'HSBA — đề xuất sửa',
  'hsba.workflow': 'HSBA — luồng ký duyệt',
  'report.view': 'Báo cáo — xem',
  'report.entry': 'Báo cáo — nhập liệu',
  'report.snapshot': 'Báo cáo — chốt kỳ',
  'report.summary': 'Báo cáo — tổng hợp',
  'report.template': 'Báo cáo — mẫu biểu',
  'report.export': 'Báo cáo — xuất dữ liệu',
  asset: 'Tài sản',
  'asset.catalog': 'Tài sản — danh mục',
  'asset.transaction': 'Tài sản — phiếu biến động',
  'asset.depreciation': 'Tài sản — hao mòn / khấu hao',
  'asset.inventory': 'Tài sản — kiểm kê',
  'asset.report': 'Tài sản — báo cáo',
  'asset.label': 'Tài sản — in tem nhãn',
  'print.template': 'In ấn — mẫu in',
  'print.render': 'In ấn — in/sử dụng mẫu',
  'studio.report': 'Studio — báo cáo động',
  'studio.dashboard': 'Studio — dashboard động',
  user: 'Người dùng',
  role: 'Vai trò & phân quyền',
  'audit.log': 'Nhật ký hệ thống',
  setting: 'Cấu hình hệ thống',
  backup: 'Sao lưu — phục hồi',
  job: 'Tác vụ định kỳ',
  utility: 'Tiện ích',
  file: 'Tệp đính kèm',
  data: 'Dữ liệu — nhập/xuất',
};

function RoleDot({ color }: { color?: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full align-middle"
      style={{ background: color || '#94A3B8' }}
    />
  );
}

function userInitials(fullName: unknown): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ND';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts.at(-2)?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

function UserStatus({ row }: { row: Record<string, unknown> }) {
  const locked = row.lockedUntil && new Date(String(row.lockedUntil)) > new Date();
  if (locked) return <Badge tone="danger">Tạm khoá</Badge>;
  return row.active ? <Badge tone="success">Đang làm việc</Badge> : <Badge tone="muted">Đã nghỉ</Badge>;
}

function isDoctorTitle(title: unknown): boolean {
  const normalized = String(title ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === 'bac si' || normalized === 'bac sy';
}

/** Quản trị người dùng: CRUD, gán vai trò, phạm vi khoa, khoá/mở khoá, đặt lại mật khẩu, xem quyền hiệu lực. */
export default function UsersPage() {
  const can = useAuth((s) => s.can);
  const me = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const [roleTarget, setRoleTarget] = useState<Record<string, unknown> | null>(null);
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [scopeTarget, setScopeTarget] = useState<Record<string, unknown> | null>(null);
  const [scopeDeptIds, setScopeDeptIds] = useState<number[]>([]);
  const [permsTarget, setPermsTarget] = useState<Record<string, unknown> | null>(null);
  const [permKeyword, setPermKeyword] = useState('');
  const [resetTarget, setResetTarget] = useState<Record<string, unknown> | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<Record<string, unknown> | null>(null);
  const [biometricTarget, setBiometricTarget] = useState<Record<string, unknown> | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ['roles-all'],
    queryFn: () => apiFetch<RoleOption[]>('/roles/all'),
  });

  const { data: departments } = useQuery({
    queryKey: ['departments-options'],
    queryFn: () => apiFetch<DeptOption[]>('/departments/options'),
  });

  const effective = useQuery({
    queryKey: ['user-effective-perms', permsTarget?.id],
    enabled: !!permsTarget,
    queryFn: () => apiFetch<EffectivePermissions>(`/users/${permsTarget?.id}/effective-permissions`),
  });

  const userDetail = useQuery({
    queryKey: ['user-detail-scopes', scopeTarget?.id],
    enabled: !!scopeTarget,
    queryFn: () =>
      apiFetch<{ departmentScopes: { id: number; code: string; name: string }[] }>(`/users/${scopeTarget?.id}`),
  });

  useEffect(() => {
    if (userDetail.data && scopeTarget) {
      setScopeDeptIds((userDetail.data.departmentScopes ?? []).map((d) => d.id));
    }
  }, [userDetail.data, scopeTarget]);

  const { data: jobTitles } = useQuery({
    queryKey: ['job-titles-options'],
    queryFn: () => apiFetch<{ id: number; code: string; name: string }[]>('/job-titles/options'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const fields: CrudField[] = [
    { name: 'username', label: 'Tên đăng nhập', required: true, createOnly: true, placeholder: 'bs.nguyenvana' },
    { name: 'fullName', label: 'Họ và tên', required: true, placeholder: 'Nguyễn Văn A' },
    {
      name: 'title',
      label: 'Chức danh',
      type: 'select',
      options: (jobTitles ?? []).map((t) => ({ value: t.name, label: t.name })),
      help: 'Không bắt buộc · chọn Bác sĩ sẽ tự thêm vai trò Nhân viên trực khám',
    },
    { name: 'departmentId', label: 'Khoa công tác', type: 'select', options: (departments ?? []).map((d) => ({ value: d.id, label: `${'— '.repeat(Math.max(0, d.level - 1))}${d.name}` })) },
    { name: 'email', label: 'Thư điện tử', type: 'email', placeholder: 'Không bắt buộc' },
    { name: 'phone', label: 'Điện thoại', placeholder: 'Không bắt buộc' },
    { name: 'password', label: 'Mật khẩu ban đầu', type: 'password', createOnly: true, hideInTable: true, help: 'Bỏ trống để dùng mật khẩu mặc định "1"' },
    { name: 'mustChangePassword', label: 'Buộc đổi mật khẩu lần đầu', type: 'switch', defaultValue: true, hideInTable: true },
    { name: 'active', label: 'Đang làm việc', type: 'switch', defaultValue: true },
    { name: 'note', label: 'Ghi chú', type: 'textarea', hideInTable: true, placeholder: 'Không bắt buộc' },
  ];

  const setRoles = useMutation({
    mutationFn: (payload: { id: number; roleCodes: string[] }) =>
      apiFetch(`/users/${payload.id}/roles`, { method: 'PUT', body: { roleCodes: payload.roleCodes, replace: true } }),
    onSuccess: async () => {
      toast.success('Đã cập nhật vai trò');
      setRoleTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['/users'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const setScopes = useMutation({
    mutationFn: (payload: { id: number; departmentIds: number[] }) =>
      apiFetch(`/users/${payload.id}/department-scopes`, { method: 'PUT', body: { departmentIds: payload.departmentIds } }),
    onSuccess: async () => {
      toast.success('Đã cập nhật phạm vi khoa');
      setScopeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['/users'] });
      await queryClient.invalidateQueries({ queryKey: ['user-effective-perms'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const resetPassword = useMutation({
    mutationFn: (id: number) => apiFetch<{ temporaryPassword?: string }>(`/users/${id}/reset-password`, { method: 'POST', body: {} }),
    onSuccess: async (res) => {
      setResetTarget(null);
      if (res.temporaryPassword) setTempPassword(res.temporaryPassword);
      else toast.success('Đã đặt lại mật khẩu');
      await queryClient.invalidateQueries({ queryKey: ['/users'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const unlock = useMutation({
    mutationFn: (id: number) => apiFetch(`/users/${id}/unlock`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Đã mở khoá tài khoản');
      setUnlockTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['/users'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  /** Những vai trò cấp cao đang được chọn — hiển thị cảnh báo trong dialog gán vai trò. */
  const highPrivilegePicked = useMemo(
    () => roleCodes.filter((c) => c === SUPER_ADMIN_ROLE || c === 'ADMIN' || c === 'LANH_DAO'),
    [roleCodes],
  );

  /** Nhóm quyền hiệu lực theo module để hiển thị */
  const permsByModule = useMemo(() => {
    const map = new Map<string, EffectivePermissions['permissions']>();
    const kw = permKeyword.trim().toLowerCase();
    for (const p of effective.data?.permissions ?? []) {
      if (kw && !`${p.name} ${p.code}`.toLowerCase().includes(kw)) continue;
      const list = map.get(p.module) ?? [];
      list.push(p);
      map.set(p.module, list);
    }
    return [...map.entries()].sort((a, b) => (MODULE_LABEL[a[0]] ?? a[0]).localeCompare(MODULE_LABEL[b[0]] ?? b[0]));
  }, [effective.data, permKeyword]);

  const scopeDeptNames = useMemo(() => {
    const dict = new Map((departments ?? []).map((d) => [d.id, d.name]));
    return (effective.data?.departmentIds ?? []).map((id) => dict.get(id) ?? `#${id}`);
  }, [departments, effective.data]);

  return (
    <>
      <PageHeader
        title="Người dùng & phân quyền"
        description="Quản lý tài khoản nhân sự, vai trò và phạm vi dữ liệu được phép truy cập"
      />

      <CrudTable
        title="Danh sách nhân sự"
        description="Tra cứu nhanh, quản lý vai trò và bảo mật tài khoản trong một nơi."
        endpoint="/users"
        filterResource="users"
        fields={fields}
        createLabel="Thêm người dùng"
        searchPlaceholder="Tìm theo tên, tài khoản, chức danh…"
        canCreate={can('user.create')}
        canEdit={can('user.update')}
        canDelete={can('user.delete')}
        labelKey="fullName"
        pageSize={20}
        toolbar={
          <>
            {can('user.import') ? (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp /> Nhập từ Excel/CSV
              </Button>
            ) : null}
            <Badge tone="info">
              <UserPlus className="mr-1 size-3" /> {roles?.length ?? 0} vai trò sẵn có
            </Badge>
          </>
        }
        mobileCard={(row, actions) => {
          const roleList = parseUserRoles(row.roles);
          return (
            <article key={String(row.id)} className="space-y-3 px-4 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-sm font-bold text-white shadow-sm">
                  {userInitials(row.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{String(row.fullName ?? '—')}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted-foreground)]">@{String(row.username ?? '—')}</div>
                    </div>
                    <UserStatus row={row} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-[var(--muted)]/45 px-3 py-2.5 text-xs">
                <div className="min-w-0"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Chức danh</div><div className="mt-0.5 truncate font-medium">{String(row.title || '—')}</div></div>
                <div className="min-w-0"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Khoa</div><div className="mt-0.5 truncate font-medium">{String(row.departmentName || '—')}</div></div>
                <div className="col-span-2 min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Vai trò</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {roleList.length ? roleList.map(({ name, code, color }) => <Badge key={code} tone="muted"><span className="inline-flex items-center gap-1"><RoleDot color={color} />{name}</span></Badge>) : <span className="text-[var(--muted-foreground)]">Chưa gán</span>}
                  </div>
                </div>
                <div className="col-span-2 min-w-0"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Đăng nhập gần nhất</div><div className="mt-0.5 truncate font-medium">{row.lastLoginAt ? formatDateTime(String(row.lastLoginAt)) : 'Chưa đăng nhập'}</div></div>
              </div>

              <div className="border-t pt-2.5">
                <span className="text-[11px] font-medium text-[var(--muted-foreground)]">Thao tác</span>
                <div className="mt-1.5 grid grid-cols-4 gap-1" onClick={(event) => event.stopPropagation()}>{actions}</div>
              </div>
            </article>
          );
        }}
        columns={[
          { key: 'username', label: 'Tài khoản' },
          { key: 'fullName', label: 'Họ và tên' },
          { key: 'title', label: 'Chức danh' },
          { key: 'departmentName', label: 'Khoa' },
          {
            key: 'roles',
            label: 'Vai trò',
            render: (row) => {
              const list = parseUserRoles(row.roles);
              if (!list.length) return <span className="text-[var(--muted-foreground)]">Chưa gán</span>;
              return (
                <div className="flex flex-wrap gap-1">
                  {list.map(({ name, code, color }) => (
                      <Badge key={code} tone="muted">
                        <span className="inline-flex items-center gap-1" title={code}>
                          <RoleDot color={color} />
                          {name}
                          {code === SUPER_ADMIN_ROLE ? <Crown className="size-3 text-amber-500" /> : null}
                        </span>
                      </Badge>
                  ))}
                </div>
              );
            },
          },
          {
            key: 'lockedUntil',
            label: 'Trạng thái',
            render: (row) => <UserStatus row={row} />,
          },
          {
            key: 'lastLoginAt',
            label: 'Đăng nhập gần nhất',
            render: (row) => (row.lastLoginAt ? formatDateTime(String(row.lastLoginAt)) : '—'),
          },
        ]}
        rowActions={(row) => (
          <>
            {can('user.view') ? (
              <Button variant="ghost" size="icon" title="Xem quyền hiệu lực" onClick={() => { setPermKeyword(''); setPermsTarget(row); }}>
                <Eye />
              </Button>
            ) : null}
            {can('user.update') ? (
              <Button
                variant="ghost"
                size="icon"
                title="Đăng ký sinh trắc học khuôn mặt"
                onClick={() => setBiometricTarget(row)}
                className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/50"
              >
                <Camera className="size-4" />
              </Button>
            ) : null}
            {can('user.assign-role') ? (
              <Button
                variant="ghost"
                size="icon"
                title="Gán vai trò"
                onClick={() => {
                  setRoleTarget(row);
                  setRoleCodes(parseUserRoles(row.roles).map((r) => r.code));
                }}
              >
                <ShieldCheck />
              </Button>
            ) : null}
            {can('user.update') ? (
              <Button variant="ghost" size="icon" title="Phạm vi khoa được xem" onClick={() => setScopeTarget(row)}>
                <Building2 />
              </Button>
            ) : null}
            {can('user.reset-password') ? (
              <Button variant="ghost" size="icon" title="Đặt lại mật khẩu" onClick={() => setResetTarget(row)}>
                <KeyRound />
              </Button>
            ) : null}
            {row.lockedUntil && new Date(String(row.lockedUntil)) > new Date() && can('user.update') ? (
              <Button variant="ghost" size="icon" title="Mở khoá" onClick={() => setUnlockTarget(row)}>
                <LockOpen />
              </Button>
            ) : null}
          </>
        )}
      />

      {/* Gán vai trò */}
      <Dialog
        open={!!roleTarget}
        onClose={() => setRoleTarget(null)}
        title={`Gán vai trò: ${String(roleTarget?.fullName ?? '')}`}
        description="Vai trò quyết định tập quyền và phạm vi số liệu được xem. Người dùng nhận HỢP NHẤT quyền của mọi vai trò được gán và phạm vi RỘNG NHẤT."
        footer={
          <>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>
              Huỷ
            </Button>
            <Button
              loading={setRoles.isPending}
              onClick={() => roleTarget && setRoles.mutate({ id: Number(roleTarget.id), roleCodes: [...new Set(roleCodes.filter(Boolean))] })}
            >
              Lưu vai trò
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {highPrivilegePicked.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                Đang chọn vai trò cấp cao: <b>{highPrivilegePicked.join(', ')}</b>. Chỉ gán cho tài khoản thật sự cần
                quyền hệ thống; hãy chắc chắn tài khoản là chính chủ và đã dùng mật khẩu mạnh.
              </div>
            </div>
          ) : null}
          {(roles ?? []).map((role) => {
            const doctorDutyRole = role.code === 'NHAN_VIEN_TRUC' && isDoctorTitle(roleTarget?.title);
            const checked = doctorDutyRole || roleCodes.includes(role.code);
            const disabled = (role.code === SUPER_ADMIN_ROLE && !me?.isSuperAdmin) || doctorDutyRole;
            return (
              <label
                key={role.code}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 hover:bg-[var(--muted)]',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) =>
                    setRoleCodes((prev) => (e.target.checked ? [...prev, role.code] : prev.filter((c) => c !== role.code)))
                  }
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <RoleDot color={role.color} />
                    {role.name}
                    {role.code === SUPER_ADMIN_ROLE ? <Crown className="size-3.5 text-amber-500" /> : null}
                    <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{role.code}</span>
                    {role.code === SUPER_ADMIN_ROLE && !me?.isSuperAdmin ? <Badge tone="muted">Chỉ Quản trị tối cao</Badge> : null}
                    {doctorDutyRole ? <Badge tone="success">Mặc định cho Bác sĩ</Badge> : null}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    Phạm vi: {SCOPE_LABEL[role.dataScope]}
                    {role.description ? ` · ${role.description}` : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Dialog>

      {/* Phạm vi khoa được xem */}
      <Dialog
        open={!!scopeTarget}
        onClose={() => setScopeTarget(null)}
        title={`Phạm vi khoa: ${String(scopeTarget?.fullName ?? '')}`}
        description="Áp dụng khi vai trò có phạm vi Theo khoa — người dùng chỉ thấy số liệu của các khoa được tick. Để trống = theo khoa công tác."
        footer={
          <>
            <Button variant="outline" onClick={() => setScopeTarget(null)}>
              Huỷ
            </Button>
            <Button
              loading={setScopes.isPending}
              disabled={userDetail.isLoading}
              onClick={() => scopeTarget && setScopes.mutate({ id: Number(scopeTarget.id), departmentIds: scopeDeptIds })}
            >
              Lưu phạm vi
            </Button>
          </>
        }
      >
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {(departments ?? []).map((d) => {
            const checked = scopeDeptIds.includes(d.id);
            return (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setScopeDeptIds((prev) => (e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)))
                  }
                />
                <span style={{ paddingLeft: `${Math.max(0, d.level - 1) * 14}px` }}>{d.name}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
          <span>{scopeDeptIds.length > 0 ? `Đã chọn ${scopeDeptIds.length} khoa` : 'Chưa chọn khoa nào'}</span>
          <button type="button" className="text-[var(--primary)] hover:underline" onClick={() => setScopeDeptIds([])}>
            Xoá hết lựa chọn
          </button>
        </div>
      </Dialog>

      {/* Quyền hiệu lực */}
      <Dialog
        open={!!permsTarget}
        onClose={() => setPermsTarget(null)}
        title={`Quyền hiệu lực: ${String(effective.data?.user.fullName ?? permsTarget?.fullName ?? '')}`}
        size="lg"
        footer={<Button variant="outline" onClick={() => setPermsTarget(null)}>Đóng</Button>}
      >
        {effective.isLoading ? (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">Đang tải…</div>
        ) : effective.data ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-3">
                <div className="text-[11px] uppercase text-[var(--muted-foreground)]">Vai trò</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {effective.data.isSuperAdmin ? (
                    <Badge tone="danger">
                      <Crown className="mr-1 size-3" /> {SUPER_ADMIN_ROLE}
                    </Badge>
                  ) : effective.data.roles.length === 0 ? (
                    <span className="text-xs text-[var(--muted-foreground)]">Chưa gán</span>
                  ) : (
                    effective.data.roles.map((r) => (
                      <Badge key={r.code} tone="muted">
                        <span className="inline-flex items-center gap-1">
                          <RoleDot color={r.color} /> {r.name}
                        </span>
                      </Badge>
                    ))
                  )}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] uppercase text-[var(--muted-foreground)]">Phạm vi dữ liệu</div>
                <div className="mt-1 text-sm font-medium">{SCOPE_LABEL[effective.data.dataScope] ?? effective.data.dataScope}</div>
                {effective.data.dataScope === 'DEPT' ? (
                  <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    {scopeDeptNames.length > 0 ? scopeDeptNames.join(' · ') : 'Theo khoa công tác (chưa gán khoa cụ thể)'}
                  </div>
                ) : null}
              </Card>
              <Card className="p-3">
                <div className="text-[11px] uppercase text-[var(--muted-foreground)]">Tổng quyền</div>
                <div className="mt-1 text-2xl font-bold text-[var(--primary)]">
                  {effective.data.isSuperAdmin ? 'Mọi quyền' : effective.data.permissionCount}
                </div>
              </Card>
            </div>

            {effective.data.isSuperAdmin ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                <Crown className="mr-1.5 inline size-4 align-text-bottom" />
                Quản trị tối cao luôn được <b>mọi quyền</b> trong hệ thống, kể cả quyền mới thêm về sau.
              </div>
            ) : (
              <>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                  placeholder="Tìm nhanh quyền…"
                  value={permKeyword}
                  onChange={(e) => setPermKeyword(e.target.value)}
                />
                <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                  {permsByModule.length === 0 ? (
                    <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
                      Không có quyền phù hợp.
                    </div>
                  ) : (
                    permsByModule.map(([module, list]) => (
                      <div key={module} className="overflow-hidden rounded-xl border">
                        <div className="border-b bg-[var(--muted)]/50 px-3 py-1.5 text-xs font-semibold">
                          {MODULE_LABEL[module] ?? module}
                          <span className="ml-2 font-normal text-[var(--muted-foreground)]">{list.length} quyền</span>
                        </div>
                        <div className="grid gap-x-4 gap-y-1 p-3 sm:grid-cols-2">
                          {list.map((p) => (
                            <div key={p.code} className="min-w-0 text-sm">
                              <span className="block truncate">{p.name}</span>
                              <span className="block text-[10px] text-[var(--muted-foreground)]">
                                <span className="font-mono">{p.code}</span>
                                {p.fromRoles?.length ? <span> ← {p.fromRoles.join(', ')}</span> : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">Không tải được dữ liệu.</div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!resetTarget}
        title="Đặt lại mật khẩu"
        message={
          <>
            Đặt lại mật khẩu cho <b>{String(resetTarget?.fullName ?? '')}</b> về mặc định và buộc đổi ở lần đăng nhập
            tới? Mọi phiên đăng nhập hiện tại sẽ bị thu hồi.
          </>
        }
        confirmText="Đặt lại"
        loading={resetPassword.isPending}
        onConfirm={() => resetTarget && resetPassword.mutate(Number(resetTarget.id))}
        onClose={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!unlockTarget}
        title="Mở khoá tài khoản"
        message={<>Mở khoá tài khoản <b>{String(unlockTarget?.username ?? '')}</b> và xoá số lần đăng nhập sai?</>}
        confirmText="Mở khoá"
        loading={unlock.isPending}
        onConfirm={() => unlockTarget && unlock.mutate(Number(unlockTarget.id))}
        onClose={() => setUnlockTarget(null)}
      />

      <Dialog
        open={!!tempPassword}
        onClose={() => setTempPassword(null)}
        title="Mật khẩu tạm thời"
        size="sm"
        footer={
          <Button onClick={() => setTempPassword(null)}>
            <Lock /> Đã hiểu
          </Button>
        }
      >
        <p className="text-sm">
          Mật khẩu tạm thời là <b className="font-mono">{tempPassword}</b>. Vui lòng gửi cho người dùng và yêu cầu đổi
          ngay sau khi đăng nhập.
        </p>
      </Dialog>
      <UserImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <BiometricEnrollDialog
        user={biometricTarget as any}
        open={!!biometricTarget}
        onClose={() => setBiometricTarget(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['/users'] })}
      />
    </>
  );
}
