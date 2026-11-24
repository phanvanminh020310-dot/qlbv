/**
 * Trang quét QR trên điện thoại (frontend/src/app/scan/[sessionId]) — kiểm thử logic
 * camera trước bằng thiết bị giả lập kiểu iPhone/Zalo WKWebView:
 *  1. bấm "Cho phép" phải ra hình camera trước, không đen màn hình;
 *  2. không còn bất kỳ đường chụp/tải ảnh nào.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FRONT_CAMERA_CONSTRAINTS,
  averageBrightness,
  frameLuma,
  isBlackFrame,
  cameraFailureMessage,
  classifyCameraError,
  isIosInAppBrowser,
  isRearCameraTrack,
  openFrontCameraStream,
  pushLiveFrame,
  safariOpenUrl,
  startVideoPlayback,
  type StreamLike,
  type TrackLike,
  type VideoLike,
} from "../../frontend/src/lib/live-camera";

const ZALO_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/26.08.01 ZaloTheme/dark ZaloLanguage/vn";
const SAFARI_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_ZALO_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Zalo android/12";

function track(facingMode: string | undefined, label = ""): TrackLike & { stopped: boolean } {
  return {
    kind: "video",
    label,
    readyState: "live",
    stopped: false,
    stop() { this.stopped = true; this.readyState = "ended"; },
    getSettings: () => (facingMode ? { facingMode } : {}),
  };
}
function stream(t: TrackLike): StreamLike {
  return { getTracks: () => [t], getVideoTracks: () => [t] };
}
const named = (name: string) => Object.assign(new Error(name), { name });

/** Video giả lập WebKit: ghi lại thứ tự thao tác, play() có thể bị chặn nếu không có thao tác chạm. */
class FakeVideo implements VideoLike {
  log: string[] = [];
  attrs = new Map<string, string>();
  private _src: unknown = null;
  muted = false;
  playsInline = false;
  autoplay = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  paused = true;
  constructor(private behaviour: { requiresGesture?: boolean; framesAfterPlay?: boolean } = {}) {}
  get srcObject() { return this._src; }
  set srcObject(v: unknown) {
    this.log.push(`srcObject(playsinline=${this.attrs.has("playsinline")},muted=${this.muted})`);
    this._src = v;
  }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  userGesture = false;
  play(): Promise<void> {
    this.log.push(`play(gesture=${this.userGesture})`);
    if (this.behaviour.requiresGesture && !this.userGesture) return Promise.reject(named("NotAllowedError"));
    this.paused = false;
    if (this.behaviour.framesAfterPlay !== false) {
      this.readyState = 4; this.videoWidth = 640; this.videoHeight = 480;
      const tick = setInterval(() => { this.currentTime += 0.1; }, 20);
      setTimeout(() => clearInterval(tick), 600);
    }
    return Promise.resolve();
  }
}

test("xin camera trước bằng facingMode=user, không dùng deviceId exact trước khi có quyền", async () => {
  const requests: any[] = [];
  const front = track("user", "Camera trước");
  const result = await openFrontCameraStream({ getUserMedia: async (c) => { requests.push(c); return stream(front); } });
  assert.equal(result.getVideoTracks()[0], front);
  assert.equal(requests.length, 1, "iOS chỉ được gọi getUserMedia một lần khi đã ra camera trước");
  assert.equal(requests[0].video.facingMode, "user");
  assert.equal(requests[0].audio, false);
  for (const c of FRONT_CAMERA_CONSTRAINTS) {
    assert.doesNotMatch(JSON.stringify(c), /deviceId|environment/);
  }
});

test("bấm Không cho phép: báo lỗi quyền, không thử lại liên tục, không mở chế độ chụp ảnh", async () => {
  let calls = 0;
  await assert.rejects(
    openFrontCameraStream({ getUserMedia: async () => { calls++; throw named("NotAllowedError"); } }),
    (error: any) => classifyCameraError(error) === "denied",
  );
  assert.equal(calls, 1);
  assert.match(cameraFailureMessage("denied", true), /Cài đặt iPhone → Zalo → bật Camera|Safari/);
  assert.doesNotMatch(cameraFailureMessage("denied", true), /chụp ảnh|tải ảnh|tải lên/i);
});

test("ràng buộc độ phân giải không đáp ứng thì nới dần, vẫn chỉ camera trước", async () => {
  const requests: any[] = [];
  const front = track("user");
  const result = await openFrontCameraStream({
    getUserMedia: async (c) => {
      requests.push(c);
      if (requests.length === 1) throw named("OverconstrainedError");
      return stream(front);
    },
  });
  assert.equal(result.getVideoTracks()[0], front);
  assert.deepEqual(requests[1].video, { facingMode: "user" });
});

test("thiết bị trả nhầm camera sau: dừng hẳn luồng đó rồi xin lại camera trước", async () => {
  const rear = track("environment", "Back Camera");
  const front = track("user", "Front Camera");
  let calls = 0;
  const result = await openFrontCameraStream({ getUserMedia: async () => (++calls === 1 ? stream(rear) : stream(front)) });
  assert.equal(rear.stopped, true, "iOS chỉ cho một luồng camera: phải dừng luồng sau trước khi xin lại");
  assert.equal(result.getVideoTracks()[0], front);
  assert.equal(isRearCameraTrack(track(undefined, "Back Camera")), true);
  assert.equal(isRearCameraTrack(track("user", "Back Camera")), false, "facingMode thực tế được ưu tiên hơn nhãn");
});

