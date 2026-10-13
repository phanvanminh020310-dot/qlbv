/**
 * Mô-đun khoá tính năng Kiosk & Chống can thiệp người dùng (Anti-Tamper Kiosk Lockdown)
 * Thiết kế an toàn 100%: không làm sập React hydration, bắt toàn bộ ngoại lệ trình duyệt (HTTP/HTTPS).
 */

export interface LockdownConfig {
  enabled: boolean;
  onEmergencyTrigger: () => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export class KioskLockdown {
  private config: LockdownConfig;
  private keydownHandler: (e: KeyboardEvent) => void;
  private contextMenuHandler: (e: MouseEvent) => void;
  private mouseHandler: (e: MouseEvent) => void;
  private dragStartHandler: (e: DragEvent) => void;
  private dragOverHandler: (e: DragEvent) => void;
  private dropHandler: (e: DragEvent) => void;
  private selectStartHandler: (e: Event) => void;
  private wheelHandler: (e: WheelEvent) => void;
  private beforeUnloadHandler: (e: BeforeUnloadEvent) => void;
  private blurHandler: () => void;
  private visibilityHandler: () => void;
  private fullscreenHandler: () => void;
  private popstateHandler: () => void;
  private wakeLockSentinel: any = null;
  private isActive: boolean = false;

  constructor(config: LockdownConfig) {
    this.config = config;

    // 1. CHẶN BÀN PHÍM TOÀN DIỆN (CHẶN 100% MỌI PHÍM KHI ĐANG KHOÁ KIOSK)
    this.keydownHandler = (e: KeyboardEvent) => {
      // Phím nóng thoát hiểm DUY NHẤT dành cho Kỹ thuật viên IT: Ctrl + Shift + Alt + F12 (hoặc Ctrl + Shift + Alt + M)
      if (
        (e.ctrlKey && e.shiftKey && e.altKey && (e.key === 'F12' || e.code === 'F12' || e.key === 'm' || e.key === 'M')) ||
        (e.ctrlKey && e.shiftKey && e.altKey && e.key === 'Escape')
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.config.onEmergencyTrigger();
        return;
      }

      if (!this.config.enabled) return;

      // Nếu đang gõ trong hộp thoại nhập PIN của IT (modal/dialog) thì cho phép
      const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
      const isInsideModal = activeEl && activeEl.closest('[role="dialog"], form, .fixed');
      if (isInsideModal && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        // Cho phép gõ số/chữ/backspace/enter trong hộp thoại PIN IT
        return;
      }

      // CHẶN 100% TẤT CẢ CÁC PHÍM KHÁC!
      // Tuyệt đối không cho phép bất kỳ phím nào lọt qua (F12, Win, Alt, Ctrl, Tab, Esc, Space, D, R, E...)
      e.preventDefault();
      e.stopPropagation();
    };

    // 2. CHẶN CHUỘT PHẢI (Context Menu) TRÊN MÀN HÌNH CHÍNH (VẪN CHO PHÉP NẾU GIỮ PHÍM SHIFT CHO IT)
    this.contextMenuHandler = (e: MouseEvent) => {
      if (this.config.enabled && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    // 3. CHẶN CÁC NÚT PHỤ TRÊN CHUỘT
    this.mouseHandler = (e: MouseEvent) => {
      if (this.config.enabled) {
        if (e.button === 1 || e.button === 3 || e.button === 4) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    // 4. CHẶN KÉO THẢ TỆP VÀO TRÌNH DUYỆT
    this.dragStartHandler = (e: DragEvent) => {
      if (this.config.enabled) e.preventDefault();
    };
    this.dragOverHandler = (e: DragEvent) => {
      if (this.config.enabled) e.preventDefault();
    };
    this.dropHandler = (e: DragEvent) => {
      if (this.config.enabled) e.preventDefault();
    };

    // 5. CHẶN BÔI ĐEN CHỌN VĂN BẢN TRÊN MÀN HÌNH CHÍNH
    this.selectStartHandler = (e: Event) => {
      if (this.config.enabled) {
        const target = e.target as HTMLElement;
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) {
          e.preventDefault();
        }
      }
    };

    // 6. CHẶN THAO TÁC ZOOM BẰNG CHUỘT (Ctrl + Con lăn cuộn)
    this.wheelHandler = (e: WheelEvent) => {
      if (this.config.enabled && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
    };

    // 7. BẪY LỊCH SỬ DUYỆT WEB
    this.popstateHandler = () => {
      if (this.config.enabled && typeof window !== 'undefined') {
        try {
          window.history.pushState(null, '', window.location.href);
        } catch {}
      }
    };

    // 8. CHẶN ĐÓNG HOẶC TẢI LẠI TRANG
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
      }
    };

    // 9. TỰ ĐỘNG THU HỒI TIÊU ĐIỂM
    this.blurHandler = () => {
      if (this.config.enabled && typeof window !== 'undefined') {
        setTimeout(() => {
          try {
            if (typeof document !== 'undefined' && !document.hidden) {
              window.focus();
            }
          } catch {}
        }, 150);
      }
    };

    // 10. GIÁM SÁT ẨN HIỆN
    this.visibilityHandler = () => {
      if (this.config.enabled && typeof document !== 'undefined') {
        if (!document.hidden) {
          this.requestWakeLock().catch(() => {});
          try {
            window.focus();
          } catch {}
        }
      }
    };

    // 11. GIÁM SÁT CHẾ ĐỘ TOÀN MÀN HÌNH
    this.fullscreenHandler = () => {
      if (typeof document === 'undefined') return;
      const isFull = !!document.fullscreenElement;
      if (isFull) {
        KioskLockdown.lockSystemKeyboard().catch(() => {});
      }
      if (this.config.onFullscreenChange) {
        try {
          this.config.onFullscreenChange(isFull);
        } catch {}
      }
    };
  }

  public activate() {
    if (this.isActive || typeof window === 'undefined') return;
    this.isActive = true;

    try {
      window.history.pushState(null, '', window.location.href);
      window.addEventListener('popstate', this.popstateHandler);
    } catch {}

    window.addEventListener('keydown', this.keydownHandler, { capture: true });
    window.addEventListener('contextmenu', this.contextMenuHandler, { capture: true });
    window.addEventListener('mousedown', this.mouseHandler, { capture: true });
    window.addEventListener('mouseup', this.mouseHandler, { capture: true });
    window.addEventListener('auxclick', this.mouseHandler, { capture: true });
    window.addEventListener('dragstart', this.dragStartHandler, { capture: true });
    window.addEventListener('dragover', this.dragOverHandler, { capture: true });
    window.addEventListener('drop', this.dropHandler, { capture: true });
    window.addEventListener('wheel', this.wheelHandler, { passive: false });
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('blur', this.blurHandler);

    if (typeof document !== 'undefined') {
      document.addEventListener('selectstart', this.selectStartHandler, { capture: true });
      document.addEventListener('visibilitychange', this.visibilityHandler);
      document.addEventListener('fullscreenchange', this.fullscreenHandler);
    }

    this.requestWakeLock().catch(() => {});
  }

  public deactivate() {
    if (!this.isActive || typeof window === 'undefined') return;
    this.isActive = false;

    try {
      window.removeEventListener('popstate', this.popstateHandler);
    } catch {}

    window.removeEventListener('keydown', this.keydownHandler, { capture: true });
    window.removeEventListener('contextmenu', this.contextMenuHandler, { capture: true });
    window.removeEventListener('mousedown', this.mouseHandler, { capture: true });
    window.removeEventListener('mouseup', this.mouseHandler, { capture: true });
    window.removeEventListener('auxclick', this.mouseHandler, { capture: true });
    window.removeEventListener('dragstart', this.dragStartHandler, { capture: true });
    window.removeEventListener('dragover', this.dragOverHandler, { capture: true });
    window.removeEventListener('drop', this.dropHandler, { capture: true });
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    window.removeEventListener('blur', this.blurHandler);

    if (typeof document !== 'undefined') {
      document.removeEventListener('selectstart', this.selectStartHandler, { capture: true });
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    }

    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release?.().catch(() => {});
      } catch {}
      this.wakeLockSentinel = null;
    }

    KioskLockdown.unlockSystemKeyboard();
  }

  private async requestWakeLock() {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      }
    } catch {}
  }

  public static async lockSystemKeyboard(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'keyboard' in navigator && (navigator as any).keyboard?.lock) {
        // Khoá 100% bàn phím ở cấp trình duyệt Chromium (không truyền danh sách để khoá ALL keys)
        await (navigator as any).keyboard.lock();
      }
    } catch {}
  }

  public static unlockSystemKeyboard(): void {
    try {
      if (typeof navigator !== 'undefined' && 'keyboard' in navigator && (navigator as any).keyboard?.unlock) {
        (navigator as any).keyboard.unlock();
      }
    } catch {}
  }

  public static async enterFullscreen(): Promise<boolean> {
    try {
      if (typeof document !== 'undefined' && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        await KioskLockdown.lockSystemKeyboard();
        return true;
      }
      return true;
    } catch {
      return false;
    }
  }

  public static async exitFullscreen(): Promise<boolean> {
    try {
      KioskLockdown.unlockSystemKeyboard();
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        await document.exitFullscreen();
        return true;
      }
      return true;
    } catch {
      return false;
    }
  }
}
