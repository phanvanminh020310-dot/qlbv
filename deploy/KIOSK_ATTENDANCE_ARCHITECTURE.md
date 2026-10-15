# Kiến trúc xác thực ca trực và Kiosk phòng khám — bản 2

## Mô hình triển khai

```text
PC phòng khám (Windows 10/11)              Điện thoại bác sĩ
QLBS_Kiosk.exe — một WinForms EXE         Camera mặc định → browser hệ thống
  ├─ GDI+ UI, QR native                   /scan/<sessionId>
  ├─ keyboard hook WH_KEYBOARD_LL           ├─ claim một thiết bị
  ├─ cửa sổ phủ các monitor                └─ camera trước → ảnh sống
  └─ SSE + status polling 3 giây                  │
            │                                     │
            └────────── HTTPS / LAN ──────────────┘
                              │
VPS 1: QLBV                   ▼
  Next.js (3000) → /api proxy → NestJS (4000)
    KioskService: QR/claim/lease/unicast/SSE/PIN
    IntegrationDutyService: lịch đã công bố, giờ UTC+7
    PostgreSQL: phân công, nghỉ phép, sinh trắc học, điểm danh, audit
    Redis: cache/các hạ tầng hiện có
                              │
                              │ server-to-server, mạng riêng/firewall
                              ▼
VPS 2: AI stateless FastAPI (8001)
  /api/ai/verify-and-extract
  /api/ai/liveness-pad + /api/ai/extract-embedding (tương thích)
  ArcFace / PAD hiện có — không đưa model về PC
```

**Không có Agent riêng + Edge, WebView2, HTTP listener localhost, PIN bốn số, GPS hay webcam PC.** Một EXE vẫn cần chạy kín để biết khi nào phải khoá lại; đây là cùng tiến trình WinForms, không phải dịch vụ/agent phụ cần cài riêng. Khi unlock, tất cả cửa sổ ẩn và không có taskbar/tray/badge/dock. Không tự khởi chạy HIS.

## 1. Các tệp chính

| Tệp | Vai trò |
|---|---|
| `deploy/windows/QLBS_Kiosk.cs` | Một nguồn C# 5 gồm runtime, state/UI, keyboard hook, HTTP/SSE, bộ cài, PIN dialog, self-test và QR MIT nhúng |
| `deploy/windows/cai_dat_kiosk.bat` | Hai cách: dùng EXE phát hành hoặc compile bằng compiler .NET có sẵn |
| `deploy/windows/go_bo_kiosk.bat` | Cứu hộ độc lập, không dựa vào EXE hay config còn hoạt động |
| `deploy/windows/HUONG_DAN_SU_DUNG.md` | Cài từng máy/hàng loạt, vận hành, giới hạn bảo vệ, checklist nghiệm thu |
| `backend/src/modules/kiosk/kiosk.service.ts` | Nguồn sự thật về QR, scan, lease, thời hạn và đối soát phân công |
| `backend/src/modules/kiosk/kiosk-security.ts` | Khoá đích máy trạm, so sánh PIN, throttle, phát hiện client nhúng |
| `frontend/src/app/scan/[sessionId]/page.tsx` | Luồng điện thoại dùng chung, camera trước/PAD không gesture challenge |
| `frontend/src/app/kiosk/[roomCode]/page.tsx` | Giữ route web tương thích/chẩn đoán; không phải ranh giới khoá Windows của bản mới |
| `.github/workflows/kiosk-windows.yml` | Quality gate và gói Windows có checksums; không công bố/ký số giả |

## 2. Giao thức máy trạm v2

`GET /api/kiosk/status?room=PK01&terminalId=<random>&clientOrigin=<hospital-web-origin>` trả snapshot, có thể nằm trong envelope `{ success, data, timestamp }`:

