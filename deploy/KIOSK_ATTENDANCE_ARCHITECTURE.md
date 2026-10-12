# KIẾN TRÚC HỆ THỐNG ĐIỂM DANH SINH TRẮC HỌC VÀ MỞ KHOÁ PHÒNG KHÁM (2-VPS TOPOLOGY)

Hệ thống điểm danh bác sĩ và kiểm soát máy trạm phòng khám hoạt động theo mô hình phân tán 2 VPS:

```
┌────────────────────────────────────────────────────────┐         ┌───────────────────────────────────────────────────────┐
│                    VPS 1 (ỨNG DỤNG BỆNH VIỆN)          │         │                  VPS 2 (AI MICROSERVICE)              │
│                 pvminh94/qlbv (Port 3000 & 5000)       │         │           pvminh94/qlbs-attendance-web (Port 8001)   │
│                                                        │         │                                                       │
│  ┌───────────────────────┐   ┌───────────────────────┐ │         │  ┌──────────────────────────────────────────────────┐ │
│  │    Next.js 15 UI      │   │     NestJS API        │ │  HTTP   │  │              FastAPI AI Service                  │ │
│  │   /kiosk/[roomCode]   │   │  /api/kiosk/*         │─┼─────────┼─▶│  /detect-face       - Trích xuất khuôn mặt    │ │
│  │   /scan/[sessionId]   │   │  - QR Session Manager │ │  Port   │  │  /verify-liveness   - Thử thách ISO 30107     │ │
│  └───────────────────────┘   │  - SSE Real-time Sync │ │  8001   │  │  /compare-face      - So khớp ArcFace vector  │ │
│                              │  - Direct DB Duty Chk │ │         │  └──────────────────────────────────────────────────┘ │
│                              └───────────┬───────────┘ │         │                                                       │
│                                          │             │         │  - Tách biệt tải AI nặng (ArcFace, ONNX, OpenCV)     │
│                                          ▼             │         │  - Không ảnh hưởng đến CPU/RAM máy chủ bệnh viện      │
│                              ┌───────────────────────┐ │         └───────────────────────────────────────────────────────┘
│                              │   PostgreSQL (QLBV)   │ │
│                              │  - duty_assignments   │ │
│                              │  - user_biometrics    │ │
│                              │  - duty_attendance    │ │
│                              └───────────────────────┘ │
└────────────────────────────────────────────────────────┘
                       ▲                     ▲
            SSE Stream │                     │ HTTP Scan
                       │                     │
       ┌───────────────┴───────────────┐  ┌──┴────────────────────────┐
       │   Máy tính Windows phòng khám │  │ Smartphone Bác sĩ         │
       │   Edge / Chrome Kiosk (Full)  │  │ Quét QR -> Camera Liveness│
       │   Tự động mở khóa Desktop     │  │ WebRTC Canvas ISO 30107   │
       └───────────────────────────────┘  └───────────────────────────┘
```

---

## 1. PHÂN CÔNG TÀI NGUYÊN & MÔ HÌNH TRIỂN KHAI

### VPS 1: Máy chủ Hệ thống Bệnh viện (`pvminh94/qlbv`)
- **Vai trò:** Vận hành toàn bộ phần mềm QLBV (Quản lý bệnh nhân, viện phí, kho dược, lịch trực khám bệnh, Kiosk phòng khám).
- **Thành phần:**
  - **Backend (Port 5000):** NestJS + Drizzle ORM + PostgreSQL + Redis.
  - **Frontend (Port 3000):** Next.js 15.
    - Giao diện Kiosk máy trạm: `/kiosk/[roomCode]` (Ví dụ: `/kiosk/PK01`).
    - Giao diện Bác sĩ quét mặt: `/scan/[sessionId]`.
