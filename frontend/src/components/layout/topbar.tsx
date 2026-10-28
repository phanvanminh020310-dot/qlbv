'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Moon, Search, Sun, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRealtimeEvent } from '@/lib/realtime';
import { cn, formatDateTime } from '@/lib/utils';
import type { Notification } from '@/types/api';

/** Thanh trên cùng: tìm kiếm nhanh, thông báo, đổi giao diện sáng/tối, menu người dùng. */
export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const inAssets = pathname.startsWith('/tai-san');
  const canAsset = can('asset.view');
  const canHsba = can('hsba.request.view');
  const logout = useAuth((s) => s.logout);
  const [dark, setDark] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [keyword, setKeyword] = useState('');
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('qlbs_theme');
    const isDark = saved === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  useEffect(() => {
    const onClickAway = (e: MouseEvent): void => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const queryClient = useQueryClient();
  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ items: Notification[]; total: number; unread: number }>('/notifications?limit=12'),
    refetchInterval: 300_000, // dự phòng — bình thường SSE đã cập nhật tức thì
  });

  // GĐ3: thông báo mới qua kênh realtime — chuông cập nhật ngay, không chờ polling
  useRealtimeEvent((event) => {
    if (event.topic === 'notification') {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const toggleTheme = (): void => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('qlbs_theme', next ? 'dark' : 'light');
  };

  /**
   * Tìm kiếm nhanh theo ngữ cảnh:
   * - Có quyền tài sản và chuỗi khớp đúng mã tài sản / mã vạch / serial (vd quét bằng máy quét) → mở thẳng hồ sơ.
   * - Đang ở phân hệ tài sản (hoặc không có quyền HSBA) → tìm trong danh sách tài sản.
   * - Còn lại → tìm phiếu sửa HSBA như trước.
   */
  const onSearch = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw) return;
    // Tra cứu nhanh mã tài sản: giới hạn 2 giây — nếu mạng/máy chủ chậm thì bỏ qua
    // và rơi về tìm kiếm thường, không để thanh tìm kiếm "đơ" im lặng.
    if (canAsset && !/\s/.test(kw) && kw.length >= 3) {
      try {
        const hit = await Promise.race([
          apiFetch<{ id: number }>(`/assets/lookup/${encodeURIComponent(kw)}`),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        if (hit?.id) {
          setKeyword('');
          router.push(`/tai-san/${hit.id}`);
          return;
        }
      } catch {
        /* không phải mã tài sản hoặc quá chậm → tìm theo từ khoá */
      }
    }
    if (canAsset && (inAssets || !canHsba)) {
      if (pathname === '/tai-san/danh-sach') window.dispatchEvent(new CustomEvent('qlbs:asset-search', { detail: kw }));
      else router.push(`/tai-san/danh-sach?q=${encodeURIComponent(kw)}&status=`);
      return;
    }
    router.push(`/ho-so-benh-an?q=${encodeURIComponent(kw)}`);
  };
  const searchHint =
    canAsset && (inAssets || !canHsba)
      ? 'Tìm tài sản theo mã, tên, serial… hoặc quét mã vạch/QR'
      : canAsset
        ? 'Tìm phiếu sửa HSBA (tên BN, mã KCB, thẻ BHYT) — quét mã tài sản để mở hồ sơ'
        : 'Tìm phiếu sửa HSBA theo tên bệnh nhân, mã KCB, mã thẻ BHYT…';

  const unread = notifications?.unread ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-[var(--card)] px-3 lg:px-4">
      <button type="button" onClick={onOpenMenu} className="rounded-lg p-2 lg:hidden" aria-label="Mở menu">
        <Menu className="size-5" />
      </button>

      <form onSubmit={(e) => void onSearch(e)} className="relative hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={searchHint}
          title={searchHint}
          className="h-9.5 w-full rounded-lg border bg-[var(--background)] pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </form>

      <div className="flex flex-1 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 hover:bg-[var(--muted)]"
          aria-label="Đổi giao diện sáng/tối"
        >
          {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </button>

        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setShowNotifications((v) => !v)}
            className="relative rounded-lg p-2 hover:bg-[var(--muted)]"
            aria-label="Thông báo"
          >
            <Bell className="size-4.5" />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </button>

          {showNotifications ? (
            <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border bg-[var(--card)] shadow-xl">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-sm font-semibold">Thông báo</div>
                {unread > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-[var(--primary)] hover:underline"
                    onClick={async () => {
                      await apiFetch('/notifications/read-all', { method: 'PATCH' });
                      queryClient.invalidateQueries({ queryKey: ['notifications'] });
                    }}
                  >
                    Đánh dấu đã đọc
                  </button>
                ) : null}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {(notifications?.items ?? []).length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                    Chưa có thông báo nào
                  </div>
                ) : (
                  notifications?.items.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link || '#'}
                      onClick={() => {
                        setShowNotifications(false);
                        if (!n.readAt) markRead.mutate(n.id);
                      }}
                      className={cn(
                        'block border-b px-3 py-2 last:border-b-0 hover:bg-[var(--muted)]',
                        !n.readAt && 'bg-[var(--accent)]/40',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <span
                            className={cn(
                              'mt-1.5 size-1.5 shrink-0 rounded-full',
                              n.level === 'SUCCESS'
                                ? 'bg-emerald-500'
                                : n.level === 'WARNING'
                                  ? 'bg-amber-500'
                                  : n.level === 'ERROR'
                                    ? 'bg-red-500'
                                    : 'bg-sky-500',
                            )}
                          />
                          <div className="truncate text-sm font-medium">{n.title}</div>
                        </div>
                        <div className="whitespace-nowrap text-[10px] text-[var(--muted-foreground)]">
                          {formatDateTime(n.createdAt)}
                        </div>
                      </div>
                      {n.body ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">{n.body}</div>
                      ) : null}
                    </Link>
                  ))
                )}
              </div>
              <div className="border-t px-3 py-2 text-center">
                <Link
                  href="/thong-bao"
                  onClick={() => setShowNotifications(false)}
                  className="text-xs font-medium text-[var(--primary)] hover:underline"
                >
                  Xem trung tâm thông báo
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--muted)]"
          >
            <div className="flex size-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]">
              <UserIcon className="size-4" />
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-xs font-semibold leading-tight">{user?.fullName}</div>
              <div className="text-[10px] leading-tight text-[var(--muted-foreground)]">
                {user?.roles?.join(', ')}
              </div>
            </div>
          </button>

          {showUserMenu ? (
            <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border bg-[var(--card)] py-1 shadow-xl">
              <div className="border-b px-3 py-2">
                <div className="text-sm font-medium">{user?.fullName}</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {user?.username} · {user?.departmentName || 'Chưa gán khoa'}
                </div>
              </div>
              <Link href="/ca-nhan" className="block px-3 py-2 text-sm hover:bg-[var(--muted)]">
                Thông tin cá nhân
              </Link>
              <Link href="/ca-nhan/doi-mat-khau" className="block px-3 py-2 text-sm hover:bg-[var(--muted)]">
                Đổi mật khẩu
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--muted)]"
                onClick={async () => {
                  await logout();
                  toast.success('Đã đăng xuất');
                  router.replace('/login');
                }}
              >
                <LogOut className="size-4" /> Đăng xuất
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
