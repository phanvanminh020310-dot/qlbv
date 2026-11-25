'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const LEGACY_DISMISS_KEY = 'qlbs.pwa-install-dismissed-until';

/**
 * Hỗ trợ PWA chạy ngầm — KHÔNG hiển thị bất kỳ lời mời/bảng thông báo cài ứng dụng nào.
 * - Vẫn đăng ký service worker để ai muốn có thể tự cài qua menu trình duyệt
 *   (Chrome: ⋮ → Cài đặt ứng dụng; Safari iPhone: Chia sẻ → Thêm vào MH chính).
 * - Chặn thanh gợi ý cài đặt mặc định của Chrome/Android (`beforeinstallprompt`)
 *   để không bật lên mỗi lần tải trang.
 */
export function PwaInstallPrompt() {
  const pathname = usePathname();
  // Kiosk/QR là luồng vận hành chuyên dụng toàn màn hình — không đăng ký service worker từ đó.
  const allowedPage = !pathname.startsWith('/kiosk') && !pathname.startsWith('/scan');

  useEffect(() => {
    const suppress = (event: Event) => event.preventDefault();
    window.addEventListener('beforeinstallprompt', suppress);
    try {
      window.localStorage.removeItem(LEGACY_DISMISS_KEY);
    } catch {
      /* bỏ qua */
    }
    return () => window.removeEventListener('beforeinstallprompt', suppress);
  }, []);

  useEffect(() => {
    if (!allowedPage || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // PWA là tiện ích bổ sung; service worker lỗi không được chặn QLBS.
    });
  }, [allowedPage]);

  return null;
}
