/**
 * Camera trước trực tiếp cho trang quét QR xác thực khuôn mặt.
 *
 * Mô-đun không tham chiếu kiểu DOM toàn cục để kiểm thử được bằng Node.
 * Lý do màn hình đen trên iPhone (Zalo/WKWebView, Safari):
 *  - WebView chặn tự phát video nếu không có thao tác chạm → play() bị từ chối
 *    nhưng lỗi trước đây bị nuốt, khung video đen mãi;
 *  - chọn camera bằng deviceId "exact" trước khi có quyền (nhãn rỗng) và gọi
 *    getUserMedia lần hai làm iOS tắt luồng đầu;
 *  - gắn srcObject trước khi đặt playsinline/muted, hoặc video chưa được mount.
 * Không có bất kỳ đường dự phòng chọn/chụp ảnh tải lên nào.
 */

export interface TrackLike {
  kind?: string;
  label?: string;
  readyState?: string;
  muted?: boolean;
  stop(): void;
  getSettings?(): { facingMode?: string; deviceId?: string; width?: number; height?: number };
}

export interface StreamLike {
  getTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}

export interface MediaDevicesLike {
  getUserMedia(constraints: unknown): Promise<StreamLike>;
}

export interface VideoLike {
  srcObject: unknown;
  muted: boolean;
  playsInline?: boolean;
  autoplay?: boolean;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  paused?: boolean;
  setAttribute(name: string, value: string): void;
  play(): Promise<void> | void;
}

export type CameraFailure = "denied" | "insecure" | "unsupported" | "not-found" | "busy" | "unknown";

/** Thứ tự ràng buộc: luôn camera trước, nới dần độ phân giải nếu thiết bị không đáp ứng. */
export const FRONT_CAMERA_CONSTRAINTS: ReadonlyArray<{ audio: false; video: Record<string, unknown> | true }> = [
  { audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } },
  { audio: false, video: { facingMode: "user" } },
  { audio: false, video: { facingMode: { exact: "user" } } },
];

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) return String((error as { name: unknown }).name);
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyCameraError(error: unknown): CameraFailure {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "SecurityError" || name === "INSECURE_CONTEXT") return "insecure";
  if (name === "NO_MEDIA_DEVICES" || name === "TypeError" || name === "NotSupportedError") return "unsupported";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "not-found";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "unknown";
}

/** Quyền bị từ chối/không an toàn: thử ràng buộc khác vô ích và chỉ hiện lại hộp thoại. */
function isTerminal(error: unknown): boolean {
  const kind = classifyCameraError(error);
  return kind === "denied" || kind === "insecure";
}

export function stopStream(stream: StreamLike | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* track đã dừng */
    }
  }
}

/** Nhận biết camera sau theo facingMode thực tế, chỉ dùng nhãn khi trình duyệt không báo facingMode. */
export function isRearCameraTrack(track: TrackLike | undefined): boolean {
  if (!track) return false;
  const facing = track.getSettings?.().facingMode;
  if (facing) return facing === "environment";
  return /back|rear|environment|sau/i.test(track.label ?? "");
}

/** Mở luồng camera trước. Ném lỗi gốc của trình duyệt để phân loại thông báo. */
export async function openFrontCameraStream(mediaDevices: MediaDevicesLike | null | undefined): Promise<StreamLike> {
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
    const error = new Error("NO_MEDIA_DEVICES");
    (error as Error & { name: string }).name = "NO_MEDIA_DEVICES";
    throw error;
  }
  let lastError: unknown;
  for (const constraints of FRONT_CAMERA_CONSTRAINTS) {
    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      if (!isRearCameraTrack(stream.getVideoTracks()[0])) return stream;
      // Thiết bị trả nhầm camera sau: dừng hẳn trước khi xin lại (iOS chỉ cho một luồng camera).
      stopStream(stream);
      lastError ??= Object.assign(new Error("REAR_CAMERA_SELECTED"), { name: "OverconstrainedError" });
    } catch (error) {
      if (isTerminal(error)) throw error;
      // Giữ lỗi đầu tiên: lỗi của ràng buộc nới lỏng sau cùng thường kém thông tin hơn.
      lastError ??= error;
    }
  }
  throw lastError ?? new Error("CAMERA_UNAVAILABLE");
}

/** Đặt thuộc tính inline/muted TRƯỚC khi gắn luồng; WebKit cần thứ tự này để không mở toàn màn hình hay đen khung. */
export function prepareVideoElement(video: VideoLike, stream: StreamLike): void {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("autoplay", "");
  if (video.srcObject !== stream) video.srcObject = stream;
}

