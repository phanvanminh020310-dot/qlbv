# QLBS — Phần mềm Quản lý Bệnh viện

Hệ thống quản lý bệnh viện hợp nhất, gộp và viết lại từ hai hệ thống tiền nhiệm
[`sua-hsba`](https://github.com/pvminh94/sua-hsba) (Giấy đề nghị sửa hồ sơ bệnh án điện tử)
và [`bao-cao-khoa`](https://github.com/pvminh94/bao-cao-khoa) (Báo cáo công tác khoa).

> **Triết lý thiết kế:** *không set cứng*. Khoa/phòng, mẫu báo cáo, đối tượng số liệu, tiện ích,
> mẫu in, vai trò và quyền đều được tạo/sửa/xóa từ giao diện quản trị, không cần sửa mã nguồn.

---

## 1. Chức năng

| Nhóm | Chức năng |
|---|---|
| **Hồ sơ bệnh án** | Giấy đề nghị sửa HSBA điện tử · quy trình ký xác nhận điện tử nhiều bước (cấu hình được) · trả lại/gửi lại · lịch sử thao tác · xuất PDF đúng mẫu giấy |
| **Báo cáo khoa** | Khai báo mẫu báo cáo động (mục → nhóm dòng → dòng · đối tượng/cột nhập tay + cột tính theo công thức) · nhập số liệu theo ngày · xem báo cáo ngày/tuần/tháng/quý/năm/khoảng · tổng hợp toàn viện |
| **Báo cáo chuyên nghiệp** | Kết xuất Excel (.xlsx) · Word (.docx) · PDF · in trực tiếp · báo cáo lưu trữ (snapshot) |
| **Thiết kế bản in** | Trình thiết kế bản in kéo–thả: nhiều loại phần tử (văn bản, trường dữ liệu, bảng, đường kẻ, mã vạch/QR, ảnh, chữ ký, số trang) · thuộc tính chuyên sâu (font, cỡ, giãn dòng, khung, viền, canh lề, điều kiện hiển thị) · khổ giấy & lề · xem trước & xuất PDF · phiên bản hóa |
| **Quản trị** | Phân cấp đơn vị (Viện → Khối → Khoa → Phòng) · người dùng · vai trò · quyền chi tiết đến từng thao tác · phạm vi dữ liệu theo khoa · tạo khoa linh động · quản lý tiện ích |
| **Hạ tầng** | PostgreSQL · Redis cache · hàng đợi + tác vụ định kỳ (cron) · chỉ mục & tìm kiếm nâng cao · nhật ký kiểm toán · sao lưu/phục hồi · Docker |

---

## 2. Công nghệ

| Lớp | Công nghệ |
|---|---|
| Backend | **Node.js + TypeScript** · NestJS 11 · Drizzle ORM (type-safe SQL) |
| CSDL | **PostgreSQL 18** · chỉ mục B-tree/GIN · truy vấn tổng hợp bằng SQL thuần |
| Cache & Queue | **Redis** (ioredis) · BullMQ (hàng đợi + tác vụ định kỳ) |
| Frontend | **Next.js 15** (App Router) · React 19 · **shadcn/ui** · **Tailwind CSS 4** · responsive, tương thích nhiều màn hình (mobile → 4K) |
| Xuất/Nhập | ExcelJS (.xlsx) · docx (.docx) · pdfmake + pdf-lib (.pdf) · CSV/JSON |
| Triển khai | **Docker + Docker Compose** · Nginx · systemd |

---

## 3. Cấu trúc

```
qlbs/
├─ backend/            API NestJS + Drizzle ORM
│  ├─ drizzle/         Migration SQL (sinh tự động, áp dụng tự động)
│  ├─ scripts/         migrate · seed · create-admin · dev-postgres
│  └─ src/
│     ├─ common/       guards · decorators · filters · interceptors · pipes
│     ├─ config/       cấu hình theo môi trường
│     ├─ db/           schema (Drizzle) + kết nối
│     ├─ infra/        redis · cache · queue · storage
│     └─ modules/      auth · users · roles · departments · hsba · reports
│                      printing · documents · utilities · scheduler · audit · settings
├─ frontend/           Next.js 15 + shadcn/ui
├─ deploy/             Nginx · systemd · script cài đặt VPS
├─ docs/               Kiến trúc · API · phân quyền · triển khai · hướng dẫn
└─ docker-compose.yml  PostgreSQL + Redis + API + Web
```

---

## 4. Chạy nhanh

### 4.1. Bằng Docker (khuyến nghị)

```bash
# Cài trọn gói trên VPS bằng MỘT lệnh (tự cài Docker, sinh .env, tự kiểm tra):
sudo bash deploy/install.sh

# Hoặc cài tay:
cp .env.example .env          # sửa mật khẩu trước khi dùng thật
docker compose up -d --build
```

| Dịch vụ | Địa chỉ |
|---|---|
| Giao diện | http://localhost:3000 |
| API | http://localhost:4000/api |
| Tài liệu API (Swagger) | http://localhost:4000/api/docs |

### 4.2. Chạy trực tiếp (phát triển)

```bash
# 1) Backend
cd backend
cp .env.example .env
npm install
npm run db:generate           # sinh migration từ schema (chỉ cần khi sửa schema)
npm run db:migrate            # tạo bảng
npm run db:seed               # dữ liệu nền: quyền, vai trò, khoa mẫu, tài khoản admin
npm run dev                   # http://localhost:4000  · Swagger: /api/docs

# 2) Frontend (cửa sổ khác)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

> Chưa có PostgreSQL/Redis trên máy? Chạy chế độ nhúng để thử nhanh:
>
> ```bash
> cd backend
> npm run dev:postgres          # PostgreSQL nhúng (PGlite) lắng nghe ở cổng 55432
> # .env: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
> #       CACHE_DRIVER=memory   QUEUE_DRIVER=inline
> ```

**Kiểm tra nhanh sau khi chạy:** mở http://localhost:3000 → đăng nhập `admin` / `Admin@123`.

### 4.3. Tài khoản mặc định

| Tên đăng nhập | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `Admin@123` | Quản trị hệ thống (toàn quyền) |

> **Đổi mật khẩu ngay sau khi triển khai thật.**

Muốn xem giao diện với dữ liệu đầy đủ (phiếu ở mọi trạng thái, người dùng theo vai trò,
số liệu báo cáo của một khoa):

```bash
cd backend
npm run db:demo       # CHỈ dùng cho môi trường thử nghiệm
```

Sau khi chạy, đăng nhập thử: `khtb.lan` / `123456` (duyệt phiếu),
`tc.hoa` / `123456` (tài chính), `bs.minh` / `123456` (người đề nghị — chỉ thấy phiếu của mình).

### 4.4. Lệnh thường dùng (backend)

| Lệnh | Việc |
|---|---|
| `npm run dev` | chạy API ở chế độ theo dõi tệp |
| `npm run db:generate` | sinh migration từ schema sau khi sửa bảng |
| `npm run db:migrate` | áp dụng migration còn thiếu |
| `npm run db:seed` | dữ liệu nền (quyền, vai trò, khoa mẫu, admin) — an toàn khi chạy lại |
| `npm run db:demo` | dữ liệu mẫu để xem giao diện |
| `npm run db:backfill-search` | dựng lại chuỗi tìm kiếm không dấu cho phiếu cũ |
| `npm run typecheck` | kiểm tra kiểu TypeScript |

---

## 5. Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [docs/KIEN-TRUC.md](docs/KIEN-TRUC.md) | Kiến trúc, sơ đồ CSDL, luồng nghiệp vụ |
| [docs/PHAN-QUYEN.md](docs/PHAN-QUYEN.md) | Danh mục quyền, vai trò mặc định, phạm vi dữ liệu |
| [docs/API.md](docs/API.md) | Danh mục endpoint |
| [docs/TRIEN-KHAI.md](docs/TRIEN-KHAI.md) | Triển khai Docker/VPS, sao lưu, nâng cấp |
| [docs/HUONG-DAN-SU-DUNG.md](docs/HUONG-DAN-SU-DUNG.md) | Hướng dẫn theo vai trò người dùng |


---

## 6. Giấy phép

MIT — xem [LICENSE](LICENSE).

## Kiosk phòng khám — WinForms độc lập

Máy trạm dùng một `QLBS_Kiosk.exe`, không cần Edge/WebView hay Agent phụ.
QR native 15s, che trắng sau scan, buffer xác thực cấu hình được, đối soát lịch trực,
unicast đúng máy, tự khoá theo ca và trả hoàn toàn Desktop khi mở.

- [Cài từng phòng / triển khai hàng loạt / cứu hộ CNTT](deploy/windows/HUONG_DAN_SU_DUNG.md)
- [Kiến trúc hai VPS và giao thức máy trạm v2](deploy/KIOSK_ATTENDANCE_ARCHITECTURE.md)
- [Kết quả kiểm thử và các mục còn phải nghiệm thu Windows](deploy/windows/KIEM_THU_V2.md)
- Workflow `Kiosk standalone quality gate` tạo gói Windows có EXE và SHA-256 khi các gate đều đạt.

Khoá WinForms là bảo vệ user-mode, không phải kernel/Windows secure desktop;
Ctrl+Alt+Del và chính sách OS phải được quản trị và nghiệm thu riêng.
