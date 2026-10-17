'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Camera, CheckCircle2, RefreshCw, Upload, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

interface BiometricEnrollDialogProps {
  user: {
    id: number;
    username: string;
    fullName: string;
    title?: string | null;
  } | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BiometricEnrollDialog({ user, open, onClose, onSuccess }: BiometricEnrollDialogProps) {
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Trạng thái đã đăng ký
  const [statusLoading, setStatusLoading] = useState(false);
  const [bioStatus, setBioStatus] = useState<{
    enrolled: boolean;
    avatarUrl: string | null;
    canSelfEnroll?: boolean;
    canSelfUpdate?: boolean;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraAttemptRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 1. Nạp trạng thái đăng ký hiện tại của nhân viên
  useEffect(() => {
    if (!open || !user) return;
    setCapturedImage(null);
    setCameraError(null);

    const fetchStatus = async () => {
      setStatusLoading(true);
      try {
        const data = await apiFetch<{
          enrolled: boolean;
          avatarUrl: string | null;
          canSelfEnroll?: boolean;
          canSelfUpdate?: boolean;
        }>(`/kiosk/biometrics/status/${user.id}`);
        setBioStatus(data);
      } catch (err) {
        console.warn('Lỗi nạp trạng thái sinh trắc học:', err);
      } finally {
        setStatusLoading(false);
      }
    };

    fetchStatus();
  }, [open, user]);

  // 2. Mở camera từ thao tác bấm trực tiếp. Safari trên iPhone có thể từ chối
  // lời gọi getUserMedia phát sinh tự động khi dialog vừa xuất hiện, nên không
  // được gọi trong useEffect. Người dùng chủ động bấm mới nhận được hộp thoại cấp quyền.
  const stopWebcam = () => {
    cameraAttemptRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setCameraStarting(false);
  };

  const cameraErrorText = (err: unknown) => {
    if (!window.isSecureContext) {
      return 'Camera chỉ hoạt động trên kết nối HTTPS an toàn. Hãy mở lại QLBS bằng địa chỉ https:// của bệnh viện.';
    }
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Quyền Camera đã bị từ chối. Trên iPhone: vào Cài đặt > Safari > Camera, chọn Cho phép rồi bấm thử lại.';
    }
    if (name === 'NotFoundError') return 'Không tìm thấy camera trên thiết bị này.';
    if (name === 'NotReadableError') return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.';
    return 'Không thể mở Camera. Hãy kiểm tra quyền Camera và kết nối HTTPS, sau đó thử lại.';
  };

  const startWebcam = async () => {
    stopWebcam();
    const attempt = ++cameraAttemptRef.current;
    setCameraError(null);
    setCapturedImage(null);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(cameraErrorText(null));
      return;
    }

    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: 'user' },
        },
        audio: false,
      });
      // Dialog có thể đã đóng hoặc người dùng đã đổi sang tải ảnh trong lúc
      // Safari đang chờ cấp quyền: không giữ camera ngầm sau thao tác đó.
      if (attempt !== cameraAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('VIDEO_ELEMENT_UNAVAILABLE');
      }
      streamRef.current = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      if (attempt !== cameraAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraActive(true);
    } catch (err) {
      console.warn('Lỗi mở camera:', err);
      if (attempt === cameraAttemptRef.current) setCameraError(cameraErrorText(err));
      stopWebcam();
    } finally {
      if (attempt === cameraAttemptRef.current) setCameraStarting(false);
    }
  };

  // Chỉ dọn stream khi đóng dialog/đổi cách lấy ảnh/đã chụp. Không tự khởi động
  // camera ở đây để giữ thao tác cấp quyền tương thích iPhone Safari.
  useEffect(() => {
    if (!open || mode !== 'camera' || capturedImage) stopWebcam();
  }, [open, mode, capturedImage]);

  // Rời hẳn trang khi dialog đang mở cũng phải trả camera về hệ điều hành.
  useEffect(() => () => {
    cameraAttemptRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // 3. Chụp ảnh từ video stream
  const handleCapture = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.90);
    setCapturedImage(b64);
    stopWebcam();
  };

  // 4. Chọn ảnh từ file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Vui lòng chọn tệp hình ảnh (.jpg, .png)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setCapturedImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 5. Gửi lên máy chủ lưu vào CSDL & AI Engine
  const handleSubmit = async () => {
    if (!user || !capturedImage) return;

    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string; avatarPath: string }>('/kiosk/enroll', {
        method: 'POST',
        body: {
          userId: user.id,
          imageBase64: capturedImage,
        },
      });

      toast.success(data.message || `Đã lưu hồ sơ sinh trắc học thành công cho ${user.title || ''} ${user.fullName}`);
      setBioStatus({
        enrolled: true,
        avatarUrl: `/api/kiosk/doctors/${user.id}/avatar?t=${Date.now()}`,
        canSelfEnroll: false,
        canSelfUpdate: bioStatus?.canSelfUpdate ?? false,
      });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu sinh trắc học.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Đăng ký Sinh trắc học Khuôn mặt"
      size="md"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting} className="w-full sm:w-auto">
            Đóng
          </Button>
          <Button
            disabled={!capturedImage || isSubmitting}
            loading={isSubmitting}
            onClick={handleSubmit}
            className="w-full sm:w-auto bg-teal-600 hover:bg-teal-500 text-white font-medium shadow-sm"
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Lưu hồ sơ sinh trắc học
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Thông tin nhân viên */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center border border-slate-300 dark:border-slate-700 shrink-0">
              {bioStatus?.avatarUrl ? (
                <img src={bioStatus.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <User className="h-6 w-6 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {user.title ? `${user.title} ` : ''}{user.fullName}
              </div>
              <div className="text-xs font-mono text-slate-500 truncate">@{user.username}</div>
            </div>
          </div>

          <div className="shrink-0 ml-2">
            {statusLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            ) : bioStatus?.enrolled ? (
              <Badge tone="success" className="text-[11px] flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Đã đăng ký
              </Badge>
            ) : (
              <Badge tone="warning" className="text-[11px]">
                Chưa có dữ liệu
              </Badge>
            )}
          </div>
        </div>

        {/* Tab chọn hình thức: Webcam hoặc Tải file */}
        <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800/80 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('camera');
              setCapturedImage(null);
            }}
            className={`flex-1 py-1.5 px-2 text-[11px] sm:text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
              mode === 'camera'
                ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Camera className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Chụp bằng Camera</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('upload');
              stopWebcam();
            }}
            className={`flex-1 py-1.5 px-2 text-[11px] sm:text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
              mode === 'upload'
                ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Tải ảnh chân dung</span>
          </button>
        </div>

        {/* Khu vực hiển thị Video hoặc Ảnh xem trước */}
        <div className="relative aspect-square w-full max-w-[280px] sm:max-w-[320px] mx-auto rounded-2xl overflow-hidden bg-black border-2 border-teal-500/40 flex items-center justify-center shadow-inner">
          {capturedImage ? (
            <div className="relative w-full h-full">
              <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-0 right-0 flex justify-center px-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCapturedImage(null);
                    if (mode === 'camera') startWebcam();
                  }}
                  className="bg-black/70 backdrop-blur-md text-white border-slate-600 text-xs hover:bg-black/90"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Chụp / Chọn lại
                </Button>
              </div>
            </div>
          ) : mode === 'camera' ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`h-full w-full object-cover -scale-x-100 ${cameraActive ? '' : 'invisible absolute inset-0'}`}
              />
              {cameraActive ? (
                <>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-52 sm:w-44 sm:h-56 rounded-[50%] border-2 border-dashed border-teal-400/80 animate-pulse" />
                  </div>
                  <button
                    type="button"
                    onClick={handleCapture}
                    className="absolute bottom-3 py-2 px-5 rounded-full bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-xs shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Camera className="h-4 w-4" />
                    Chụp ảnh ngay
                  </button>
                </>
              ) : (
                <div className="p-5 text-center text-xs text-slate-200 space-y-3">
                  {cameraError ? (
                    <>
                      <AlertCircle className="h-8 w-8 mx-auto text-rose-400" />
                      <p className="leading-relaxed text-rose-200">{cameraError}</p>
                    </>
                  ) : (
                    <>
                      <Camera className="h-9 w-9 mx-auto text-teal-300" />
                      <div className="space-y-1.5 leading-relaxed">
                        <p className="font-semibold text-slate-100">Sẵn sàng chụp ảnh khuôn mặt</p>
                        <p className="text-slate-400">Nhấn nút dưới đây để trình duyệt hiển thị bước cấp quyền Camera. Trên iPhone, hãy dùng Safari và kết nối HTTPS.</p>
                      </div>
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void startWebcam()}
                    loading={cameraStarting}
                    className="bg-teal-600 hover:bg-teal-500 text-white text-xs"
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    {cameraError ? 'Thử bật Camera lại' : 'Bật Camera và cấp quyền'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="p-6 text-center space-y-3">
              <div className="h-14 w-14 sm:h-16 sm:w-16 mx-auto rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center">
                <Upload className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-300">Tải ảnh chân dung rõ mặt (.jpg, .png)</p>
                <p className="text-[11px] text-slate-500">Ảnh thẳng góc, rõ nét, đủ ánh sáng</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="bg-teal-600 hover:bg-teal-500 text-white text-xs"
              >
                Chọn ảnh từ thiết bị
              </Button>
            </div>
          )}
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
          Dữ liệu khuôn mặt được AI trích xuất vector 512D, mã hoá <strong>AES-256</strong> lưu tại máy chủ bệnh viện và tuân thủ Nghị định 13/2023/NĐ-CP.
        </div>
      </div>
    </Dialog>
  );
}