test("không có mediaDevices (WebView cũ) → báo không hỗ trợ, không rơi về chụp ảnh", async () => {
  await assert.rejects(openFrontCameraStream(undefined), (error: any) => classifyCameraError(error) === "unsupported");
});

test("iPhone/Zalo: đặt playsinline+muted TRƯỚC khi gắn luồng và phát ra hình camera", async () => {
  const video = new FakeVideo();
  const result = await startVideoPlayback(video, stream(track("user")), 1_000);
  assert.equal(result, "live");
  assert.equal(video.log[0], "srcObject(playsinline=true,muted=true)");
  assert.equal(video.attrs.has("webkit-playsinline"), true);
  assert.equal(video.paused, false);
});

test("lỗi màn hình đen: WebView chặn tự phát → yêu cầu chạm, chạm xong thì camera chạy", async () => {
  const video = new FakeVideo({ requiresGesture: true });
  const s = stream(track("user"));
  assert.equal(await startVideoPlayback(video, s, 500), "needs-tap", "không được nuốt lỗi play() rồi để màn hình đen");
  video.userGesture = true; // người dùng chạm vào khung camera
  assert.equal(await startVideoPlayback(video, s, 1_000), "live");
  assert.deepEqual(video.log.filter((l) => l.startsWith("srcObject")).length, 1, "không gắn lại luồng khi đã gắn");
});

test("luồng có nhưng không có khung hình → báo no-frames để hiện nút khôi phục, không treo đen", async () => {
  const video = new FakeVideo({ framesAfterPlay: false });
  assert.equal(await startVideoPlayback(video, stream(track("user")), 300), "no-frames");
});

test("phát hiện khung hình đen và gom khung theo thời gian tăng dần", () => {
  assert.equal(averageBrightness([0, 0, 0, 255, 2, 2, 2, 255]), (0 + 2) / 2);
  assert.ok(averageBrightness(new Array(400).fill(200)) > 100);
  let buffer = pushLiveFrame([], { dataUrl: "a", at: 10 });
  buffer = pushLiveFrame(buffer, { dataUrl: "b", at: 10 });
  assert.deepEqual(buffer.map((f) => f.dataUrl), ["b"], "khung cùng thời điểm thay thế khung trước");
  for (const [d, at] of [["c", 20], ["d", 30], ["e", 40]] as const) buffer = pushLiveFrame(buffer, { dataUrl: d, at });
  assert.deepEqual(buffer.map((f) => f.dataUrl), ["c", "d", "e"]);
});

test("khung đen do lỗi hiển thị được nhận ra, phòng tối/nền tối có điểm sáng thì không báo nhầm", () => {
  const black = new Uint8ClampedArray(480 * 360 * 4); // video không vẽ: toàn bộ 0
  assert.equal(isBlackFrame(black), true);
  const darkRoom = new Uint8ClampedArray(480 * 360 * 4).fill(8);
  for (let i = 0; i < darkRoom.length; i += 4 * 97) { darkRoom[i] = darkRoom[i + 1] = darkRoom[i + 2] = 120; } // mặt/đèn sáng rải rác
  assert.equal(isBlackFrame(darkRoom), false, "cảnh thật tối nhưng có điểm sáng không phải lỗi màn hình đen");
  assert.ok(frameLuma(darkRoom).avg < 30);
});

test("nhận diện trình duyệt Zalo trên iPhone để hướng dẫn mở Safari; Android không bị ảnh hưởng", () => {
  assert.equal(isIosInAppBrowser(ZALO_IPHONE_UA), true);
  assert.equal(isIosInAppBrowser(SAFARI_IPHONE_UA), false);
  assert.equal(isIosInAppBrowser(ANDROID_ZALO_UA), false);
  assert.equal(safariOpenUrl("https://qlbv.bvqy4.io.vn/scan/abc"), "x-safari-https://qlbv.bvqy4.io.vn/scan/abc");
  assert.equal(safariOpenUrl("http://10.0.0.2:3000/scan/abc"), null);
});

test("trang quét không còn chức năng chọn/chụp ảnh gửi lên", () => {
  const page = readFileSync(resolve(__dirname, "../../frontend/src/app/scan/[sessionId]/page.tsx"), "utf8");
  for (const forbidden of [
    /type=["']file["']/,
    /capture=/,
    /FileReader/,
    /handleFileCapture|triggerNativeCamera|compressImage|capturedPreview|isHttpCaptureMode/,
    /imageBase64|snapshotBase64/,
    /accept=["']image/,
  ]) {
    assert.doesNotMatch(page, forbidden, `trang quét vẫn còn ${forbidden}`);
  }
  assert.match(page, /liveCapture/, "trang quét phải gửi bằng chứng camera trực tiếp");
  assert.match(page, /openFrontCameraStream/);
  assert.match(page, /startVideoPlayback/);
  // Không đặt transform lật gương trực tiếp lên thẻ <video> (WebKit có thể vẽ đen).
  assert.doesNotMatch(page, /<video[^>]*scale-x/s);
});