```text
protocolVersion: 2
terminalId: đúng máy đang yêu cầu
roomExists, room: đúng phòng đang hoạt động
serverTime: Unix milliseconds
currentScheduled: phân công chuẩn hoặc null
isUnlocked, activeDoctor, shiftEndMs: lease của riêng (phòng, terminal)
qrSession: null nếu đã mở, nếu khoá gồm:
  sessionId, qrUrl
  expiresAt: deadline tuyệt đối theo giờ server
  status: WAITING | SCANNED
  scannedAt: null hoặc thời điểm claim đầu tiên
  totalExpiresSeconds, faceVerifyBufferSeconds
```

- Client không tin đồng hồ PC; đồng bộ `serverTime` rồi chạy bằng `Stopwatch` monotonic.
- Chỉ snapshot đúng terminal/phòng, phiên bản hợp lệ và lease hữu hạn còn hạn mới được mở Desktop.
- `UNLOCK_EVENT` kích hoạt lấy lại snapshot; **không** tự mở chỉ vì có gói SSE.
- Bộ cài xác minh cả trang `/scan/...` là HTML trên origin QLBV, tránh nhầm cổng backend.
- Client chỉ vẽ QR có URL hợp lệ và cùng origin đã cài, không tự bịa session/QR khi server lỗi. HTTPS dùng certificate validation chuẩn Windows, không có callback chấp nhận mọi chứng chỉ.

## 3. QR và chống dùng lại

1. Tạo QR ngẫu nhiên bằng UUID, default TTL **15 giây**, đọc `kiosk.qrExpiresSeconds` (10–600).
2. Tạo mới chỉ huỷ QR cũ của **cùng `(room, terminal)`**, không huỷ QR của PC khác chung phòng.
3. Điện thoại phải claim bằng token ổn định. Kiểm tra hạn và claim được thực hiện lại sau khi đọc cấu hình, tránh hai request tranh quyền qua đoạn `await`.
4. Lần scan đầu chốt `expiresAt = scannedAt + buffer` (`kiosk.faceVerifyBufferSeconds`, default 60, 10–300). Những request tiếp theo không kéo dài deadline.
5. SSE `SESSION_SCANNED` mang `sessionId`, `terminalId`, `expiresAt`, buffer và `serverTime`. Máy trạm bỏ nét QR, phủ **trắng đục** và đếm lùi. Không dùng blur/opacity có thể nhìn xuyên.
6. Status/refresh/reconnect giữ lại session đã scan; không phát lại QR trong lúc xác thực. Client có epoch để loại phản hồi WAITING cũ về sau event scan/lock.
7. Claim thiếu/sai thiết bị bị từ chối; lần mở trên thiết bị thứ hai vô hiệu hoá phiên. Không cho bỏ token ở đường `verify-face` để né claim.
8. AI trả kết quả sau hạn/phiên bị huỷ không được unlock. Các request AI có timeout; mutex per-session chặn xử lý frame trùng.

Các kiểm tra UA/referrer/WebView Android/iOS hiện có được giữ và gom logic server dùng chung. Chúng là phòng vệ heuristic, **không chứng thực nguồn Camera** hoặc bảo đảm chặn được mọi hình thức relay; xem giới hạn bảo vệ trong hướng dẫn triển khai.

## 4. Roster và lease mở Desktop

- Chỉ nhận phân công trong kỳ `CONG_BO`/`DA_CHOT`, phòng và nhân sự đang hoạt động.
- Đối chiếu đúng mã phòng; không match `PK01` bằng phép tìm chuỗi con vào `PK010`.
- Loại nghỉ phép, tính cả ngày kết thúc ca đêm. Bao gồm ngày trước/ngày hiện tại và ngày kế khi cần nhận ca sớm qua nửa đêm.
- Face/PAD thành công vẫn cần bác sĩ có ca trong khoảng `start - earlyCheckin` đến `end + lateCheckout`.
- Ghi `duty_attendance` kèm `slot_id`, `room_id`; giữ schema, API và nghiệp vụ lịch trực hiện có.
- Map lease dùng key `(roomCode, terminalId)`, không chỉ room. PC A unlock không làm PC B mở qua polling. Event bound với terminal **không fallback broadcast** nếu socket đích offline.
- SSE reconnect cho phép socket cũ/mới chồng nhau; đóng socket cũ không xoá socket mới.
- Mỗi status request đối soát lại lease với lịch đã công bố: sửa/huỷ ca, xoá phân công, thêm nghỉ phép sẽ thu hồi lease. Thay giờ kết thúc/grace cập nhật deadline.
- Server kiểm tra hết lease mỗi giây. Client có timer độc lập dựa trên giờ server để khoá đúng hạn, ngay cả khi SSE trễ. Sau resume luôn khoá trước rồi đối soát.
- Mất kết nối API: không giữ trạng thái mở không kiểm chứng, không hiển thị QR cũ. Hồi mạng: đồng bộ lại; lease cũ chỉ dùng nếu còn hợp lệ và được server xác nhận.