- **Cơ chế kiểm tra lịch trực:** Truy vấn trực tiếp các bảng `duty_assignments`, `duty_rooms`, `duty_slots`, `duty_shift_types` trong CSDL PostgreSQL. Độ trễ 0ms, không phụ thuộc API ngoài.
- **Lưu trữ sinh trắc học an toàn:** Vector đặc trưng khuôn mặt (512 chiều) được mã hóa bằng chuẩn AES-256-CBC trong bảng `user_biometrics`.

### VPS 2: Máy chủ Microservice Trí tuệ Nhân tạo (`pvminh94/qlbs-attendance-web`)
- **Vai trò:** Microservice AI chuyên trách nhận diện khuôn mặt và phát hiện giả mạo (Anti-Spoofing / PAD).
- **Thành phần:**
  - **FastAPI Container (Port 8001):** Kiến trúc stateless siêu nhẹ, tự khởi động lại qua Docker Compose.
  - **Mô hình AI:** ArcFace 512-dim embedding kết hợp thuật toán kiểm tra chuyển động mắt/khuôn mặt và tán xạ ánh sáng (Screen Flash Reflection) theo chuẩn ISO/IEC 30107-3 PAD.
- **Ưu điểm:** Tách tải tính toán ma trận AI ra khỏi VPS chính của bệnh viện; VPS chính luôn mượt mà phục vụ khám chữa bệnh.

---

## 2. QUY TRÌNH MỞ KHOÁ MÁY TRẠM PHÒNG KHÁM

1. **Khởi động máy tính phòng khám:**
   - Kịch bản Windows Kiosk tự động chạy trình duyệt toàn màn hình (`--kiosk --edge-kiosk-type=fullscreen`) mở trang `http://<IP_VPS_1>:3000/kiosk/PK01`.
   - Windows bị khoá các phím nguy hiểm (Win+D, Task Manager, Alt+Tab, cử chỉ vuốt mép màn hình).
   - Máy trạm hiển thị mã QR động (tự đổi sau mỗi 90 giây) và thiết lập kết nối Server-Sent Events (SSE) tới `/api/kiosk/events/PK01`.

2. **Bác sĩ đến nhận ca trực:**
   - Dùng Camera điện thoại quét mã QR trên màn hình máy tính.
   - Trình duyệt điện thoại mở trang quét khuôn mặt `/scan/<sessionId>`.
   - Bác sĩ thực hiện thử thách người thật (Chớp mắt tự nhiên / Giữ thẳng mặt).

3. **Xác thực và Đối soát:**
   - Điện thoại gửi ảnh chụp về VPS 1 (`/api/kiosk/verify-face`).
   - VPS 1 gọi sang VPS 2 (Port 8001) để lấy vector đặc trưng và kiểm tra PAD.
   - VPS 1 giải mã vector gốc của Bác sĩ trong PostgreSQL, tính khoảng cách Cosine Similarity.
   - Nếu độ tương đồng $\ge 0.60$ và Bác sĩ có lịch trực hợp lệ tại phòng khám này trong khung giờ hiện tại:
     - VPS 1 ghi nhật ký điểm danh vào bảng `duty_attendance`.
     - VPS 1 phát sự kiện SSE `UNLOCK_EVENT` tới máy trạm.

4. **Giải phóng Desktop máy trạm:**
   - Trình duyệt tại máy tính phòng khám nhận sự kiện mở khoá, tự động thoát chế độ toàn màn hình (`exitFullscreen()`).
   - Thanh công cụ Kiosk thu nhỏ thành Mini Dock ở góc màn hình.
   - Bác sĩ có toàn quyền thao tác trên màn hình Desktop Windows và các phần mềm chuyên môn.
   - Khi hết ca hoặc rời phòng, Bác sĩ chỉ cần bấm nút **"Khoá máy / Rời phòng"** trên Mini Dock để kích hoạt lại chế độ bảo vệ.

---

## 3. CƠ CHẾ BẢO VỆ MÁY TRẠM & BẢN CÀI ĐẶT WINDOWS NATIVE AGENT

