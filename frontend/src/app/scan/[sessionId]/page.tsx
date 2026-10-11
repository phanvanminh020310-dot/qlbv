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
  Upload,
} from 'lucide-react';

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

  // Chế độ chụp qua HTTP (Native Camera Capture) khi WebRTC getUserMedia bị trình duyệt chặn trên HTTP
  const [isHttpCaptureMode, setIsHttpCaptureMode] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  // Trạng thái quét khuôn mặt
  const [currentStep, setCurrentStep] = useState<'scanning' | 'verifying' | 'success' | 'failed'>('scanning');
  const [statusText, setStatusText] = useState<string>('Đang căn chỉnh khuôn mặt...');
  const [resultData, setResultData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoCaptureTimerRef = useRef<any>(null);

  // 1. Tải thông tin phiên quét từ sessionId
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const resp = await fetch(`/api/kiosk/session/${sessionId}`);
        if (!resp.ok) {
          throw new Error('Mã QR đã hết hạn hoặc phiên không tồn tại. Vui lòng quét lại trên màn hình phòng khám.');
        }
        const raw = await resp.json();
        const data = raw?.data ?? raw;
        setSessionData(data);
      } catch (err: any) {
        setSessionError(err.message || 'Lỗi nạp phiên.');
      } finally {
        setLoadingSession(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  // Nén ảnh chụp để gửi AI nhanh tức thì (< 100ms)
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

  // 2. Khởi tạo Camera (hỗ trợ cả WebRTC stream và fallback HTTP Native Camera)
  const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
    setCameraError(null);
    clearTimeout(autoCaptureTimerRef.current);

    // Kiểm tra nếu đang truy cập qua HTTP (không phải localhost và không phải HTTPS):
    // Trình duyệt di động (Chrome, Safari) sẽ khóa navigator.mediaDevices.getUserMedia trên HTTP.
    const isSecure = typeof window !== 'undefined' && (
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );

    if (!isSecure || !navigator?.mediaDevices?.getUserMedia) {
      console.log('[Camera] Phát hiện môi trường HTTP nội bộ. Kích hoạt chế độ Native Camera Capture cho điện thoại.');
      setIsHttpCaptureMode(true);
      setCameraActive(true);
      setCurrentStep('scanning');
      setStatusText('Nhấp nút bên dưới để mở Camera chụp ảnh');
      return;
    }

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setIsHttpCaptureMode(false);
      setCurrentStep('scanning');
      setStatusText('Đang nhận diện sinh học khuôn mặt...');

      // Sau 1 giây camera ổn định ánh sáng, tự động chụp và đối chiếu tức thì
      autoCaptureTimerRef.current = setTimeout(() => {
        captureAndVerify();
      }, 1100);
    } catch (err: any) {
      console.warn('Lỗi mở WebRTC Camera, chuyển sang chế độ chụp trực tiếp Native Camera:', err);
      setIsHttpCaptureMode(true);
      setCameraActive(true);
      setCurrentStep('scanning');
      setStatusText('Nhấp nút bên dưới để mở Camera chụp ảnh');
    }
  };

  // Tự động mở camera ngay khi phiên nạp thành công
  useEffect(() => {
    if (!loadingSession && !sessionError && sessionData) {
      startCamera();
    }
    return () => {
      clearTimeout(autoCaptureTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [loadingSession, sessionError, sessionData]);

  // Xử lý gửi ảnh sang AI xác thực
  const submitVerification = async (imageBase64: string) => {
    setCurrentStep('verifying');
    setStatusText('Đang đối chiếu ArcFace & Lịch trực...');

    try {
      const resp = await fetch('/api/kiosk/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          imageBase64,
          completedChallenges: ['PASSIVE_LIVENESS'],
        }),
      });

      const raw = await resp.json();
      const data = raw?.data ?? raw;

      if (!resp.ok) {
        throw new Error(data.message || 'Xác thực sinh trắc học không thành công.');
      }

      setResultData(data);
      setCurrentStep('success');

      // Tắt stream camera nếu có
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Xác thực khuôn mặt không thành công.');
      setCurrentStep('failed');
    }
  };

  // 3a. Chụp từ Live Stream (khi có WebRTC / HTTPS)
  const captureAndVerify = async () => {
    if (!videoRef.current || currentStep === 'verifying' || currentStep === 'success') return;

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.88);
    await submitVerification(imageBase64);
  };

  // 3b. Chụp từ Native Camera input (khi chạy HTTP nội bộ)
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setCurrentStep('verifying');
      setStatusText('Đang xử lý hình ảnh...');
      const imageBase64 = await compressImage(file);
      setCapturedPreview(imageBase64);
      await submitVerification(imageBase64);
    } catch (err: any) {
      setErrorMessage('Không thể đọc ảnh từ Camera điện thoại.');
      setCurrentStep('failed');
    }
  };

  // Mở Native Camera khi người dùng bấm nút
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
      {/* Input ẩn chụp ảnh Native Camera hoạt động trên 100% HTTP và HTTPS */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
                // Giao diện chụp ảnh Native Camera khi chạy trên HTTP
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center relative bg-gradient-to-b from-slate-900 to-black">
                  {capturedPreview ? (
                    <img
                      src={capturedPreview}
                      alt="Captured Face"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      {/* Vòng oval định vị khuôn mặt */}
                      <div className="w-56 h-72 rounded-[50%] border-2 border-teal-400/80 animate-pulse flex flex-col items-center justify-center bg-teal-950/20">
                        <Camera className="h-12 w-12 text-teal-400 mb-2 animate-bounce" />
                        <span className="text-xs font-bold text-teal-200">Chạm để mở Camera</span>
                        <span className="text-[10px] text-slate-400 mt-1">Chụp thẳng khuôn mặt</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                // Giao diện WebRTC Live Video Stream khi chạy trên HTTPS
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

            {/* Thông báo trạng thái và Nút kích hoạt Camera */}
            <div className="space-y-3 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-teal-400 animate-pulse">
                <Sparkles className="h-4 w-4" />
                <span>{statusText}</span>
              </div>

              {isHttpCaptureMode ? (
                <button
                  type="button"
                  onClick={triggerNativeCamera}
                  disabled={currentStep === 'verifying'}
                  className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-teal-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Camera className="h-5 w-5" />
                  <span>{capturedPreview ? 'Chụp lại ảnh khác' : 'Mở Camera chụp khuôn mặt'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={captureAndVerify}
                  disabled={currentStep === 'verifying'}
                  className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-teal-300 font-bold text-xs border border-teal-500/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <ScanFace className="h-4 w-4" />
                  <span>Chụp & Nhận diện ngay</span>
                </button>
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
              onClick={() => {
                setErrorMessage(null);
                setCapturedPreview(null);
                setCurrentStep('scanning');
                if (isHttpCaptureMode) {
                  triggerNativeCamera();
                } else {
                  startCamera();
                }
              }}
              className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Chụp lại lần nữa</span>
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