**Trạng thái QR/lease/SSE là in-memory của một API process**. Restart server làm các PC khoá/xác thực lại. Không tăng replica Kiosk API khi chưa thiết kế kho trạng thái chung; Redis hiện có không tự làm các Map này thành phân tán.

## 5. CNTT và bộ cài

- Hộp thoại PIN native từ nút hỗ trợ / nhấp logo 5 lần / Ctrl+Alt+Shift+F12.
- Không giữ PIN trong config hoặc nhị phân. Chỉ PIN do quản trị cấu hình (`kiosk.itMasterPin`, fallback env `IT_MASTER_PIN` khi DB rỗng).
- Bỏ các mật khẩu fallback cố định. PIN so sánh qua hash constant-time, giới hạn 5 lần thử/10 phút theo IP và đích máy trạm, có audit server.
- Lease CNTT có hạn ca; ngoài ca tối đa 4 giờ và không vượt bắt đầu ca kế tiếp. Mất server dùng bộ gỡ với Administrator, không mở bằng secret offline.
- Install kiểm tra trước, giữ stable ID khi cài lại cùng phòng, lưu Program Files/ProgramData với quyền phù hợp, một HKLM Run. Không cài nhiều startup task hay khoá registry dai dẳng.
- Migration dọn Agent cũ/profile Kiosk riêng, không kill mọi browser/HIS. Bộ cứu hộ không cần config/EXE còn nguyên và chạy được nhiều lần.
- Runtime không có local listener `/unlock`, không CORS localhost `*`, không tắt SSL validation.

## 6. Giới hạn và nghiệm thu bắt buộc

`WH_KEYBOARD_LL` là hook user-mode, không phải driver. Không chặn được Ctrl+Alt+Del, secure desktop, quản trị viên, startup gap hay can thiệp vật lý. WinForms + HKLM Run không thay thế Windows logon hoặc một thiết kế Windows kiosk/shell policy được quản trị đúng cách. Việc đạt yêu cầu khoá OS phải nghiệm thu trên tài khoản tiêu chuẩn/image Windows thật với chính sách phù hợp; không tuyên bố “chặn 100% cấp kernel”.

Không có kết quả benchmark/conformance của model AI hoặc thử phần cứng Windows từ kiểm thử mock/off-screen. Bộ test tự động là quality gate, không phải chứng nhận sản phẩm không lỗi. Checklist trước rollout nằm trong [hướng dẫn máy trạm](windows/HUONG_DAN_SU_DUNG.md).

## 7. Cập nhật hai VPS

VPS 1: từ thư mục ứng dụng đang vận hành, chạy **`sudo bash deploy/update.sh`**. Thay đổi backend/frontend được build theo cơ chế hiện có; cấu hình Compose truyền `SCAN_BASE_URL`, `PUBLIC_URL`, `IT_MASTER_PIN` đúng vào API. Không yêu cầu migration thủ công mới cho đợt chuyển WinForms này.

VPS 2: giữ các endpoint AI hiện có. Chỉ cập nhật microservice khi có thay đổi riêng của model/API; không gộp lại vào VPS 1. Chặn cổng 8001 khỏi truy cập công cộng, chỉ cho VPS 1 gọi.

Sau máy chủ, phân phối cùng một EXE cho các PC; mã phòng là tham số setup. Không clone terminal ID và không phân phối kèm PIN IT.
