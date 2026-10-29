'use client';

/**
 * Hệ thống thông báo nổi tức thời — trái tim của trải nghiệm "nhận biết ngay".
 *
 * Ba lớp cảm nhận khi có thông báo mới (qua SSE topic `notification`):
 *  1. TOAST nổi góc màn hình: màu theo mức (xanh dương/xanh lá/vàng/đỏ), bấm
 *     để nhảy thẳng tới phiếu, tự tắt sau ~9 giây, xếp chồng tối đa 4 cái;
 *  2. ÂM THANH "ting" hai tông khẽ bằng WebAudio (không tệp media, không cần
 *     HTTPS; trình duyệt chỉ kích hoạt được sau tương tác đầu tiên của người dùng);
 *  3. BADGE số chưa đọc ngay trên tiêu đề tab trình duyệt.
 *
 * Người dùng tắt/bật từng lớp ở trang /thong-bao; tuỳ chọn lưu localStorage
 * (theo máy, không cần CSDL). Mọi thay đổi tuỳ chọn phát CustomEvent
 * `qlbs.notify.pref` để component này áp dụng ngay.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BellRing, CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useRealtimeEvent } from '@/lib/realtime';
import { cn } from '@/lib/utils';

export type NotificationLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface NotifyPrefs {
  toast: boolean;
  sound: boolean;
  titleBadge: boolean;
}

const PREFS_KEY = 'qlbs.notify.prefs';
export const PREFS_EVENT = 'qlbs.notify.pref';
const TOAST_TTL_MS = 9_000;
const MAX_TOASTS = 4;

export const DEFAULT_PREFS: NotifyPrefs = { toast: true, sound: true, titleBadge: true };

/* ---------------------------------------------------------------------- tuỳ chọn */

export function readNotifyPrefs(): NotifyPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeNotifyPrefs(prefs: NotifyPrefs): void {
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: prefs }));
}

function useNotifyPrefs(): NotifyPrefs {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    setPrefs(readNotifyPrefs());
    const sync = (): void => setPrefs(readNotifyPrefs());
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, []);
  return prefs;
}

/* ----------------------------------------------------------------------- âm thanh */

/** Tiếng "ting-tíng" hai nốt rất kín đáo, sinh bằng oscillator — không cần tệp. */
let audioCtx: AudioContext | null = null;

function playChime(): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const make = (freq: number, startAt: number, duration: number, gainPeak: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.02);
    };
    const t0 = ctx.currentTime;
    make(880, t0, 0.18, 0.05);
    make(1318.5, t0 + 0.12, 0.25, 0.045); // E6 — nốt thứ hai cao hơn, tạo cảm giác "có tin mới"
  } catch {
    /* thiết bị bịt audio — bỏ qua */
  }
}

/** Trình duyệt chặn audio tự phát; mở khoá sau cử chỉ đầu tiên của người dùng. */
function useAudioUnlock(): void {
  useEffect(() => {
    const unlock = (): void => {
      try {
        audioCtx ??= new AudioContext();
        if (audioCtx.state === 'suspended') void audioCtx.resume();
      } catch { /* ignore */ }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
}

/* ---------------------------------------------------------------------- giao diện */

interface ToastItem {
  id: string;
  title: string;
  body: string;
  level: NotificationLevel;
  link: string;
  leaving?: boolean;
}

const LEVEL_STYLE: Record<NotificationLevel, { border: string; icon: typeof Info; iconClass: string }> = {
  INFO: { border: 'border-l-sky-500', icon: Info, iconClass: 'text-sky-500' },
  SUCCESS: { border: 'border-l-emerald-500', icon: CheckCircle2, iconClass: 'text-emerald-500' },
  WARNING: { border: 'border-l-amber-500', icon: TriangleAlert, iconClass: 'text-amber-500' },
  ERROR: { border: 'border-l-red-500', icon: XCircle, iconClass: 'text-red-500' },
};

export function NotificationToaster(): ReactElement {
  const router = useRouter();
  const prefs = useNotifyPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useAudioUnlock();

  /** Badge số chưa đọc trên tiêu đề tab — đọc cùng query với nút chuông. */
  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ unread: number }>('/notifications?limit=12'),
    refetchInterval: 300_000,
  });
  useEffect(() => {
    const unread = notif?.unread ?? 0;
    const clean = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = prefs.titleBadge && unread > 0 ? `(${unread}) ${clean}` : clean;
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
    };
  }, [notif?.unread, prefs.titleBadge]);

  const dismiss = useCallback((id: string): void => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback((item: Omit<ToastItem, 'id'>): void => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((cur) => [...cur.slice(-(MAX_TOASTS - 1)), { ...item, id }]);
    // Bật nhạc chỉ khi thông báo thực sự hiện ra
    if (prefsRef.current.sound) playChime();
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS));
  }, [dismiss]);

  /** Nhận sự kiện SSE → hiện toast ngay bằng nội dung đính kèm trong event.data. */
  useRealtimeEvent((event) => {
    if (event.topic !== 'notification' || !prefsRef.current.toast) return;
    const data = event.data as
      | { title?: string; body?: string; level?: NotificationLevel; link?: string }
      | undefined;
    if (!data?.title) return; // sự kiện chỉ báo "có thay đổi" (modul cũ) — topbar tự invalidate
    push({
      title: data.title,
      body: data.body ?? '',
      level: data.level ?? 'INFO',
      link: data.link ?? '',
    });
  });

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  if (toasts.length === 0) return <></>;

  return (
    <div
      aria-live="polite"
      className="app-safe-bottom pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(92vw,380px)] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const style = LEVEL_STYLE[toast.level] ?? LEVEL_STYLE.INFO;
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            role="status"
            onClick={() => {
              dismiss(toast.id);
              if (toast.link) router.push(toast.link);
            }}
            className={cn(
              'notify-toast pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-lg border border-l-4 bg-[var(--card)] p-3 shadow-lg shadow-black/10',
              style.border,
            )}
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--muted)]">
              <Icon className={cn('size-4', style.iconClass)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                <BellRing className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                <span className="line-clamp-2">{toast.title}</span>
              </span>
              {toast.body ? (
                <span className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                  {toast.body}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              aria-label="Đóng thông báo"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(toast.id);
              }}
              className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
