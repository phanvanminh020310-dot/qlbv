'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Shield,
  ShieldCheck,
  Clock,
  Stethoscope,
  Lock,
  CheckCircle2,
  Minimize2,
  RefreshCw,
  Sun,
  Moon,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import QRCode from 'qrcode';
import { KioskLockdown } from '@/lib/kiosk-lockdown';

export default function KioskPage() {
  const routeParams = useParams();
  const rawRoomCode = (routeParams?.roomCode as string) || 'PK01';
  const roomCode = decodeURIComponent(rawRoomCode).toUpperCase();

  const [roomInfo, setRoomInfo] = useState<{ code: string; name: string }>({
    code: roomCode,
    name: `Phòng khám số ${roomCode.replace(/^[^\d]*/, '') || roomCode}`,
  });
  const [scheduledDuty, setScheduledDuty] = useState<any>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [handshakePin, setHandshakePin] = useState<string>('');
  const [terminalId, setTerminalId] = useState<string>('');
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(15);
  const totalExpiresRef = useRef<number>(15);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isITModalOpen, setIsITModalOpen] = useState(false);
  const [itPinInput, setItPinInput] = useState('');
  const [itError, setItError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [shiftEndMs, setShiftEndMs] = useState<number | null>(null);

  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const secretClickCountRef = useRef(0);
  const secretClickTimeoutRef = useRef<any>(null);

  // 0. Khởi tạo mã định danh duy nhất của máy trạm này (Terminal ID)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const queryTid = urlParams.get('terminalId');
    const key = `kiosk_term_${roomCode}`;
    let tid = queryTid || sessionStorage.getItem(key);
    if (!tid) {
      tid = `term_${roomCode}_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
    }
    sessionStorage.setItem(key, tid);
    setTerminalId(tid);
  }, [roomCode]);

  // 1. Đồng hồ thời gian thực đồng bộ máy chủ bệnh viện (Chống người dùng chỉnh sửa giờ máy phòng khám)
  const serverBaseTimeRef = useRef<number>(Date.now());
  const perfBaseTimeRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const syncServerTime = (serverTimeMs?: number) => {
    if (serverTimeMs && typeof serverTimeMs === 'number') {
      serverBaseTimeRef.current = serverTimeMs;
      perfBaseTimeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    }
  };

  useEffect(() => {
    // Lấy giờ máy chủ chuẩn ban đầu
    fetch('/api/kiosk/time')
      .then((res) => res.json())
      .then((raw) => {
        const data = raw?.data ?? raw;
        if (data?.serverTime) {
          syncServerTime(data.serverTime);
        }
      })
      .catch(() => {});

    const updateTime = () => {
      try {
        const elapsed = typeof performance !== 'undefined' ? performance.now() - perfBaseTimeRef.current : 0;
        const now = new Date(serverBaseTimeRef.current + elapsed);
        const timeStr = now.toLocaleTimeString('vi-VN', {
          timeZone: 'Asia/Bangkok',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const dateStr = now.toLocaleDateString('vi-VN', {
          timeZone: 'Asia/Bangkok',
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        setCurrentTime(`${timeStr} · ${dateStr}`);
      } catch {}
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Tải trạng thái phòng và tạo/lấy phiên QR gắn với đúng máy trạm này
  const fetchKioskStatus = async (curTid?: string) => {
    if (!roomCode) return;
    const tid = curTid || terminalId;
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const query = new URLSearchParams({ room: roomCode });
      if (tid) query.set('terminalId', tid);
      if (origin) query.set('clientOrigin', origin);

      const resp = await fetch(`/api/kiosk/status?${query.toString()}`);
      if (!resp.ok) {
        // Dự phòng phiên QR cục bộ nếu API trả lỗi
        const fallbackUrl = `${origin}/scan/${roomCode}_${Date.now()}`;
        setQrUrl((prev) => prev || fallbackUrl);
        return;
      }
      const raw = await resp.json();
      // Bóc lớp { success: true, data: { ... } } do TransformInterceptor của NestJS tạo ra
      const data = raw?.data ?? raw;

      if (data?.serverTime) {
        syncServerTime(data.serverTime);
      }
      if (data?.room) {
        setRoomInfo(data.room);
      }
      if (data?.currentScheduled !== undefined) {
        setScheduledDuty(data.currentScheduled);
      }

      if (data?.isUnlocked) {
        setIsUnlocked(true);
        if (data.activeDoctor) setActiveSession(data.activeDoctor);
        if (data.shiftEndMs) setShiftEndMs(data.shiftEndMs);
        return;
      } else {
        setIsUnlocked(false);
        setActiveSession(null);
        setShiftEndMs(null);
      }

      if (data?.qrSession?.totalExpiresSeconds) {
        totalExpiresRef.current = data.qrSession.totalExpiresSeconds;
      }

      const backendQrUrl = data?.qrSession?.qrUrl;
      const scanUrl =
        backendQrUrl && !backendQrUrl.includes('localhost') && !backendQrUrl.includes('api:4000')
          ? backendQrUrl
          : `${origin}/scan/${data?.qrSession?.sessionId || ''}`;

      if (data?.qrSession?.sessionId || backendQrUrl) {
        setQrUrl(scanUrl);
        setExpiresInSeconds(data?.qrSession?.expiresInSeconds ?? totalExpiresRef.current);
      }
    } catch (err: any) {
      console.warn('Lỗi nạp trạng thái Kiosk:', err?.message || err);
      if (typeof window !== 'undefined') {
        const fallbackUrl = `${window.location.origin}/scan/${roomCode}_fallback`;
        setQrUrl((prev) => prev || fallbackUrl);
      }
    }
  };

  // 3. Làm mới mã QR gắn với đúng máy trạm này
  const refreshQrSession = async () => {
    setIsRefreshing(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const resp = await fetch('/api/kiosk/session/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, roomName: roomInfo.name, terminalId, clientOrigin: origin }),
      });
      if (resp.ok) {
        const raw = await resp.json();
        const data = raw?.data ?? raw;
        if (data?.serverTime) {
          syncServerTime(data.serverTime);
        }
        if (data?.totalExpiresSeconds) {
          totalExpiresRef.current = data.totalExpiresSeconds;
        }
        const backendQr = data?.qrUrl;
        const scanUrl =
          backendQr && !backendQr.includes('localhost') && !backendQr.includes('api:4000')
            ? backendQr
            : `${origin}/scan/${data?.sessionId || ''}`;

        if (data?.sessionId || backendQr) {
          setQrUrl(scanUrl);
          setExpiresInSeconds(data?.expiresInSeconds ?? totalExpiresRef.current);
        }
      }
    } catch (err) {
      console.warn('Lỗi làm mới QR:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 4. Vẽ mã QR lên Canvas
  useEffect(() => {
    if (qrUrl && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, qrUrl, {
        width: 240,
        margin: 2,
        color: {
          dark: '#0f766e',
          light: '#ffffff',
        },
      }).catch((err) => {
        console.warn('Không thể vẽ QR canvas:', err);
      });
    }
  }, [qrUrl]);

  // 5. Đếm lùi thời gian sống mã QR
  useEffect(() => {
    if (isUnlocked) return;
    const timer = setInterval(() => {
      setExpiresInSeconds((prev) => {
        if (prev <= 1) {
          refreshQrSession();
          return totalExpiresRef.current;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [roomInfo.name, isUnlocked, roomCode, terminalId]);

  // 6. Lắng nghe sự kiện mở khoá Server-Sent Events (SSE) thời gian thực đích danh máy trạm
  useEffect(() => {
    if (!roomCode || !terminalId) return;
    fetchKioskStatus(terminalId);

    let eventSource: EventSource | null = null;
    try {
      const sseUrl = `/api/kiosk/events/${encodeURIComponent(roomCode)}?terminalId=${encodeURIComponent(terminalId)}`;
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener('UNLOCK_EVENT', (e: any) => {
        try {
          const payload = JSON.parse(e.data);
          // Kiểm tra đích danh: Chỉ mở khoá nếu sự kiện gửi đích danh cho máy trạm này
          if (payload.terminalId && payload.terminalId !== terminalId) {
            return;
          }
          if (payload.type === 'UNLOCK_SUCCESS') {
            setIsUnlocked(true);
            setActiveSession(payload.doctor);
            if (payload.shiftEndMs) setShiftEndMs(payload.shiftEndMs);
            KioskLockdown.exitFullscreen().catch(() => {});
          }
        } catch (err) {
          console.warn('Lỗi xử lý sự kiện SSE:', err);
        }
      });

      eventSource.addEventListener('LOCK_EVENT', () => {
        setIsUnlocked(false);
        setActiveSession(null);
        setShiftEndMs(null);
        KioskLockdown.enterFullscreen().catch(() => {});
        fetchKioskStatus(terminalId);
      });

      eventSource.onerror = () => {
        // SSE tự động kết nối lại khi có gián đoạn mạng
      };
    } catch (err) {
      console.warn('Không thể khởi tạo EventSource SSE:', err);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [roomCode, terminalId]);

  // 6b. Tự động khoá máy khi qua ca người khác và quá thời gian ân hạn
  useEffect(() => {
    if (!isUnlocked || !shiftEndMs) return;

    const timer = setInterval(() => {
      const now = Date.now();
      if (now >= shiftEndMs) {
        console.log('[Kiosk] Ca trực đã kết thúc và quá thời gian ân hạn. Tự động khoá máy cho ca tiếp theo...');
        setIsUnlocked(false);
        setActiveSession(null);
        setShiftEndMs(null);
        KioskLockdown.enterFullscreen().catch(() => {});
        fetchKioskStatus(terminalId);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [isUnlocked, shiftEndMs, terminalId]);

  // 7. Khoá tính năng Kiosk chống can thiệp (Anti-Tamper Lockdown)
  useEffect(() => {
    if (isUnlocked) return;

    let lockdown: KioskLockdown | null = null;
    try {
      lockdown = new KioskLockdown({
        enabled: true,
        onEmergencyTrigger: () => {
          setIsITModalOpen(true);
        },
        onFullscreenChange: (isFull) => {
          setShowExitWarning(!isFull);
        },
      });
      lockdown.activate();
    } catch (err) {
      console.warn('Không thể khởi động KioskLockdown:', err);
    }

    return () => {
      if (lockdown) lockdown.deactivate();
    };
  }, [isUnlocked]);

  // Nhấp 5 lần bí mật vào logo để mở bảng IT
  const handleLogoSecretClick = () => {
    clearTimeout(secretClickTimeoutRef.current);
    secretClickCountRef.current += 1;
    if (secretClickCountRef.current >= 5) {
      setIsITModalOpen(true);
      secretClickCountRef.current = 0;
    } else {
      secretClickTimeoutRef.current = setTimeout(() => {
        secretClickCountRef.current = 0;
      }, 2000);
    }
  };

  const handleITOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setItError(null);
    try {
      const resp = await fetch('/api/kiosk/override-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, pin: itPinInput, terminalId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Mã PIN khẩn cấp không đúng.');
      }
      setIsITModalOpen(false);
      setItPinInput('');
    } catch (err: any) {
      setItError(err.message || 'Lỗi mở khoá IT.');
    }
  };

  const handleLockRoom = async () => {
    try {
      await fetch('/api/kiosk/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode }),
      });
      // Gửi tín hiệu khoá lại đến Agent C# cục bộ
      fetch('http://127.0.0.1:28199/api/lock', { method: 'POST', mode: 'no-cors' }).catch(() => {});
      fetch('http://localhost:28199/api/lock', { method: 'POST', mode: 'no-cors' }).catch(() => {});
      setLockConfirmOpen(false);
      setIsUnlocked(false);
      setActiveSession(null);
      KioskLockdown.enterFullscreen().catch(() => {});
      fetchKioskStatus();
    } catch (e) {
      console.warn('Lỗi khoá phòng:', e);
    }
  };

  const handleExitToDesktop = () => {
    try {
      // 1. Gửi tín hiệu cưỡng chế tắt Edge ngay đến Agent C# cục bộ
      fetch('http://127.0.0.1:28199/api/unlock', { method: 'POST', mode: 'no-cors' }).catch(() => {});
      fetch('http://localhost:28199/api/unlock', { method: 'POST', mode: 'no-cors' }).catch(() => {});

      // 2. Thử đóng cửa sổ theo chuẩn Chromium
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      window.open('', '_self', '');
      window.close();
    } catch {}
  };

  // Tự động đóng cửa sổ trình duyệt và giải phóng Desktop ngay khi mở khoá thành công
  useEffect(() => {
    if (isUnlocked) {
      // Bắn tín hiệu đến Agent C# cục bộ để taskkill Edge trong < 0.05 giây
      const notifyAgent = async () => {
        try {
          await fetch('http://127.0.0.1:28199/api/unlock', { method: 'POST', mode: 'no-cors' });
        } catch {}
        try {
          await fetch('http://localhost:28199/api/unlock', { method: 'POST', mode: 'no-cors' });
        } catch {}
      };
      notifyAgent();

      try {
        if (typeof document !== 'undefined' && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        window.open('', '_self', '');
        window.close();
      } catch {}
    }
  }, [isUnlocked]);

  // --- TRẠNG THÁI 1: ĐÃ MỞ KHOÁ (GIẢI PHÓNG TOÀN DIỆN MÀN HÌNH DESKTOP) ---
  // Tuyệt đối không để màn hình trắng hoặc thanh nổi chắn màn hình.
  // Nếu Edge chưa bị tắt ngay bởi Agent, hiển thị màn hình thông báo sẫm màu rõ ràng kèm nút đóng trình duyệt trực tiếp.
  if (isUnlocked) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white p-6 text-center select-none animate-in fade-in duration-300">
        <div className="max-w-md w-full space-y-6">
          <div className="size-20 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500/60 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="size-10" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
              <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
              ĐÃ ĐIỂM DANH & MỞ KHOÁ THÀNH CÔNG
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">
              {activeSession?.title ? `${activeSession.title} ` : 'BS '}
              {activeSession?.fullName || 'Bác sĩ trực'}
            </h2>
            <p className="text-sm text-slate-300">
              Phòng làm việc: <strong className="text-teal-400">{roomInfo.name}</strong> ({roomInfo.code})
            </p>
            <p className="text-xs text-slate-400 pt-1 leading-relaxed">
              Kiosk Agent đang giải phóng màn hình. Bác sĩ có thể bấm nút bên dưới hoặc nhấn <strong>Alt + F4</strong> để vào Desktop làm việc ngay:
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleExitToDesktop}
              className="w-full py-3.5 px-6 rounded-2xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-sm shadow-xl shadow-teal-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Vào Desktop làm việc ngay (Đóng Kiosk)</span>
            </button>

            <button
              type="button"
              onClick={handleLockRoom}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="size-3.5 text-rose-400" />
              <span>Khoá lại máy trạm</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- TRẠNG THÁI 2: ĐANG KHOÁ (PHỦ TOÀN MÀN HÌNH BẢO VỆ MÁY TRẠM) ---
  return (
    <div
      className={`relative min-h-screen w-screen flex flex-col justify-between overflow-hidden select-none transition-colors duration-300 ${
        isDarkMode
          ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-teal-950/40 text-slate-100'
          : 'bg-gradient-to-b from-slate-100 via-white to-teal-50 text-slate-900'
      }`}
    >
      {/* Cảnh báo khi người dùng thoát toàn màn hình */}
      {showExitWarning && (
        <div
          onClick={() => KioskLockdown.enterFullscreen()}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl p-6 text-center cursor-pointer"
        >
          <div className="h-20 w-20 rounded-3xl bg-amber-500/10 border-2 border-amber-500/40 text-amber-400 flex items-center justify-center mb-4">
            <Shield className="h-10 w-10 animate-pulse" />
          </div>
          <h2 className="text-xl font-black text-white">MÁY TRẠM YÊU CẦU TOÀN MÀN HÌNH</h2>
          <p className="mt-2 text-xs text-slate-400 max-w-sm">
            Nhấp chuột vào bất kỳ đâu để khôi phục chế độ toàn màn hình bảo vệ phòng khám.
          </p>
          <button
            type="button"
            className="mt-6 px-6 py-2.5 rounded-xl bg-teal-600 text-white font-bold text-xs"
          >
            Khôi phục toàn màn hình
          </button>
        </div>
      )}

      {/* Header đỉnh máy trạm */}
      <header
        className={`px-6 sm:px-8 py-4 sm:py-5 flex items-center justify-between border-b backdrop-blur-md ${
          isDarkMode ? 'border-slate-800/80 bg-slate-950/60' : 'border-slate-200 bg-white/80 shadow-sm'
        }`}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={handleLogoSecretClick}
            className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-md cursor-pointer shrink-0"
            title="Nhấp 5 lần để mở hỗ trợ IT"
          >
            <Shield className="h-7 w-7 sm:h-8 sm:w-8" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/80 px-2 py-0.5 rounded border border-teal-200 dark:border-teal-800">
                QLBV · HỆ THỐNG PHÒNG KHÁM
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight mt-0.5">
              {roomInfo.name} <span className="text-teal-600 dark:text-teal-400 font-mono">[{roomInfo.code}]</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div className="text-right hidden md:block">
            <div className="flex items-center gap-1.5 text-xs font-semibold opacity-70 justify-end">
              <Clock className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>GIỜ HỆ THỐNG</span>
            </div>
            <div className="text-base sm:text-lg font-bold font-mono mt-0.5">{currentTime}</div>
          </div>

          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 cursor-pointer"
            title="Chuyển chế độ Sáng / Tối"
          >
            {isDarkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-teal-600" />}
          </button>

          <button
            type="button"
            onClick={() => setIsITModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-3 py-2 rounded-xl cursor-pointer"
            title="Hỗ trợ IT (Ctrl + Shift + Alt + F12)"
          >
            <Lock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kỹ thuật IT</span>
          </button>
        </div>
      </header>

      {/* Khối chính: Mã QR & Thông tin ca trực */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 items-center">
          {/* Cột trái: Thông tin ca trực & hướng dẫn */}
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-bold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              MÀN HÌNH ĐANG KHOÁ — CHỜ BÁC SĨ ĐIỂM DANH
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black leading-tight">
                Quét mã QR bằng Camera điện thoại để mở khoá ca làm việc
              </h2>
              <p className="mt-2 text-xs sm:text-sm opacity-75 leading-relaxed">
                Hệ thống xác thực khuôn mặt và tự động đối soát với bảng phân công ca trực của bệnh viện.
              </p>
            </div>

            {/* Thông tin Bác sĩ được xếp trực từ PostgreSQL CSDL QLBV */}
            <div
              className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${
                isDarkMode ? 'border-teal-500/20 bg-teal-950/20' : 'border-teal-200 bg-teal-50/60 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between border-b border-teal-500/20 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                  <Stethoscope className="h-4 w-4" />
                  PHÂN CÔNG CA TRỰC HIỆN TẠI
                </span>
                <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full font-bold ${
                  scheduledDuty ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300'
                }`}>
                  {scheduledDuty?.shiftName || 'Ngoài ca trực'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs opacity-70 block">Bác sĩ khám chính:</span>
                  <span className={`font-bold text-sm sm:text-base ${
                    scheduledDuty ? 'text-teal-400' : 'text-slate-400'
                  }`}>
                    {scheduledDuty?.fullName
                      ? `${scheduledDuty.title ? `${scheduledDuty.title} ` : ''}${scheduledDuty.fullName}`
                      : 'Không có ca trực hoạt động'}
                  </span>
                </div>
                <div>
                  <span className="text-xs opacity-70 block">Khung giờ trực:</span>
                  <span className={`font-semibold font-mono ${
                    scheduledDuty ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400'
                  }`}>
                    {scheduledDuty?.startTime && scheduledDuty?.endTime
                      ? `${scheduledDuty.startTime} – ${scheduledDuty.endTime}`
                      : 'Đã hết giờ làm việc'}
                  </span>
                </div>
              </div>
            </div>

            {/* 3 Bước hướng dẫn với mũi tên điều hướng */}
            <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 pt-1">
              {/* Bước 1 */}
              <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  1
                </div>
                <p className="text-xs font-bold leading-tight">Quét mã QR</p>
                <p className="text-[10px] opacity-70 mt-0.5">Camera điện thoại</p>
              </div>

              {/* Mũi tên 1 -> 2 */}
              <div className="text-teal-500/70 dark:text-teal-400/70 shrink-0">
                <ArrowRight className="h-4 w-4" />
              </div>

              {/* Bước 2 */}
              <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  2
                </div>
                <p className="text-xs font-bold leading-tight">Nhìn thẳng camera điện thoại để xác thực</p>
                <p className="text-[10px] opacity-70 mt-0.5">Xác thực tự động</p>
              </div>

              {/* Mũi tên 2 -> 3 */}
              <div className="text-teal-500/70 dark:text-teal-400/70 shrink-0">
                <ArrowRight className="h-4 w-4" />
              </div>

              {/* Bước 3 */}
              <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  3
                </div>
                <p className="text-xs font-bold leading-tight">Mở khóa màn hình thành công</p>
                <p className="text-[10px] opacity-70 mt-0.5">Vào màn hình Desktop</p>
              </div>
            </div>
          </div>

          {/* Cột phải: Mã QR động */}
          <div className="flex flex-col items-center justify-center">
            <div className="relative p-4 sm:p-5 rounded-3xl bg-white shadow-2xl border-4 border-teal-500/30 flex items-center justify-center min-w-[260px] min-h-[260px]">
              <canvas ref={qrCanvasRef} className={!qrUrl ? 'hidden' : 'block'} />
              {!qrUrl && (
                <div className="flex flex-col items-center justify-center p-6 text-slate-400 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-600 mb-2" />
                  <span className="text-xs font-medium">Đang tạo mã QR bảo mật...</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3 text-xs opacity-75">
              <span>Hết hạn sau: <strong className="font-mono text-teal-600 dark:text-teal-400">{expiresInSeconds}s</strong></span>
              <button
                type="button"
                onClick={refreshQrSession}
                disabled={isRefreshing}
                className="flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Đổi mã mới</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer đáy màn hình */}
      <footer
        className={`px-6 sm:px-8 py-3.5 border-t text-xs flex items-center justify-center text-center font-bold tracking-wider uppercase opacity-85 ${
          isDarkMode ? 'border-slate-800/80 bg-slate-950/80 text-slate-300' : 'border-slate-200 bg-white/80 text-slate-700'
        }`}
      >
        <span>Bệnh viện quân y 4</span>
      </footer>

      {/* Hộp thoại mở khoá IT khẩn cấp */}
      {isITModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <form
            onSubmit={handleITOverride}
            className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Shield className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-bold">Mở khoá Khẩn cấp dành cho IT</h3>
            </div>
            <p className="text-xs text-slate-400">Nhập mã PIN Quản trị viên để mở khoá trực tiếp máy trạm.</p>
            {itError && <p className="text-xs text-rose-400">{itError}</p>}
            <input
              type="password"
              required
              autoFocus
              placeholder="Nhập mã PIN IT"
              value={itPinInput}
              onChange={(e) => setItPinInput(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg tracking-widest font-mono text-white focus:outline-none focus:border-teal-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsITModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-700 text-xs text-slate-300 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-xs font-bold text-white cursor-pointer"
              >
                Mở khoá
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