Tại thư mục `deploy/windows/`, hệ thống được trang bị kiến trúc **Windows Native Kiosk Agent** chuyên dụng:
1. `QLBS_Kiosk_Agent.cs`: Mã nguồn C# .NET siêu nhẹ (~3MB), biên dịch trực tiếp bằng `csc.exe` có sẵn trên mọi máy tính Windows 10/11.
   - **Khóa bàn phím cấp độ nhân (Low-Level Hook `WH_KEYBOARD_LL`)**: Chặn 100% phím `Windows`, `Alt+Tab`, `Alt+F4`, `Ctrl+Esc`, `Ctrl+Shift+Esc`, Task Manager.
   - **Giải phóng Desktop tức thì trong 0.05 giây**: Khi bác sĩ xác thực thành công, Agent lập tức đóng cửa sổ Kiosk, giải phóng 100% màn hình Desktop sạch sẽ cho bác sĩ làm việc mà không để lại bất kỳ khung mờ hay canvas nào.
   - **Tự động khóa lại khi hết ca**: Theo dõi thời gian kết thúc ca trực (+ thời gian ân hạn `kiosk.lateCheckoutMinutes`), tự động bật lại toàn màn hình khóa để đón bác sĩ ca tiếp theo.
   - **Phím nóng IT khẩn cấp**: Bấm `Ctrl + Alt + Shift + F12` (hoặc nhấp 5 lần vào Logo Bệnh viện) để mở bảng nhập Master PIN IT cứu hộ máy trạm.
2. `cai_dat_kiosk.bat`: Cài đặt trọn gói A-Z: cấu hình IP, mã phòng khám, tự biên dịch Agent ra `.exe`, khóa Task Manager, và đăng ký tự khởi động cùng Windows.
3. `go_bo_kiosk.bat`: Kịch bản dự phòng cho bộ phận IT khi cần bảo trì hoặc gỡ bỏ triệt để Kiosk, khôi phục 100% cài đặt mặc định của Windows trong 2 giây.

---

## 4. QUY TRÌNH TRIỂN KHAI VÀ CẬP NHẬT HỆ THỐNG

### Trên VPS 2 (AI Microservice Container)
```bash
git clone https://github.com/pvminh94/qlbs-attendance-web.git /opt/qlbs-attendance-web
cd /opt/qlbs-attendance-web
docker compose up -d --build
```

### Trên VPS 1 (Ứng dụng QLBV — Cập nhật chuẩn qua update.sh)
Hệ thống QLBV được đóng gói tự động hóa hoàn toàn với Docker Compose. Khi có mã nguồn mới, **chỉ cần chạy duy nhất 1 lệnh**:

```bash
cd /opt/qlbs   # (hoặc thư mục chứa mã nguồn QLBV)
sudo bash deploy/update.sh
```

**Cách thức `update.sh` tự động xử lý ngầm:**
1. **Tự động `git pull`:** Kéo nhánh mới nhất mà không cần thao tác git thủ công.
2. **Tự động phát hiện thay đổi:** Nhận biết thay đổi ở `backend/` và `frontend/` để kích hoạt dựng lại dịch vụ tương ứng (`qlbs-api` và `qlbs-web`) với BuildKit cache.
3. **Tự động chạy Migration CSDL:** Khi container `qlbs-api` khởi động, entrypoint trong `backend/Dockerfile` tự động kích hoạt `scripts/migrate.ts` để áp dụng ngay các tệp migration mới (`0019_kiosk_duty_attendance.sql`) vào PostgreSQL. Người quản trị không cần gõ lệnh migration thủ công.
4. **Tự động kiểm tra sức khỏe:** Kiểm tra điểm cuối `/health` của API và trang web đăng nhập trước khi hoàn tất thông báo `✓ Cập nhật xong`.

*(Nếu muốn đổi IP kết nối tới VPS 2, thêm dòng `AI_SERVICE_URL=http://<IP_VPS_2>:8001` vào file `.env` tại thư mục gốc trước khi chạy `update.sh`).*

