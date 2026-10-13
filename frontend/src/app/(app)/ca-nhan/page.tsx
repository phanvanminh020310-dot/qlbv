'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Building,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Monitor,
  Phone,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Unlink,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Badge, Card, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { BiometricEnrollDialog } from '@/components/users/biometric-enroll-dialog';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, toList } from '@/lib/utils';

interface Profile {
  id: number;
  username: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  departmentName: string | null;
  roles: { code: string; name: string; dataScope: string }[];
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

interface SessionInfo {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** Phân tích User-Agent để hiển thị tên thiết bị và biểu tượng thân thiện */
function parseDeviceInfo(ua: string) {
  if (!ua) return { icon: Monitor, name: 'Thiết bị không xác định' };
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  let os = 'Thiết bị';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Web';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';

  return {
    icon: isMobile ? Smartphone : Laptop,
    name: `${os} · ${browser}`,
  };
}

/**
 * Thẻ liên kết Telegram — kênh nhận thông báo đẩy về điện thoại (miễn phí).
 */
function TelegramCard() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['telegram-status'],
    queryFn: () =>
      apiFetch<{ enabled: boolean; botUsername: string; linked: boolean; deepLink: string }>(
        '/notify-channels/telegram/status',
      ),
  });
  const createCode = useMutation({
    mutationFn: () =>
      apiFetch<{ code: string; expiresAt: string; deepLink: string }>('/notify-channels/telegram/link-code', {
        method: 'POST',
      }),
  });
  const unlink = useMutation({
    mutationFn: () => apiFetch('/notify-channels/telegram/link', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Đã huỷ liên kết Telegram');
      void queryClient.invalidateQueries({ queryKey: ['telegram-status'] });
    },
  });

  const st = status.data;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4 text-sky-500" />
          <span>Thông báo Telegram</span>
        </div>
        <div>
          {status.isLoading ? (
            <Skeleton className="h-5 w-16" />
          ) : st?.linked ? (
            <Badge tone="success" className="text-[11px] flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Đã kết nối
            </Badge>
          ) : createCode.data ? (
            <Badge tone="warning" className="text-[11px]">Chờ xác nhận</Badge>
          ) : (
            <Badge tone="muted" className="text-[11px]">Chưa kết nối</Badge>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4 text-sm">
        {status.isLoading ? (
          <Skeleton className="h-16" />
        ) : !st?.enabled ? (
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            Kênh Telegram Bot chưa được kích hoạt bởi quản trị hệ thống. Khi kích hoạt, bạn sẽ nhận được thông báo ký và duyệt hồ sơ bệnh án trực tiếp trên điện thoại.
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              Nhận thông báo ký số, phân công ca trực và thông tin bệnh viện tức thì qua ứng dụng Telegram trên điện thoại cá nhân.
            </p>

            {createCode.data && !st.linked ? (
              <div className="space-y-2.5 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/30 p-3">
                <div className="text-xs text-sky-800 dark:text-sky-300">
                  Gửi tin nhắn sau cho bot Telegram trong vòng 10 phút:
                </div>
                <div className="rounded bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs font-semibold text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-800 break-all select-all">
                  /start {createCode.data.code}
                </div>
                {createCode.data.deepLink ? (
                  <Button
                    size="sm"
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white shadow-sm text-xs font-medium"
                    onClick={() => window.open(createCode.data!.deepLink, '_blank')}
                  >
                    <Send className="size-3.5 mr-1" /> Mở Bot Telegram ngay
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="pt-1">
              {!st.linked ? (
                <Button
                  size="sm"
                  variant={createCode.data ? 'outline' : 'default'}
                  loading={createCode.isPending}
                  onClick={() => createCode.mutate()}
                  className="w-full sm:w-auto text-xs"
                >
                  <Send className="size-3.5 mr-1" /> {createCode.data ? 'Tạo lại mã khác' : 'Tạo mã liên kết'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  loading={unlink.isPending}
                  onClick={() => unlink.mutate()}
                  className="w-full sm:w-auto text-xs text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <Unlink className="size-3.5 mr-1" /> Huỷ liên kết Telegram
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [enrollOpen, setEnrollOpen] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<Profile>('/auth/profile'),
  });

  const { data: bioStatus, refetch: refetchBioStatus } = useQuery({
    queryKey: ['my-biometric-status', profile?.id],
    enabled: !!profile?.id,
    queryFn: () =>
      apiFetch<{
        enrolled: boolean;
        avatarUrl: string | null;
        canSelfEnroll?: boolean;
        canSelfUpdate?: boolean;
      }>(`/kiosk/biometrics/status/${profile?.id}`),
  });

  const isAdmin = Boolean(
    user?.isSuperAdmin ||
    user?.roles?.includes('SUPER_ADMIN') ||
    user?.roles?.includes('ADMIN') ||
    user?.permissions?.includes('user.manage') ||
    user?.permissions?.includes('kiosk.admin')
  );
  const canUpdateFace = Boolean(isAdmin || bioStatus?.canSelfUpdate);
  const canEnrollFace = Boolean(isAdmin || bioStatus?.canSelfEnroll);

  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiFetch<unknown>('/auth/sessions').then((d) => toList<SessionInfo>(d, 'sessions')),
  });

  useEffect(() => {
    if (profile) {
      setForm({
        fullName: profile.fullName,
        title: profile.title ?? '',
        email: profile.email ?? '',
        phone: profile.phone ?? '',
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: () => apiFetch('/auth/profile', { method: 'PUT', body: form }),
    onSuccess: async () => {
      toast.success('Đã cập nhật hồ sơ thành công');
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await useAuth.getState().loadMe();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const revokeSession = useMutation({
    mutationFn: (id: string) => apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Đã thu hồi phiên đăng nhập');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const permissionsByModule = (profile?.permissions ?? []).reduce<Record<string, number>>((acc, code) => {
    const module = code.split('.')[0];
    acc[module] = (acc[module] ?? 0) + 1;
    return acc;
  }, {});

  // Lấy 2 chữ cái đầu làm avatar nếu chưa có ảnh
  const getInitials = (name?: string) => {
    if (!name) return 'BS';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-10">
      <PageHeader
        title="Thông tin cá nhân"
        description="Quản lý hồ sơ bác sĩ, dữ liệu sinh trắc học khuôn mặt, quyền hạn và bảo mật"
      />

      {isLoading || !profile ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-96 lg:col-span-2 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* BANNER THÔNG TIN BÁC SĨ & TRẠNG THÁI KHUÔN MẶT KIOSK (TỐI ƯU CHO DI ĐỘNG) */}
          <div className="relative overflow-hidden rounded-2xl border border-teal-200/70 dark:border-teal-900/50 bg-gradient-to-br from-teal-50/70 via-sky-50/50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 text-center sm:text-left">
              {/* Avatar với nút chụp ảnh khuôn mặt nhanh */}
              <div className="relative group shrink-0">
                <div className="size-20 sm:size-24 rounded-full overflow-hidden border-3 border-white dark:border-slate-800 shadow-md bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-bold text-xl sm:text-2xl">
                  {bioStatus?.avatarUrl ? (
                    <img
                      src={bioStatus.avatarUrl}
                      alt={profile.fullName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span>{getInitials(profile.fullName)}</span>
                  )}
                </div>
                {bioStatus?.enrolled ? (
                  canUpdateFace ? (
                    <button
                      type="button"
                      onClick={() => setEnrollOpen(true)}
                      className="absolute bottom-0 right-0 rounded-full bg-teal-600 hover:bg-teal-500 text-white p-2 shadow-lg border-2 border-white dark:border-slate-900 transition-transform active:scale-90"
                      title="Chụp đổi lại khuôn mặt"
                    >
                      <Camera className="size-3.5" />
                    </button>
                  ) : (
                    <div
                      className="absolute bottom-0 right-0 rounded-full bg-emerald-600 text-white p-1.5 shadow-md border-2 border-white dark:border-slate-900"
                      title="Khuôn mặt đã khoá an ninh điểm danh"
                    >
                      <Lock className="size-3" />
                    </div>
                  )
                ) : canEnrollFace ? (
                  <button
                    type="button"
                    onClick={() => setEnrollOpen(true)}
                    className="absolute bottom-0 right-0 rounded-full bg-amber-600 hover:bg-amber-500 text-white p-2 shadow-lg border-2 border-white dark:border-slate-900 transition-transform active:scale-90 animate-bounce"
                    title="Chụp đăng ký khuôn mặt"
                  >
                    <Camera className="size-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Tên, chức danh, khoa công tác và vai trò */}
              <div className="flex-1 min-w-0 space-y-1.5 w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      {profile.title ? <span className="text-teal-700 dark:text-teal-400 mr-1.5">{profile.title}</span> : null}
                      {profile.fullName}
                    </h2>
                    <div className="text-xs font-mono text-[var(--muted-foreground)] mt-0.5">
                      @{profile.username}
                    </div>
                  </div>

                  {/* Nút hành động chụp khuôn mặt trên máy tính / di động */}
                  <div className="flex sm:justify-end">
                    {bioStatus?.enrolled ? (
                      canUpdateFace ? (
                        <Button
                          size="sm"
                          onClick={() => setEnrollOpen(true)}
                          className="w-full sm:w-auto font-medium text-xs shadow-sm bg-teal-600 hover:bg-teal-500 text-white"
                        >
                          <Camera className="size-3.5 mr-1.5" />
                          Cập nhật khuôn mặt
                        </Button>
                      ) : (
                        <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100/90 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold shadow-xs">
                          <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Đã khoá an ninh điểm danh</span>
                        </div>
                      )
                    ) : canEnrollFace ? (
                      <Button
                        size="sm"
                        onClick={() => setEnrollOpen(true)}
                        className="w-full sm:w-auto font-medium text-xs shadow-sm bg-amber-600 hover:bg-amber-500 text-white animate-pulse"
                      >
                        <Camera className="size-3.5 mr-1.5" />
                        Đăng ký khuôn mặt ngay
                      </Button>
                    ) : (
                      <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs font-medium">
                        <Building className="size-3.5 text-amber-600 dark:text-amber-400" />
                        <span>Đăng ký tại Phòng TCCB / IT</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1 text-xs">
                  {profile.departmentName ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/80 dark:bg-slate-800/80 border text-slate-700 dark:text-slate-300 font-medium">
                      <Building className="size-3 text-teal-600 dark:text-teal-400" />
                      {profile.departmentName}
                    </span>
                  ) : null}

                  {(profile.roles ?? []).map((role) => (
                    <Badge key={role.code} tone="info" className="text-[11px]">
                      {role.name}
                    </Badge>
                  ))}
                  {user?.isSuperAdmin ? (
                    <Badge tone="success" className="text-[11px]">
                      Quản trị tối cao
                    </Badge>
                  ) : null}
                </div>

                {/* Banner trạng thái sinh trắc học Kiosk */}
                <div className="mt-3">
                  {bioStatus?.enrolled ? (
                    <div className="flex items-center justify-center sm:justify-start gap-2 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl px-3 py-2">
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        {canUpdateFace
                          ? 'Đã đăng ký nhận diện khuôn mặt sinh trắc học (sẵn sàng điểm danh ca trực & tự động mở khoá máy tính phòng khám).'
                          : 'Hồ sơ khuôn mặt đã xác thực và khoá an ninh ca trực. Để chống gian lận điểm danh, cấp đổi khuôn mặt chỉ được thực hiện tại Phòng Tổ chức Cán bộ hoặc Phòng CNTT.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center sm:justify-start gap-2 text-xs text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2">
                      <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        {canEnrollFace
                          ? 'Chưa có dữ liệu khuôn mặt. Hãy bấm Đăng ký khuôn mặt ngay ở trên để AI nhận diện bạn khi nhận ca trực.'
                          : 'Chưa có dữ liệu khuôn mặt. Vui lòng liên hệ Phòng Tổ chức Cán bộ hoặc Phòng CNTT tại tầng quản trị để chụp ảnh đối chiếu ban đầu.'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* NỘI DUNG CHÍNH: CHIA LƯỚI 3 CỘT (DESKTOP) / 1 CỘT (DI ĐỘNG) */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* CỘT TRÁI (2 CỘT): HỒ SƠ & PHIÊN ĐĂNG NHẬP */}
            <div className="space-y-4 lg:col-span-2">
              {/* Thẻ sửa thông tin cá nhân */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <User className="size-4 text-[var(--primary)]" />
                    <span>Hồ sơ cá nhân</span>
                  </div>
                  <span className="text-xs text-[var(--muted-foreground)]">ID #{profile.id}</span>
                </div>

                <div className="p-4 sm:p-5">
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--muted-foreground)] font-medium">Tên đăng nhập</Label>
                      <Input value={profile.username} disabled className="bg-slate-50 dark:bg-slate-900/50 h-10" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--muted-foreground)] font-medium">Khoa / Phòng ban</Label>
                      <Input value={profile.departmentName ?? 'Chưa phân bổ khoa'} disabled className="bg-slate-50 dark:bg-slate-900/50 h-10" />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inp-fullname" className="text-xs font-medium">Họ và tên *</Label>
                      <Input
                        id="inp-fullname"
                        value={String(form.fullName ?? '')}
                        onChange={(e) => setForm((s) => ({ ...s, fullName: e.target.value }))}
                        className="h-10"
                        placeholder="Nhập họ và tên đầy đủ"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inp-title" className="text-xs font-medium">Chức danh chuyên môn</Label>
                      <Input
                        id="inp-title"
                        value={String(form.title ?? '')}
                        onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                        className="h-10"
                        placeholder="Vd: BS.CKI, ThS.BS, Bác sĩ điều trị..."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inp-email" className="text-xs font-medium">Địa chỉ Email</Label>
                      <Input
                        id="inp-email"
                        type="email"
                        value={String(form.email ?? '')}
                        onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                        className="h-10"
                        placeholder="bacsi@bvqy4.vn"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inp-phone" className="text-xs font-medium">Số điện thoại liên lạc</Label>
                      <Input
                        id="inp-phone"
                        type="tel"
                        value={String(form.phone ?? '')}
                        onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                        className="h-10"
                        placeholder="09xx xxx xxx"
                      />
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t flex justify-end">
                    <Button
                      loading={save.isPending}
                      onClick={() => save.mutate()}
                      className="w-full sm:w-auto h-10 px-6 font-medium shadow-sm"
                    >
                      <Save className="size-4 mr-1.5" /> Lưu thay đổi hồ sơ
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Thẻ danh sách phiên đăng nhập thiết bị */}
              <Card className="overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Monitor className="size-4 text-[var(--primary)]" />
                    <span>Phiên đăng nhập & thiết bị</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto text-xs text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={async () => {
                      await logout(true);
                      router.replace('/login');
                    }}
                  >
                    <LogOut className="size-3.5 mr-1" /> Đăng xuất mọi thiết bị
                  </Button>
                </div>

                <div className="divide-y">
                  {(sessions ?? []).map((s) => {
                    const dev = parseDeviceInfo(s.userAgent);
                    const DevIcon = dev.icon;
                    return (
                      <div
                        key={s.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 sm:px-4 sm:py-3 hover:bg-[var(--muted)]/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
                            <DevIcon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-medium truncate text-slate-900 dark:text-slate-100">
                              {dev.name}
                            </div>
                            <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-2 mt-0.5">
                              <span className="font-mono">{s.ip}</span>
                              <span>·</span>
                              <span>{formatDateTime(s.lastSeenAt ?? s.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end pt-1 sm:pt-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-[var(--danger)] hover:bg-rose-50 dark:hover:bg-rose-950/40 h-8 px-2.5"
                            onClick={() => revokeSession.mutate(s.id)}
                            loading={revokeSession.isPending}
                          >
                            Thu hồi phiên
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {(sessions ?? []).length === 0 ? (
                    <div className="p-6 text-center text-xs text-[var(--muted-foreground)]">
                      Chỉ có 1 phiên làm việc hiện tại trên thiết bị này.
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>

            {/* CỘT PHẢI (1 CỘT): KIOSK SINH TRẮC HỌC, TELEGRAM, VAI TRÒ & BẢO MẬT */}
            <div className="space-y-4">
              {/* Thẻ Sinh trắc học khuôn mặt Kiosk */}
              <Card className="overflow-hidden border-teal-200/70 dark:border-teal-900/50">
                <div className="flex items-center justify-between border-b px-4 py-3 bg-teal-50/40 dark:bg-teal-950/20">
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-800 dark:text-teal-300">
                    <Camera className="size-4 text-teal-600 dark:text-teal-400" />
                    <span>Sinh trắc học Kiosk</span>
                  </div>
                  {bioStatus?.enrolled ? (
                    <Badge tone="success" className="text-[11px] flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Đã đăng ký
                    </Badge>
                  ) : (
                    <Badge tone="warning" className="text-[11px]">Chưa đăng ký</Badge>
                  )}
                </div>

                <div className="p-4 space-y-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-14 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-teal-500/30 flex items-center justify-center shrink-0 shadow-sm">
                      {bioStatus?.avatarUrl ? (
                        <img src={bioStatus.avatarUrl} alt="Face Avatar" className="size-full object-cover" />
                      ) : (
                        <User className="size-7 text-slate-400" />
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      AI nhận diện khuôn mặt bác sĩ để tự động điểm danh ca trực và mở khoá màn hình máy tính tại các phòng khám bệnh viện.
                    </div>
                  </div>

                  {bioStatus?.enrolled ? (
                    canUpdateFace ? (
                      <Button
                        size="sm"
                        onClick={() => setEnrollOpen(true)}
                        className="w-full text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white shadow-sm h-9"
                      >
                        <Camera className="size-3.5 mr-1.5" />
                        Chụp cập nhật lại khuôn mặt
                      </Button>
                    ) : (
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs text-[var(--muted-foreground)]">
                        <Lock className="size-4 shrink-0 text-emerald-600 mt-0.5" />
                        <span>Hồ sơ đã khoá an ninh ca trực. Chỉ Quản trị viên hoặc Phòng TCCB mới có quyền cấp đổi lại khuôn mặt cho nhân sự.</span>
                      </div>
                    )
                  ) : canEnrollFace ? (
                    <Button
                      size="sm"
                      onClick={() => setEnrollOpen(true)}
                      className="w-full text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white shadow-sm h-9 animate-pulse"
                    >
                      <Camera className="size-3.5 mr-1.5" />
                      Đăng ký khuôn mặt ngay
                    </Button>
                  ) : (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200">
                      <AlertCircle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                      <span>Chưa có dữ liệu sinh trắc học. Vui lòng liên hệ Phòng Tổ chức cán bộ hoặc Phòng CNTT để chụp ảnh đăng ký.</span>
                    </div>
                  )}
                </div>
              </Card>

              {/* Thẻ liên kết Telegram */}
              <TelegramCard />

              {/* Thẻ vai trò & phân quyền */}
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold bg-slate-50/50 dark:bg-slate-900/40">
                  <ShieldCheck className="size-4 text-[var(--primary)]" />
                  <span>Vai trò & Quyền hạn</span>
                </div>

                <div className="space-y-3 p-4">
                  <div className="space-y-1">
                    <div className="text-xs text-[var(--muted-foreground)] font-medium">Vai trò tài khoản:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(profile.roles ?? []).map((role) => (
                        <Badge key={role.code} tone="info" className="text-[11px]">
                          {role.name}
                        </Badge>
                      ))}
                      {user?.isSuperAdmin ? (
                        <Badge tone="success" className="text-[11px]">
                          Quản trị tối cao
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-xs text-[var(--muted-foreground)] pt-1">
                    Phạm vi dữ liệu:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {user?.dataScope === 'ALL'
                        ? 'Toàn viện'
                        : user?.dataScope === 'DEPT'
                        ? 'Theo khoa công tác'
                        : 'Cá nhân'}
                    </strong>
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="text-xs text-[var(--muted-foreground)] font-medium">Quyền hạn theo phân hệ:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(permissionsByModule).map(([module, count]) => (
                        <Badge key={module} tone="muted" className="text-[10px]">
                          {module}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="text-[11px] text-[var(--muted-foreground)] pt-1 flex items-center gap-1.5">
                    <Clock className="size-3 text-slate-400" />
                    <span>Đăng nhập gần nhất: {profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : '—'}</span>
                  </div>
                </div>
              </Card>

              {/* Thẻ Bảo mật & Mật khẩu */}
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold bg-slate-50/50 dark:bg-slate-900/40">
                  <KeyRound className="size-4 text-[var(--primary)]" />
                  <span>Bảo mật đăng nhập</span>
                </div>
                <div className="p-4">
                  <Link
                    href="/ca-nhan/doi-mat-khau"
                    className="flex items-center justify-between p-3 rounded-xl border hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-all group"
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-[var(--primary)]">
                        Đổi mật khẩu tài khoản
                      </div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        Cập nhật mật khẩu mới định kỳ để bảo vệ tài khoản
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-[var(--muted-foreground)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {profile && (
        <BiometricEnrollDialog
          user={profile}
          open={enrollOpen}
          onClose={() => setEnrollOpen(false)}
          onSuccess={() => {
            void refetchBioStatus();
          }}
        />
      )}
    </div>
  );
}