export function videoHasFrames(video: VideoLike): boolean {
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Chờ khung hình thật xuất hiện và thời gian phát tiến lên (không chỉ có metadata). */
export async function waitForVideoFrames(video: VideoLike, timeoutMs = 4_000, pollMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let firstTime: number | null = null;
  while (Date.now() < deadline) {
    if (videoHasFrames(video)) {
      if (firstTime === null) firstTime = video.currentTime;
      else if (video.currentTime > firstTime) return true;
      // Một số WebKit không cập nhật currentTime với MediaStream; kích thước + đang phát là đủ.
      if (video.paused === false && video.currentTime > 0) return true;
    }
    await delay(pollMs);
  }
  return false;
}

export type PlaybackResult = "live" | "needs-tap" | "no-frames";

/**
 * Gắn luồng vào video và phát. Nếu WebView yêu cầu thao tác chạm (play bị từ chối),
 * trả "needs-tap" để giao diện hiện nút chạm; gọi lại hàm này trong sự kiện chạm.
 */
export async function startVideoPlayback(video: VideoLike, stream: StreamLike, timeoutMs = 4_000): Promise<PlaybackResult> {
  prepareVideoElement(video, stream);
  let playRejected = false;
  try {
    await video.play();
  } catch (error) {
    playRejected = true;
    if (errorName(error) === "AbortError") playRejected = false; // srcObject vừa đổi; vẫn có thể phát
  }
  if (playRejected) return "needs-tap";
  return (await waitForVideoFrames(video, timeoutMs)) ? "live" : "no-frames";
}

/** Khung hình hầu như đen: WebView nhận luồng nhưng không vẽ được video. */
export function averageBrightness(rgba: ArrayLike<number>): number {
  let sum = 0;
  let pixels = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    sum += (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    pixels++;
  }
  return pixels ? sum / pixels : 0;
}

/**
 * Độ sáng trung bình và lớn nhất trên toàn khung (lấy mẫu thưa). Khung "đen do lỗi
 * hiển thị" là đen đồng đều: không có điểm ảnh nào sáng. Cảnh thật dù tối vẫn có
 * điểm sáng, nên chỉ dựa vào max để tránh báo nhầm phòng tối/nền tối là lỗi.
 */
export function frameLuma(rgba: ArrayLike<number>, pixelStride = 16): { avg: number; max: number } {
  let sum = 0;
  let max = 0;
  let pixels = 0;
  const step = Math.max(1, Math.floor(pixelStride)) * 4;
  for (let i = 0; i + 2 < rgba.length; i += step) {
    const luma = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    sum += luma;
    if (luma > max) max = luma;
    pixels++;
  }
  return { avg: pixels ? sum / pixels : 0, max };
}

export const BLACK_FRAME_MAX_LUMA = 20;
export function isBlackFrame(rgba: ArrayLike<number>): boolean {
  return frameLuma(rgba).max < BLACK_FRAME_MAX_LUMA;
}

export interface LiveFrame {
  dataUrl: string;
  at: number;
}

export const LIVE_PROOF_FRAMES = 3;
export const LIVE_PROOF_MIN_SPAN_MS = 300;

/** Giữ N khung gần nhất (thời gian tăng dần) để gửi kèm bằng chứng camera trực tiếp. */
export function pushLiveFrame(buffer: LiveFrame[], frame: LiveFrame, max = LIVE_PROOF_FRAMES): LiveFrame[] {
  const last = buffer[buffer.length - 1];
  const next = last && frame.at <= last.at ? buffer.slice(0, -1) : buffer.slice();
  next.push(frame);
  return next.slice(-max);
}

export function liveFramesReady(buffer: LiveFrame[]): boolean {
  if (buffer.length < LIVE_PROOF_FRAMES) return false;
  const span = buffer[buffer.length - 1].at - buffer[0].at;
  return span >= LIVE_PROOF_MIN_SPAN_MS && span <= 15_000;
}

export function buildLiveCaptureProof(buffer: LiveFrame[], nonce: string, video: { videoWidth: number; videoHeight: number }) {
  return {
    mode: "LIVE_CAMERA_STREAM" as const,
    nonce,
    frames: buffer.map((frame) => frame.dataUrl),
    frameTimestamps: buffer.map((frame) => frame.at),
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  };
}

/** Trình duyệt nhúng trên iPhone (Zalo, Facebook, Messenger, Instagram, Line, TikTok). */
export function isIosInAppBrowser(userAgent: string): boolean {
  if (!/iPhone|iPad|iPod/i.test(userAgent)) return false;
  return /Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|TikTok|musical_ly|MicroMessenger/i.test(userAgent);
}

export function isIos(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

/** iOS 17+: liên kết x-safari-https:// mở thẳng trang trong Safari. */
export function safariOpenUrl(href: string): string | null {
  return /^https:\/\//i.test(href) ? `x-safari-${href}` : null;
}

export function cameraFailureMessage(kind: CameraFailure, inAppIos: boolean): string {
  switch (kind) {
    case "denied":
      return inAppIos
        ? "Camera đang bị chặn. Vào Cài đặt iPhone → Zalo → bật Camera, hoặc mở liên kết này bằng Safari rồi chọn Cho phép."
        : "Camera đang bị chặn. Hãy cho phép trình duyệt dùng camera (Cài đặt → Safari → Camera → Hỏi/Cho phép) rồi thử lại.";
    case "insecure":
      return "Trang cần mở qua HTTPS để dùng camera trực tiếp.";
    case "unsupported":
      return inAppIos
        ? "Trình duyệt trong ứng dụng này không hỗ trợ camera trực tiếp. Hãy mở liên kết bằng Safari."
        : "Trình duyệt không hỗ trợ camera trực tiếp. Hãy mở bằng Safari hoặc Chrome bản mới.";
    case "not-found":
      return "Không tìm thấy camera trước trên thiết bị.";
    case "busy":
      return "Camera đang được ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.";
    default:
      return "Không mở được camera trước. Vui lòng thử lại hoặc mở bằng Safari.";
  }
}
