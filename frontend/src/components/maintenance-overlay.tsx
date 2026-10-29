'use client';

import { DatabaseBackup } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAINTENANCE_EVENT } from '@/lib/api';

interface MaintenanceInfo {
  active?: boolean;
  message?: string;
  startedAt?: string;
  by?: string;
}

declare global {
  interface Window {
    /** Trang đang tự thực hiện phục hồi — không tự tải lại (trang đó tự xử lý) */
    __qlbsRestoring?: boolean;
  }
}

/**
 * Lớp phủ "Hệ thống đang phục hồi dữ liệu".
 * - Hiện khi bất kỳ lời gọi API nào nhận 503 MAINTENANCE (không hỏi dò khi bình thường).
 * - Khi đang hiện: hỏi /api/system/maintenance mỗi 3 giây; xong thì tự tải lại trang
 *   để mọi màn hình đọc dữ liệu đã phục hồi.
 */
export function MaintenanceOverlay() {
  const [info, setInfo] = useState<MaintenanceInfo | null>(null);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onEvent = (e: Event) => setInfo((prev) => prev ?? ((e as CustomEvent).detail as MaintenanceInfo) ?? {});
    window.addEventListener(MAINTENANCE_EVENT, onEvent);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onEvent);
  }, []);

  useEffect(() => {
    if (!info || done) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/system/maintenance', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        const state = (payload?.data ?? payload) as MaintenanceInfo;
        if (state?.active) {
          setInfo(state);
          return;
        }
        setDone(true);
        if (!window.__qlbsRestoring) setTimeout(() => window.location.reload(), 1200);
        else setTimeout(() => setInfo(null), 300);
      } catch {
        /* máy chủ chưa phản hồi — hỏi lại lần sau */
      }
    };
    timer.current = setInterval(poll, 3000);
    void poll();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [info, done]);

  if (!info || (done && window.__qlbsRestoring)) return null;

  return (
    <div className="app-viewport-fixed app-safe-overlay fixed inset-x-0 top-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-[2px]" role="alertdialog" aria-live="assertive">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border bg-[var(--card)] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <DatabaseBackup className="size-6" />
        </div>
        <div className="text-base font-semibold">
          {done ? 'Đã phục hồi xong — đang tải lại…' : 'Hệ thống đang phục hồi dữ liệu'}
        </div>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {done
            ? 'Dữ liệu đã được cập nhật, trang sẽ tự tải lại.'
            : info.message ?? 'Thao tác tạm dừng trong ít phút. Trang sẽ tự tải lại khi xong.'}
        </p>
        {!done ? (
          <>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="size-3.5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
              Vui lòng không đóng trang
              {info.by ? ` · thực hiện bởi ${info.by}` : ''}
            </div>
            <p className="mt-3 text-[11px] text-[var(--muted-foreground)]">
              Nội dung đang nhập dở chưa được lưu. Nếu cần, hãy ghi lại ra giấy và nhập lại sau khi hệ thống mở lại.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
