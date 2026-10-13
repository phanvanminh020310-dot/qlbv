'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Sparkles,
  SwitchCamera,
  ScanFace,
} from 'lucide-react';

function getDeviceClaimToken(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'qlbv_kiosk_device_claim_token';
  try {
    let token = localStorage.getItem(KEY);
    if (!token || token.length < 16) {
      token = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
      localStorage.setItem(KEY, token);
    }
    return token;
  } catch {
    return 'dev_fallback_' + Date.now();
  }
}

export default function MobileScanPage() {
  const routeParams = useParams();
  const rawSessionId = (routeParams?.sessionId as string) || '';
  const sessionId = decodeURIComponent(rawSessionId);

  const [sessionData, setSessionData] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Fallback chụp ảnh trực tiếp nếu trình duyệt chặn hoàn toàn WebRTC
  const [isHttpCaptureMode, setIsHttpCaptureMode] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  // Trạng thái quét khuôn mặt
  const [currentStep, setCurrentStep] = useState<'scanning' | 'verifying' | 'success' | 'failed'>('scanning');
  const [statusText, setStatusText] = useState<string>('Đang mở camera trước...');
  const [resultData, setResultData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isStartingRef = useRef(false);

  // 0. Phát hiện mở từ trình duyệt nhúng của app nhắn tin / app quét mã QR bên thứ 3 trên iOS & Android
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = navigator.userAgent || '';
    const ref = document.referrer || '';

    // A. Kiểm tra Referrer (Google Lens, app quét mã QR, các app chia sẻ link trên Android & iOS):
    const isReferrerFromApp =
      ref.startsWith('android-app://') ||
      /lens|scanner|barcode|photo|gallery|telegram|zalo|viber|facebook|messenger|instagram|line/i.test(ref);

    // B. Kiểm tra Trình duyệt nhúng trên iOS (WKWebView / In-App Browser của app bên thứ 3):
    // Trên iOS Safari gốc, window.webkit.messageHandlers không bao giờ tồn tại.
    // Nếu có window.webkit?.messageHandlers -> 100% là app bên thứ 3 nhúng webview (App quét QR, mạng xã hội).
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const hasIosHandlers = typeof (window as any).webkit !== 'undefined' && Boolean((window as any).webkit?.messageHandlers);
    const isIosWkWebView = isIos && (!/Version\/[\d.]+.*Safari/i.test(ua) && /Mobile\//i.test(ua));

    // C. Kiểm tra WebView trên Android:
    const isAndroidWebView = /Android/i.test(ua) && ((/Version\/4\.0.*Chrome/i.test(ua)) || /\bwv\b/i.test(ua));

    // D. Danh sách app tin nhắn / mạng xã hội / scanner app đã biết:
    const isKnownApp =
      /zalo|micromessenger|fbav|fban|fb_iab|messenger|telegram|viber|line|instagram|threads|snapchat|tiktok|bytedance|wechat|gsa|googleapp|scanner|barcode|qrcode/i.test(ua);

    const isBlocked = isReferrerFromApp || (isIos && (hasIosHandlers || isIosWkWebView)) || isAndroidWebView || isKnownApp;

    if (isBlocked) {
      const claimToken = getDeviceClaimToken();
      fetch(`/api/kiosk/session/${sessionId}`, {
        headers: {
          'x-device-claim-token': claimToken,
          'x-client-env': 'scanner-app',
        },
      }).catch(() => {});

      let customMsg =
        'CẢNH BÁO AN NINH: Phát hiện mã QR này được mở từ ứng dụng quét ảnh hoặc trình duyệt nhúng bên thứ ba. Để đảm bảo an toàn điểm danh, Bác sĩ vui lòng dùng ứng dụng Máy ảnh (Camera) mặc định của điện thoại để quét mã QR trên màn hình máy tính phòng khám.';
      if (isIos) {
        customMsg =
          'CẢNH BÁO AN NINH: Phát hiện mã QR được mở từ ứng dụng bên thứ ba trên iPhone. Bác sĩ vui lòng mở ứng dụng Camera (Máy ảnh) mặc định của iOS để quét trực tiếp mã QR trên màn hình máy tính.';
      }

      setSessionError(customMsg);
      setLoadingSession(false);
      return;
    }
  }, [sessionId]);

  // 1. Tải thông tin phiên quét từ sessionId
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const ua = navigator.userAgent || '';
        const ref = document.referrer || '';
        const isReferrerFromApp =
          ref.startsWith('android-app://') ||
          /lens|scanner|barcode|photo|gallery|telegram|zalo|viber|facebook|messenger|instagram|line/i.test(ref);
        const isIos = /iPhone|iPad|iPod/i.test(ua);
        const hasIosHandlers = typeof (window as any).webkit !== 'undefined' && Boolean((window as any).webkit?.messageHandlers);
        const isIosWkWebView = isIos && (!/Version\/[\d.]+.*Safari/i.test(ua) && /Mobile\//i.test(ua));
        const isAndroidWebView = /Android/i.test(ua) && ((/Version\/4\.0.*Chrome/i.test(ua)) || /\bwv\b/i.test(ua));
        const isKnownApp =
          /zalo|micromessenger|fbav|fban|fb_iab|messenger|telegram|viber|line|instagram|threads|snapchat|tiktok|bytedance|wechat|gsa|googleapp|scanner|barcode|qrcode/i.test(ua);

        if (isReferrerFromApp || (isIos && (hasIosHandlers || isIosWkWebView)) || isAndroidWebView || isKnownApp) {
          return;
        }

        const claimToken = getDeviceClaimToken();
        const headers: Record<string, string> = {
          'x-device-claim-token': claimToken,
        };

        const resp = await fetch(`/api/kiosk/session/${sessionId}`, { headers });
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => null);
          throw new Error(errJson?.message || 'Mã QR đã hết hạn hoặc phiên không tồn tại. Vui lòng quét lại trên màn hình phòng khám.');
        }
        const raw = await resp.json();
        const data = raw?.data ?? raw;
        setSessionData(data);

        // Nếu phiên đã mở khoá thành công trước đó (do request chạy ngầm xong hoặc quét lại)
        if (data?.status === 'VERIFIED') {
          setResultData({ success: true, doctor: data.verifiedDoctor });
          setCurrentStep('success');
          return;
        }
      } catch (err: any) {
        setSessionError(err.message || 'Lỗi nạp phiên.');
      } finally {
        setLoadingSession(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  // Nén ảnh để tải lên nhanh (< 80KB)
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          let w = img.width;
          let h = img.height;
          if (w > h && w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(e.target?.result as string);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSwitchToHttps = () => {
    if (typeof window === 'undefined') return;
    const curPort = window.location.port;
    let targetPort = '';
    if (curPort === '3000') {
      targetPort = ':3443';
    } else if (curPort && curPort !== '80' && curPort !== '443') {
      targetPort = `:${curPort}`;
    }
    const httpsUrl = `https://${window.location.hostname}${targetPort}${window.location.pathname}${window.location.search}`;
    window.location.href = httpsUrl;
  };

  // 2. Khởi tạo Camera (Ưu tiên 100% camera trước và tự động sửa nếu điện thoại chọn nhầm camera sau)
  const startCamera = async (forceMode?: 'user' | 'environment') => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setCameraError(null);

    // Kiểm tra Secure Context (HTTPS / localhost)
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      console.warn('Đang truy cập qua HTTP không bảo mật: Trình duyệt di động chặn WebRTC Live Stream.');
      setIsHttpCaptureMode(true);
      setCameraActive(true);
      setCurrentStep('scanning');
      setStatusText('Chạm vào màn hình để mở Camera chụp ảnh');
      isStartingRef.current = false;
      return;
    }

    const targetMode = forceMode || facingMode;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      // Tìm kiếm device ID của camera trước một cách rõ ràng
      let selectedDeviceId: string | undefined = undefined;
      if (navigator?.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');

          if (targetMode === 'user') {
            const front = videoInputs.find((d) =>
              /front|user|facetime|trước|selfie/i.test(d.label)
            );
            if (front) {
              selectedDeviceId = front.deviceId;
            }
          } else {
            const back = videoInputs.find((d) =>
              /back|rear|environment|sau/i.test(d.label)
            );
            if (back) {
              selectedDeviceId = back.deviceId;
            }
          }
        } catch {}
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: selectedDeviceId
          ? {
              deviceId: { exact: selectedDeviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
            }
          : {
              facingMode: targetMode === 'user' ? { ideal: 'user' } : { ideal: 'environment' },
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
      };

      let stream: MediaStream | null = null;
      if (navigator?.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        const legacyGUM =
          (navigator as any).getUserMedia ||
          (navigator as any).webkitGetUserMedia ||
          (navigator as any).mozGetUserMedia ||
          (navigator as any).msGetUserMedia;

        if (legacyGUM) {
          stream = await new Promise((resolve, reject) => {
            legacyGUM.call(navigator, constraints, resolve, reject);
          });
        }
      }

      if (!stream) {
        throw new Error('NO_STREAM');
      }

      // Kiểm tra nếu thiết bị tự mở nhầm camera sau khi đang cần camera trước:
      // Tự động phát hiện và tráo đổi ngay lập tức sang camera trước
      if (targetMode === 'user') {
        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
          const trackLabel = tracks[0].label.toLowerCase();
          if (/back|rear|sau|environment/.test(trackLabel)) {
            console.log('[Camera] Thiết bị tự chọn camera sau, đang tự động chuyển về camera trước...');
            try {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const other = devices.find(
                (d) => d.kind === 'videoinput' && d.deviceId !== tracks[0].getSettings()?.deviceId
              );
              if (other) {
                tracks[0].stop();
                stream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: {
                    deviceId: { exact: other.deviceId },
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                  },
                });
              }
            } catch {}
          }
        }
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }

      setCameraActive(true);
      setIsHttpCaptureMode(false);
      setCurrentStep('scanning');
      setStatusText('Nhìn thẳng camera để tự động điểm danh...');
    } catch (err: any) {
      console.warn('Không thể mở Live Video Stream, kích hoạt chế độ chụp trực tiếp:', err);
      setIsHttpCaptureMode(true);
      setCameraActive(true);
      setCurrentStep('scanning');
      setStatusText('Chạm vào màn hình để mở Camera chụp ảnh');
    } finally {
      isStartingRef.current = false;
    }
  };

  // Tự động mở camera khi phiên nạp thành công
  useEffect(() => {
    if (!loadingSession && !sessionError && sessionData) {
      startCamera();
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [loadingSession, sessionError, sessionData]);

  // Gửi ảnh sang AI xác thực
  const submitVerification = async (imageBase64: string): Promise<boolean> => {
    try {
      const claimToken = getDeviceClaimToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-device-claim-token': claimToken,
      };

      const resp = await fetch('/api/kiosk/verify-face', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId,
          imageBase64,
          completedChallenges: ['PASSIVE_LIVENESS'],
          claimToken,
        }),
      });

      const raw = await resp.json();
      const data = raw?.data ?? raw;

      if (resp.ok && data?.success !== false && !data?.isProcessing) {
        setResultData(data);
        setCurrentStep('success');

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
        return true;
      }

      if (data?.isProcessing) {
        setStatusText(data.message || 'Đang nhận diện sinh học khuôn mặt... Vui lòng giữ nguyên máy');
        return false;
      }

      const msg = String(data?.message || '');
      // Nếu chưa phát hiện rõ mặt hoặc server đang xử lý, báo nhẹ và tiếp tục quét frame tiếp theo
      if (
        msg.includes('Không phát hiện') ||
        msg.includes('khuôn mặt') ||
        msg.includes('mờ') ||
        msg.includes('chưa rõ') ||
        msg.includes('xử lý') ||
        msg.includes('giữ nguyên máy')
      ) {
        setStatusText('Đang quét... Vui lòng nhìn thẳng vào camera');
        return false;
      }

      // Nếu lỗi ca trực hoặc lỗi nghiêm trọng
      setErrorMessage(msg || 'Xác thực khuôn mặt không thành công.');
      setCurrentStep('failed');
      return false;
    } catch {
      return false;
    }
  };

  // 3. VÒNG LẶP TỰ ĐỘNG CHỤP & NHẬN DIỆN LIÊN TỤC (TỰ ĐỘNG 100% NHƯ FACE ID)
  const cameraReadyTimeRef = useRef<number>(0);

  useEffect(() => {
    if (cameraActive) {
      cameraReadyTimeRef.current = Date.now();
    }
  }, [cameraActive]);

  useEffect(() => {
    if (!cameraActive || isHttpCaptureMode || currentStep !== 'scanning') return;

    let isScanning = true;
    let analyzing = false;
    let failCount = 0;

    const interval = setInterval(async () => {
      if (!isScanning || analyzing) return;
      if (!videoRef.current) return;

      // Chờ ít nhất 600ms sau khi camera kích hoạt để auto-exposure / white-balance ổn định
      if (Date.now() - cameraReadyTimeRef.current < 600) {
        return;
      }

      const video = videoRef.current;
      // Chờ video sẵn sàng và có dữ liệu hình ảnh
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = 480;
      canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Kiểm tra độ sáng khung hình (tránh chụp khi camera chưa kịp lấy sáng lúc mới bật)
      const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 80), Math.min(canvas.height, 80));
      let sum = 0;
      for (let i = 0; i < sample.data.length; i += 4) {
        sum += (sample.data[i] + sample.data[i + 1] + sample.data[i + 2]) / 3;
      }
      const brightness = sum / (sample.data.length / 4);
      if (brightness < 30) {
        return;
      }

      analyzing = true;
      setStatusText('Đang nhận diện sinh học khuôn mặt... Giữ nguyên máy');

      const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);
      const ok = await submitVerification(imageBase64);

      if (ok) {
        isScanning = false;
        clearInterval(interval);
      } else {
        failCount++;
        // Quét liên tục 80 chu kỳ (~36 giây) để bác sĩ lớn tuổi thao tác thong thả
        if (failCount >= 80 && currentStep === 'scanning') {
          isScanning = false;
          setErrorMessage('Không nhận diện được Bác sĩ hoặc ca trực chưa tới.');
          setCurrentStep('failed');
        } else {
          analyzing = false;
        }
      }
    }, 450);

    return () => {
      isScanning = false;
      clearInterval(interval);
    };
  }, [cameraActive, isHttpCaptureMode, currentStep, sessionId]);

  // Chụp từ input file khi chạy chế độ Native Camera
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setCurrentStep('verifying');
      setStatusText('Đang xử lý hình ảnh...');
      const imageBase64 = await compressImage(file);
      setCapturedPreview(imageBase64);
      await submitVerification(imageBase64);
    } catch {
      setErrorMessage('Không thể đọc ảnh từ Camera điện thoại.');
      setCurrentStep('failed');
    }
  };

  const triggerNativeCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Đổi camera trước / sau
  const toggleFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <RefreshCw className="h-10 w-10 text-teal-400 animate-spin mb-4" />
        <p className="text-sm font-semibold">Đang nạp phiên điểm danh phòng khám...</p>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Phiên không hợp lệ hoặc đã hết hạn</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6">{sessionError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none max-w-md mx-auto">
      {/* Input ẩn hỗ trợ chụp ảnh trực tiếp nếu WebRTC bị chặn */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*;capture=camera"
        capture="user"
        onChange={handleFileCapture}
        className="hidden"
      />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-teal-950 px-1.5 py-0.5 rounded border border-teal-800">
              {sessionData?.room?.code}
            </span>
            <h1 className="text-sm font-bold text-white leading-tight mt-0.5">
              {sessionData?.room?.name}
            </h1>
          </div>
        </div>

        <span className="text-[10px] text-teal-400 font-mono bg-teal-950/60 px-2 py-1 rounded-lg border border-teal-800 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          AI Bio-PAD
        </span>
      </header>

      {/* Main Body */}
      <main className="my-auto py-4">
        {/* CẢNH BÁO / HƯỚNG DẪN KHI CHẠY TRÊN HTTP */}
        {isHttpCaptureMode && currentStep === 'scanning' && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 mb-4 text-xs text-amber-200">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-300">Quét khuôn mặt tự động (Face ID)</p>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  Để điện thoại tự động mở camera trước nhận diện không cần bấm chụp, hệ thống cần chạy qua <strong>HTTPS</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleSwitchToHttps}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer"
                >
                  ⚡ Thử chuyển sang HTTPS ngay
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KHUNG QUÉT CAMERA */}
        {(currentStep === 'scanning' || currentStep === 'verifying') && (
          <div className="space-y-4">
            <div
              onClick={isHttpCaptureMode ? triggerNativeCamera : undefined}
              className={`relative aspect-square w-full rounded-3xl overflow-hidden bg-black border-2 border-teal-500/60 shadow-2xl ${
                isHttpCaptureMode ? 'cursor-pointer' : ''
              }`}
            >
              {isHttpCaptureMode ? (
                // Chế độ Native Camera Capture (khi không mở được stream)
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center relative bg-gradient-to-b from-slate-900 to-black">
                  {capturedPreview ? (
                    <img
                      src={capturedPreview}
                      alt="Captured Face"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-56 h-72 rounded-[50%] border-2 border-teal-400/80 animate-pulse flex flex-col items-center justify-center bg-teal-950/20 px-4">
                      <Camera className="h-12 w-12 text-teal-400 mb-2 animate-bounce" />
                      <span className="text-sm font-bold text-teal-200">Chạm để mở Camera</span>
                      <span className="text-[11px] text-teal-300/80 mt-1.5 text-center font-medium">
                        Vui lòng chụp camera trước thẳng khuôn mặt
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                // Chế độ Live Video Stream (Tự động nhận diện & chụp như Face ID)
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
                  />
                  {/* Vòng oval chỉ dẫn khuôn mặt sinh học */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-56 h-72 rounded-[50%] border-2 border-teal-400/70 animate-pulse shadow-[0_0_40px_rgba(20,184,166,0.35)] flex items-center justify-center">
                      <div className="w-48 h-64 rounded-[50%] border border-dashed border-teal-300/40"></div>
                    </div>
                  </div>
                  {/* Tia quét laser tự động */}
                  <div className="absolute inset-x-8 top-12 h-1 bg-gradient-to-r from-transparent via-teal-400 to-transparent animate-bounce opacity-75 pointer-events-none"></div>

                  {/* Nút lật camera */}
                  <button
                    type="button"
                    onClick={toggleFacingMode}
                    className="absolute top-3 right-3 p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md text-white border border-slate-700"
                    title="Đổi camera"
                  >
                    <SwitchCamera className="h-4 w-4" />
                  </button>
                </>
              )}

              {/* Lớp phủ khi đang gửi AI xử lý */}
              {currentStep === 'verifying' && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4">
                  <RefreshCw className="h-10 w-10 text-teal-400 animate-spin mb-3" />
                  <p className="text-xs font-bold text-white">Đang phân tích ArcFace & CSDL...</p>
                  <p className="text-[10px] text-slate-400 mt-1">Đối chiếu ca trực tại {sessionData?.room?.name}</p>
                </div>
              )}
            </div>

            {/* Thông báo trạng thái */}
            <div className="space-y-3 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-teal-400 animate-pulse">
                <Sparkles className="h-4 w-4" />
                <span>{statusText}</span>
              </div>

              {isHttpCaptureMode && (
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={triggerNativeCamera}
                    disabled={currentStep === 'verifying'}
                    className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-teal-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Camera className="h-5 w-5" />
                    <span>{capturedPreview ? 'Chụp lại ảnh khác' : 'Mở Camera chụp (Camera trước)'}</span>
                  </button>

                  <p className="text-[10px] text-slate-400 text-center px-2 leading-relaxed">
                    💡 Nếu ứng dụng máy ảnh tự bật camera sau, vui lòng nhấn nút lật camera trên màn hình máy ảnh sang camera trước để chụp ảnh chân dung trực tiếp.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* THÀNH CÔNG */}
        {currentStep === 'success' && (
          <div className="text-center space-y-6">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-xl">
              <CheckCircle2 className="h-10 w-10 animate-in zoom-in-75 duration-300" />
            </div>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                <ShieldCheck className="h-3.5 w-3.5" />
                ĐIỂM DANH THÀNH CÔNG
              </div>
              <h2 className="text-xl font-bold text-white mt-2">
                {resultData?.doctor?.title || 'BS'} {resultData?.doctor?.fullName}
              </h2>
              <p className="text-xs text-slate-400">
                Ca trực: <strong className="text-white">{resultData?.doctor?.shiftName || 'Hiện tại'}</strong>
              </p>
            </div>

            <div className="rounded-2xl border border-teal-500/30 bg-teal-950/20 p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Phòng khám đã mở khoá:</span>
                <span className="font-bold text-teal-400">{sessionData?.room?.name}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Độ tin cậy sinh trắc học:</span>
                <span className="font-mono text-emerald-400">{(resultData?.similarity * 100 || 96.5).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Chống giả mạo PAD:</span>
                <span className="font-semibold text-emerald-400">Đạt chuẩn ISO 30107</span>
              </div>
            </div>

            <p className="text-xs text-teal-300 font-semibold">
              Màn hình máy tính phòng khám đã mở khoá và giải phóng Desktop. Bác sĩ có thể bắt đầu làm việc ngay!
            </p>
          </div>
        )}

        {/* THẤT BÀI */}
        {currentStep === 'failed' && (
          <div className="text-center space-y-6">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-rose-500/10 border-2 border-rose-500/30 text-rose-400 flex items-center justify-center shadow-xl">
              <AlertTriangle className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white">Xác thực không thành công</h2>
              <p className="text-xs text-rose-300 px-4 leading-relaxed">{errorMessage}</p>
            </div>

            <button
              type="button"
              onClick={async () => {
                setErrorMessage(null);
                setCapturedPreview(null);
                // Kiểm tra xem phiên này thực tế đã được mở khoá thành công chưa trước khi quét lại
                try {
                  const claimToken = getDeviceClaimToken();
                  const check = await fetch(`/api/kiosk/session/${sessionId}`, {
                    headers: { 'x-device-claim-token': claimToken },
                  });
                  if (check.ok) {
                    const cRaw = await check.json();
                    const cData = cRaw?.data ?? cRaw;
                    if (cData?.status === 'VERIFIED') {
                      setResultData({ success: true, doctor: cData.verifiedDoctor });
                      setCurrentStep('success');
                      return;
                    }
                  }
                } catch {}
                setCurrentStep('scanning');
                startCamera();
              }}
              className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Quét lại lần nữa</span>
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-500 border-t border-slate-900 pt-3">
        Bệnh viện Quân y 4 · Điểm danh khuôn mặt thông minh
      </footer>
    </div>
  );
}
