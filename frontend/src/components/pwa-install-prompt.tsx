'use client';

import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'qlbs.pwa-install-dismissed-until';
const DISMISS_MS = 21 * 24 * 60 * 60 * 1000;

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

/**
 * Lời mời cài PWA khi mở QLBS bằng HTTPS. Không hiện trong app đã cài;
 * iPhone được hướng dẫn theo luồng Share → Add to Home Screen của Safari.
 */
export function PwaInstallPrompt() {
  const pathname = usePathname();
  // Kiosk/QR là luồng vận hành chuyên dụng toàn màn hình; tuyệt đối không che
  // bằng lời mời cài ứng dụng hoặc đăng ký service worker từ màn hình đó.
  const allowedPage = !pathname.startsWith('/kiosk') && !pathname.startsWith('/scan');
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!allowedPage) {
      setVisible(false);
      setShowInstructions(false);
      return;
    }
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // PWA is an enhancement; an unavailable worker must never block QLBS.
      });
    }

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIos(ios);

    const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    if (!isStandalone() && dismissedUntil <= Date.now()) setVisible(true);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      if (!isStandalone()) setVisible(true);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setShowInstructions(false);
      setVisible(false);
      window.localStorage.removeItem(DISMISS_KEY);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [allowedPage]);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
    setShowInstructions(false);
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) {
      setShowInstructions(true);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === 'accepted') {
      setVisible(false);
      window.localStorage.removeItem(DISMISS_KEY);
    }
  };

  if (!visible) return null;

  return (
    <>
      <aside
        className="app-safe-bottom fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-2xl border border-teal-200 bg-white/95 p-3.5 shadow-xl backdrop-blur dark:border-teal-800 dark:bg-slate-950/95 sm:bottom-5 sm:p-4"
        aria-label="Cài ứng dụng QLBS"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-600 text-white shadow-sm">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Cài QLBS lên điện thoại</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              Mở nhanh như ứng dụng, không cần tìm lại đường link. Dữ liệu và phiên làm việc vẫn được bảo vệ như khi dùng trên web.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void install()}>
                <Download className="h-4 w-4" /> Cài ứng dụng
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>Để sau</Button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Đóng lời mời cài ứng dụng"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {showInstructions ? (
        <div className="app-viewport-fixed app-safe-overlay fixed inset-x-0 top-0 z-[80] flex items-end overflow-y-auto bg-slate-950/40 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
          <div className="w-full max-w-md rounded-2xl bg-[var(--card)] p-5 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-teal-700 dark:text-teal-300">
              {isIos ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
              <h2 id="pwa-install-title" className="text-base font-semibold">Cài QLBS lên màn hình chính</h2>
            </div>
            {isIos ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
                <li>Mở trang này bằng <b className="text-[var(--foreground)]">Safari</b>.</li>
                <li>Chạm nút <b className="text-[var(--foreground)]">Chia sẻ</b> ở thanh công cụ.</li>
                <li>Chọn <b className="text-[var(--foreground)]">Thêm vào Màn hình chính</b>, rồi chạm <b className="text-[var(--foreground)]">Thêm</b>.</li>
              </ol>
            ) : (
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                Nếu trình duyệt chưa hiện hộp cài đặt, mở menu trình duyệt và chọn <b className="text-[var(--foreground)]">Cài ứng dụng</b> hoặc <b className="text-[var(--foreground)]">Thêm vào màn hình chính</b>.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowInstructions(false)}>Đóng</Button>
              <Button variant="outline" onClick={dismiss}>Không nhắc lại</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
