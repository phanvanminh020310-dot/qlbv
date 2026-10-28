'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { SESSION_EXPIRED_EVENT, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';
import { NotificationToaster } from '@/components/notification-toast';

/**
 * Khu vực yêu cầu đăng nhập: kiểm tra token rồi nạp thông tin ngườ dùng,
 * sau đó mới hiện giao diện để tránh nhấp nháy menu sai quyền.
 * Hết phiên (dù vừa mở link cũ hay đang thao tác) → tự quay về /login.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const loadMe = useAuth((s) => s.loadMe);
  const [checking, setChecking] = useState(true);
  const [connError, setConnError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Phiên hết hạn ở BẤT KỲ lờigọi API nào (kể cả lúc đang thao tác) → về trang đăng nhập
    const onExpired = (): void => {
      tokenStore.clear();
      if (!cancelled) router.replace('/login');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    (async () => {
      if (!tokenStore.access) {
        router.replace('/login');
        return;
      }
      // Chưa có thông tin ngườ dùng → nạp; nạp thất bại vì phiên hết → về login,
      // thất bại vì mạng/máy chủ → hiện màn hình thử lại (Không đăng xuất oan)
      let me: unknown = useAuth.getState().user;
      if (!me) {
        try {
          me = await loadMe();
        } catch {
          if (!cancelled) {
            setChecking(false);
            setConnError(true);
          }
          return;
        }
      }
      if (cancelled) return;
      if (!me) {
        tokenStore.clear();
        router.replace('/login');
        return;
      }
      setConnError(false);
      setChecking(false);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [router, user, loadMe, retryTick]);

  if (connError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="max-w-xs space-y-3 text-center">
          <div className="text-sm font-medium">Không kết nối được máy chủ</div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Kiểm tra mạng nội bộ hoặc máy chủ hệ thống, rồi thử lại. Phiên đăng nhập của bạn vẫn được giữ.
          </p>
          <button
            type="button"
            onClick={() => {
              setConnError(false);
              setChecking(true);
              setRetryTick((t) => t + 1);
            }}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          Đang tải hệ thống…
        </div>
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <AppShell>{children}</AppShell>
      <NotificationToaster />
    </RealtimeProvider>
  );
}
