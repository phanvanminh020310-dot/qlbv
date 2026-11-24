"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import {
  BLACK_FRAME_MAX_LUMA,
  frameLuma,
  buildLiveCaptureProof,
  cameraFailureMessage,
  classifyCameraError,
  isIos,
  isIosInAppBrowser,
  liveFramesReady,
  openFrontCameraStream,
  pushLiveFrame,
  safariOpenUrl,
  startVideoPlayback,
  stopStream,
  type CameraFailure,
  type LiveFrame,
} from "@/lib/live-camera";
import {
  SCAN_MESSAGES,
  isTransientScanMessage,
  needsNewQr,
  scanMessageTitle,
  toScanMessage,
  type ScanMessage,
} from "@/lib/scan-messages";

// One stable claim even when Safari/private-mode storage is unavailable.
let memoryDeviceClaimToken = "";
function getDeviceClaimToken(): string {
  if (typeof window === "undefined") return "";
  if (memoryDeviceClaimToken) return memoryDeviceClaimToken;
  const key = "qlbv_kiosk_device_claim_token";
  try {
    const stored = localStorage.getItem(key);
    if (stored && stored.length >= 16 && stored.length <= 256)
      memoryDeviceClaimToken = stored;
  } catch {
    /* Use the in-memory token for this page, not a new token on every frame. */
  }
  if (!memoryDeviceClaimToken) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    memoryDeviceClaimToken =
      "dev_" +
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      localStorage.setItem(key, memoryDeviceClaimToken);
    } catch {
      /* Storage is optional for a single capture. */
    }
  }
  return memoryDeviceClaimToken;
}

/**
 * Trạng thái camera trực tiếp:
 *  - starting: đang xin quyền / mở luồng camera trước
 *  - live: video đang chạy, vòng quét tự động gửi chuỗi khung hình
 *  - needs-tap: WebView (Zalo/iOS) chặn tự phát → cần một lần chạm để phát video
 *  - no-frames: đã có luồng nhưng khung hình đen/không chạy
 *  - error: không mở được camera (bị từ chối, không hỗ trợ...)
 * Không có chế độ chụp/tải ảnh: xác thực chỉ bằng camera trực tiếp.
 */
type CameraState = "starting" | "live" | "needs-tap" | "no-frames" | "error";

const FRAME_INTERVAL_MS = 400;
const DARK_SKIP_BRIGHTNESS = 18; // trung bình toàn khung; quá tối thì AI không nhận diện được
const BLACK_FRAMES_BEFORE_RECOVERY = 15; // ~6 giây khung hình đen liên tục
const MAX_ATTEMPTS = 80;

export default function MobileScanPage() {
  const routeParams = useParams();
  const rawSessionId = (routeParams?.sessionId as string) || "";
  const sessionId = decodeURIComponent(rawSessionId);

  const [sessionData, setSessionData] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<ScanMessage | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraFailure, setCameraFailure] = useState<CameraFailure | null>(null);
  const [tapAttempts, setTapAttempts] = useState(0);
  const [env, setEnv] = useState({ ios: false, inAppIos: false, https: true });
  const [linkCopied, setLinkCopied] = useState(false);

  const [currentStep, setCurrentStep] = useState<"scanning" | "success" | "failed">("scanning");
  const [statusText, setStatusText] = useState<string>("Đang mở camera trước...");
  const [resultData, setResultData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<ScanMessage | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent || "";
    setEnv({
      ios: isIos(ua),
      inAppIos: isIosInAppBrowser(ua),
      https: window.location.protocol === "https:",
    });
    return () => {
      unmountedRef.current = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  // 1. Nhận claim của điện thoại và tải thông tin phiên QR từ sessionId
  useEffect(() => {
    if (typeof window === "undefined") return;

    const runInit = async () => {
      try {
        // Không chặn theo User-Agent/referrer: iOS có thể mở URL từ Zalo, Chrome hoặc Safari.
        const claimToken = getDeviceClaimToken();
        const resp = await fetch(`/api/kiosk/session/${sessionId}`, {
          headers: { "x-device-claim-token": claimToken },
        });
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => null);
          // Không hiển thị nguyên văn lỗi máy chủ: quy về câu ngắn gọn.
          throw new Error(toScanMessage(errJson?.message || SCAN_MESSAGES.QR_EXPIRED));
        }
        const raw = await resp.json();
        const data = raw?.data ?? raw;
        setSessionData(data);

        if (data?.status === "VERIFIED") {
          setResultData({ success: true, doctor: data.verifiedDoctor });
          setCurrentStep("success");
        }
      } catch (err: any) {
        setSessionError(toScanMessage(err?.message));
      } finally {
        setLoadingSession(false);
      }
    };

    runInit();
  }, [sessionId]);

  const handleSwitchToHttps = () => {
    if (typeof window === "undefined") return;
    const curPort = window.location.port;
    let targetPort = "";
    if (curPort === "3000") {
      targetPort = ":3443";
    } else if (curPort && curPort !== "80" && curPort !== "443") {
      targetPort = `:${curPort}`;
    }
    window.location.href = `https://${window.location.hostname}${targetPort}${window.location.pathname}${window.location.search}`;
  };

  /** Video chỉ được mount khi đang ở bước quét; chờ phần tử có trong DOM trước khi gắn luồng. */
  const waitForVideoElement = async (): Promise<HTMLVideoElement | null> => {
    for (let i = 0; i < 40 && !videoRef.current; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return videoRef.current;
  };

  const applyPlaybackResult = useCallback((result: "live" | "needs-tap" | "no-frames") => {
    setCameraState(result);
    setStatusText(
      result === "live"
        ? "Nhìn thẳng camera để tự động điểm danh..."
        : "Chạm vào khung camera để bật hình ảnh camera trước",
    );
  }, []);

  // 2. Mở camera trước trực tiếp. Không còn đường dự phòng chụp/tải ảnh.
  const startCamera = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setCameraFailure(null);
    setCameraState("starting");
    setStatusText("Đang mở camera trước...");
    try {
      stopStream(streamRef.current);
      streamRef.current = null;

      const stream = (await openFrontCameraStream(
        typeof navigator !== "undefined" ? (navigator.mediaDevices as any) : null,
      )) as unknown as MediaStream;
      if (unmountedRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (streamRef.current !== stream || unmountedRef.current) return;
          setCameraState("no-frames");
          setStatusText("Camera đã bị tắt. Chạm vào khung camera để bật lại.");
        });
      });

      const video = await waitForVideoElement();
      if (!video) {
        applyPlaybackResult("needs-tap");
        return;
      }
      applyPlaybackResult(await startVideoPlayback(video as any, stream as any));
    } catch (err) {
      const kind = classifyCameraError(err);
      console.warn("Không mở được camera trước:", err);
      setCameraFailure(kind);
      setCameraState("error");
      setStatusText("Chưa mở được camera trước");
    } finally {
      isStartingRef.current = false;
    }
  }, [applyPlaybackResult]);

  /**
   * Chạm của người dùng: gọi play() đồng bộ trong sự kiện chạm để WebKit/Zalo
   * cho phép phát video camera; nếu luồng đã mất thì xin lại camera.
   */
  const handleCameraTap = () => {
    if (cameraState === "live" || cameraState === "starting") return;
    setTapAttempts((n) => n + 1);
    const stream = streamRef.current;
    const video = videoRef.current;
    const streamAlive = !!stream?.getVideoTracks().some((t) => t.readyState === "live");
    if (!stream || !video || !streamAlive) {
      void startCamera();
      return;
    }
    setCameraState("starting");
    setStatusText("Đang bật hình ảnh camera trước...");
    void startVideoPlayback(video as any, stream as any).then(applyPlaybackResult);
  };

  // Tự động mở camera khi phiên nạp thành công
  useEffect(() => {
    if (!loadingSession && !sessionError && sessionData && sessionData.status !== "VERIFIED") {
      void startCamera();
    }
  }, [loadingSession, sessionError, sessionData, startCamera]);

  // iOS tạm dừng video khi hộp thoại quyền/ứng dụng khác che trang: phát lại khi quay về.
  useEffect(() => {
    const resume = () => {
      const video = videoRef.current;
      if (document.visibilityState !== "visible" || !video || !streamRef.current) return;
      if (video.paused) {
        Promise.resolve(video.play()).catch(() => {
          setCameraState((state) => (state === "live" ? "needs-tap" : state));
        });
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, []);

  // Gửi chuỗi khung hình camera trực tiếp sang AI xác thực
  const submitVerification = async (
    liveCapture: ReturnType<typeof buildLiveCaptureProof>,
  ): Promise<boolean> => {
    try {
      const claimToken = getDeviceClaimToken();
      const resp = await fetch("/api/kiosk/verify-face", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-claim-token": claimToken,
        },
        body: JSON.stringify({
          sessionId,
          completedChallenges: ["PASSIVE_LIVENESS"],
          claimToken,
          liveCapture,
        }),
      });

      const raw = await resp.json();
      const data = raw?.data ?? raw;

      if (resp.ok && data?.success !== false && !data?.isProcessing) {
        setResultData(data);
        setCurrentStep("success");
        stopStream(streamRef.current);
        streamRef.current = null;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
        return true;
      }

      if (data?.isProcessing) {
        setStatusText(SCAN_MESSAGES.PROCESSING);
        return false;
      }

      const msg = toScanMessage(data?.message);
      if (isTransientScanMessage(msg)) {
        setStatusText(msg);
        return false;
      }

      setErrorMessage(msg);
      setCurrentStep("failed");
      stopStream(streamRef.current);
      streamRef.current = null;
      return false;
    } catch {
      return false;
    }
  };

  // 3. VÒNG LẶP TỰ ĐỘNG: lấy khung hình từ video trực tiếp, gửi kèm bằng chứng nhiều khung.
  const nonce: string | undefined = sessionData?.liveCaptureNonce;
  useEffect(() => {
    if (cameraState !== "live" || currentStep !== "scanning" || !nonce) return;

    let active = true;
    let analyzing = false;
    let attempts = 0;
    let blackFrames = 0;
    let frames: LiveFrame[] = [];
    const startedAt = Date.now();
    const canvas = document.createElement("canvas");

    const interval = setInterval(async () => {
      if (!active || analyzing) return;
      const video = videoRef.current;
      if (!video) return;
      // Cho auto-exposure / white-balance ổn định
      if (Date.now() - startedAt < 600) return;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

      canvas.width = 480;
      canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth);
      const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const luma = frameLuma(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      if (luma.max < BLACK_FRAME_MAX_LUMA) {
        blackFrames++;
        if (blackFrames >= BLACK_FRAMES_BEFORE_RECOVERY) {
          active = false;
          clearInterval(interval);
          setCameraState("no-frames");
          setStatusText("Khung camera đang đen. Chạm vào khung camera để bật lại hình ảnh.");
        }
        return;
      }
      blackFrames = 0;
      if (luma.avg < DARK_SKIP_BRIGHTNESS) {
        setStatusText("Khung hình hơi tối, vui lòng đứng nơi đủ sáng");
        return;
      }

      frames = pushLiveFrame(frames, { dataUrl: canvas.toDataURL("image/jpeg", 0.85), at: Date.now() });
      if (!liveFramesReady(frames)) return;

      analyzing = true;
      setStatusText(SCAN_MESSAGES.PROCESSING);
      const proof = buildLiveCaptureProof(frames, nonce, video);
      frames = []; // Mỗi lần gửi dùng chuỗi khung hình mới
      const ok = await submitVerification(proof);
      if (!active) return;
      if (ok) {
        active = false;
        clearInterval(interval);
        return;
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        active = false;
        clearInterval(interval);
        setErrorMessage(SCAN_MESSAGES.VERIFY_FAILED);
        setCurrentStep("failed");
        stopStream(streamRef.current);
        streamRef.current = null;
        return;
      }
      analyzing = false;
    }, FRAME_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, currentStep, nonce, sessionId]);

  const copyLink = async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      const area = document.createElement("textarea");
      area.value = href;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {
        /* người dùng có thể sao chép thủ công */
      }
      document.body.removeChild(area);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  if (sessionError) {
    return (
      <div className="app-viewport-min app-safe-page bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">
          {scanMessageTitle(sessionError)}
        </h2>
        {needsNewQr(sessionError) && (
          <p className="text-sm text-slate-300 max-w-sm">Vui lòng quét mã mới.</p>
        )}
        {!needsNewQr(sessionError) && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
          >
            Thử lại
          </button>
        )}
      </div>
    );
  }

  if (loadingSession) {
    return (
      <div className="app-viewport-min app-safe-page bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <RefreshCw className="h-10 w-10 text-teal-400 animate-spin mb-4" />
        <p className="text-sm font-semibold">
          Đang nạp phiên điểm danh phòng khám...
        </p>
      </div>
    );
  }

  const needsRecovery = cameraState === "needs-tap" || cameraState === "no-frames";
  const safariHref =
    typeof window !== "undefined" ? safariOpenUrl(window.location.href) : null;
  // Gợi ý mở bằng Safari khi đang ở trình duyệt nhúng iPhone và camera chưa lên,
  // hoặc đã chạm mà vẫn đen.
  const showSafariHelp =
    env.ios &&
    ((env.inAppIos && (needsRecovery || cameraState === "error")) ||
      (needsRecovery && tapAttempts >= 1));

  return (
    <div className="app-viewport-min app-safe-page bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none max-w-md mx-auto">
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

      </header>

      <main className="my-auto py-4">
        {/* KHUNG QUÉT CAMERA TRỰC TIẾP */}
        {currentStep === "scanning" && (
          <div className="space-y-4">
            <div
              onClick={handleCameraTap}
              role={needsRecovery ? "button" : undefined}
              aria-label={needsRecovery ? "Chạm để bật camera trước" : undefined}
              className={`relative aspect-square w-full rounded-3xl overflow-hidden bg-black border-2 border-teal-500/60 shadow-2xl ${
                needsRecovery ? "cursor-pointer" : ""
              }`}
            >
              {/* Lật gương trên lớp bọc, không đặt transform trực tiếp lên <video> (WebKit có thể vẽ đen). */}
              <div className="absolute inset-0 -scale-x-100">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  disablePictureInPicture
                  className="w-full h-full object-cover"
                />
              </div>

              {cameraState === "live" && (
                <>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-56 h-72 rounded-[50%] border-2 border-teal-400/70 animate-pulse shadow-[0_0_40px_rgba(20,184,166,0.35)] flex items-center justify-center">
                      <div className="w-48 h-64 rounded-[50%] border border-dashed border-teal-300/40"></div>
                    </div>
                  </div>
                  <div className="absolute inset-x-8 top-12 h-1 bg-gradient-to-r from-transparent via-teal-400 to-transparent animate-bounce opacity-75 pointer-events-none"></div>
                </>
              )}

              {cameraState === "starting" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-950/70">
                  <RefreshCw className="h-9 w-9 text-teal-400 animate-spin mb-3" />
                  <p className="text-xs font-semibold text-teal-100">
                    Đang mở camera trước...
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Nếu điện thoại hỏi quyền, hãy chọn <strong>Cho phép</strong>.
                  </p>
                </div>
              )}

              {needsRecovery && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-950/75">
                  <div className="w-56 h-72 rounded-[50%] border-2 border-teal-400/80 animate-pulse flex flex-col items-center justify-center bg-teal-950/30 px-4">
                    <Camera className="h-12 w-12 text-teal-300 mb-2" />
                    <span className="text-sm font-bold text-teal-100">
                      Chạm để bật camera trước
                    </span>
                    <span className="text-[11px] text-teal-300/80 mt-1.5 font-medium">
                      Xác thực chỉ bằng hình ảnh trực tiếp từ camera
                    </span>
                  </div>
                </div>
              )}

              {cameraState === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-gradient-to-b from-slate-900 to-black">
                  <AlertTriangle className="h-10 w-10 text-amber-400 mb-3" />
                  <p className="text-sm font-bold text-amber-200">
                    Chưa mở được camera trước
                  </p>
                  <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
                    {cameraFailure === "insecure" || !env.https
                      ? cameraFailureMessage("insecure", env.inAppIos)
                      : cameraFailureMessage(cameraFailure ?? "unknown", env.inAppIos)}
                  </p>
                </div>
              )}

            </div>

            <div className="space-y-3 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-teal-400 animate-pulse">
                <Sparkles className="h-4 w-4" />
                <span>{statusText}</span>
              </div>

              {cameraState === "error" && (
                <div className="space-y-2">
                  {!env.https ? (
                    <button
                      type="button"
                      onClick={handleSwitchToHttps}
                      className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm"
                    >
                      Chuyển sang HTTPS
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="w-full py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Thử mở lại camera trước
                    </button>
                  )}
                </div>
              )}

              {showSafariHelp && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs text-amber-100 space-y-2">
                  <p className="font-bold text-amber-300">
                    Camera chưa hiển thị trong trình duyệt của ứng dụng
                  </p>
                  <p className="text-[11px] leading-relaxed text-slate-200">
                    Trên iPhone, trình duyệt bên trong Zalo có thể không hiển thị
                    camera. Hãy mở trang này bằng <strong>Safari</strong>: bấm nút
                    bên dưới, hoặc bấm <strong>⋯</strong> ở góc trên → <strong>Mở bằng trình duyệt</strong>.
                  </p>
                  <div className="flex gap-2">
                    {safariHref && (
                      <a
                        href={safariHref}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Mở bằng Safari
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void copyLink()}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-amber-400/60 text-amber-100 font-bold"
                    >
                      <Copy className="h-4 w-4" />
                      {linkCopied ? "Đã sao chép" : "Sao chép liên kết"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* THÀNH CÔNG — chỉ báo thành công, không hiện chỉ số kỹ thuật */}
        {currentStep === "success" && (
          <div className="text-center space-y-5">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-xl">
              <CheckCircle2 className="h-10 w-10 animate-in zoom-in-75 duration-300" />
            </div>
            <h2 className="text-xl font-bold text-emerald-400">
              {scanMessageTitle(SCAN_MESSAGES.SUCCESS)}
            </h2>
            {resultData?.doctor?.fullName && (
              <p className="text-base font-semibold text-white">
                {[resultData.doctor.title, resultData.doctor.fullName].filter(Boolean).join(" ")}
              </p>
            )}
            {resultData?.doctor?.shiftName && (
              <p className="text-xs text-slate-400">
                Ca trực: <strong className="text-white">{resultData.doctor.shiftName}</strong>
              </p>
            )}
          </div>
        )}

        {/* THẤT BẠI — một câu ngắn gọn, không hiện chi tiết kỹ thuật */}
        {currentStep === "failed" && (
          <div className="text-center space-y-5">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-rose-500/10 border-2 border-rose-500/30 text-rose-400 flex items-center justify-center shadow-xl">
              <AlertTriangle className="h-10 w-10" />
            </div>
            <h2 className="text-lg font-bold text-white">
              {scanMessageTitle(errorMessage ?? SCAN_MESSAGES.VERIFY_FAILED)}
            </h2>
            {errorMessage && needsNewQr(errorMessage) ? (
              <p className="text-sm text-slate-300">Vui lòng quét mã mới.</p>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const claimToken = getDeviceClaimToken();
                    const check = await fetch(`/api/kiosk/session/${sessionId}`, {
                      headers: { "x-device-claim-token": claimToken },
                    });
                    if (!check.ok) {
                      // Mã QR đã hết hạn/đã dùng: báo ngắn gọn, không mở lại camera vô ích.
                      const cErr = await check.json().catch(() => null);
                      setErrorMessage(toScanMessage(cErr?.message || SCAN_MESSAGES.QR_EXPIRED));
                      return;
                    }
                    {
                      const cRaw = await check.json();
                      const cData = cRaw?.data ?? cRaw;
                      if (cData?.liveCaptureNonce) setSessionData(cData);
                      if (cData?.status === "VERIFIED") {
                        setResultData({ success: true, doctor: cData.verifiedDoctor });
                        setCurrentStep("success");
                        return;
                      }
                    }
                  } catch {}
                  setErrorMessage(null);
                  setCurrentStep("scanning");
                  void startCamera();
                }}
                className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Thử lại</span>
              </button>
            )}
          </div>
        )}
      </main>

      <footer className="text-center text-[10px] text-slate-500 border-t border-slate-900 pt-3">
        Bệnh viện Quân y 4 · Điểm danh khuôn mặt
      </footer>
    </div>
  );
}
