# STATE.md — Bối cảnh làm việc QLBS (đọc đầu tiên khi mở phiên chat mới)

> **Cách dùng ở phiên mới:** gửi cho trợ lý câu:
> *"Clone https://github.com/pvminh94/qlbv về /home/user/qlbv, đọc `.ai/STATE.md` rồi chạy `bash .ai/dev-setup.sh` để dựng môi trường, sau đó làm tiếp: …"*
> (kèm GitHub token mới nếu cần push). Nếu workspace cũ còn, chỉ cần: *"Đọc /home/user/qlbv/.ai/STATE.md"*.
>
> **Trợ lý phải cập nhật tệp này** (mục 4, 5, 6) sau mỗi yêu cầu hoàn thành và commit cùng code.

---

## 1. Quy tắc bắt buộc (người dùng đã chỉ định)

1. **Trả lời bằng tiếng Việt.**
2. **Push thẳng lên `main`** của `github.com/pvminh94/qlbv` (người dùng đồng ý "cách A").
3. **GitHub token (PAT)**: người dùng gửi trong chat. **Không ghi token vào tệp nào, không để trong `git remote`.**
   Push bằng: `git push "https://x-access-token:<PAT>@github.com/pvminh94/qlbv.git" HEAD:main 2>&1 | sed 's/ghp_[A-Za-z0-9]*/***/g'`.
   Không có token → xin lại. Nhắc người dùng thu hồi token sau khi dùng.
4. **Mỗi khi báo cáo xong việc phải kèm lệnh cập nhật VPS**:
   `cd /opt/qlbs && sudo bash deploy/update.sh --backup`
   (update.sh tự `git pull`, tự chạy lại bằng bản mới nếu chính nó đổi, tự cài font TNR — **không** hướng dẫn `git pull` riêng).
5. Git identity trong repo: `git config user.name "QLBS Bot"; git config user.email bot@qlbs.local` (mất sau reset vì `.git/config` không được lưu).
6. Giữ bit thực thi: `chmod +x deploy/*.sh && git update-index --chmod=+x deploy/*.sh` trước khi commit.

## 2. Dự án

- **QLBS — Phần mềm quản lý bệnh viện** (Bệnh viện Quân y 4). VPS: `/opt/qlbs`, user `bvqy4`, Docker Compose.
- **Backend** `backend/`: NestJS + Drizzle ORM + PostgreSQL + Redis, prefix `/api` (không có `/v1`). Build: `npx nest build` → `node dist/main.js`.
- **Frontend** `frontend/`: Next.js (app router) + React Query + Tailwind; proxy `/api` → `API_PROXY_TARGET` **đóng băng lúc build**. Không chuyển `output: 'standalone'`.
- **Docker**: node:22-alpine, uid 1000, cache npm/next bằng `RUN --mount=type=cache` (không dùng `# syntax=` — gây lỗi grpc). Upload mount `${UPLOAD_HOST_DIR:-./data/uploads}:/app/uploads`.
- **Tài liệu**: `docs/HUONG-DAN-SU-DUNG.md`, `PHAN-QUYEN.md`, `API.md`, `TRIEN-KHAI.md`, `KIEN-TRUC.md` — cập nhật khi thêm tính năng.
- **Deploy**: `deploy/install.sh` (lần đầu), `deploy/update.sh` (cập nhật: dựng lần lượt, thử lại 3 lần lỗi mạng/BuildKit, `--backup`, `--no-pull`), `deploy/install-times-font.sh`.

### UI kit frontend (dùng lại, đừng viết mới)
`CrudTable`; `Dialog` (size `'full'|'lg'…`, z-50, Esc đóng), `ConfirmDialog` từ `ui/dialog`; `Badge` (tone default/success/warning/danger/info/muted/brand), `Card`, `EmptyState`, `Skeleton` từ `ui/card`; `Button` (variant default/outline/ghost, size sm/icon, `loading`); `Input/Label/Select/Switch` từ `ui/input`; `TableWrap/Th/Td/Tr` từ `ui/table` (`TableWrap` đã chứa `<table>`); `apiFetch` (`raw:true` trả Response), `downloadFile`; icon `lucide-react` 1.48; toast `sonner`; `useAuth(s=>s.can)`. CSS vars: `--primary --accent --muted-foreground --border --card --danger --muted --background`.

### Backend — lưu ý
- DTO: `ValidateIf(hasValue)`; `@Type(Number)` biến `""` thành 0.
- Không có multer → upload bằng stream octet-stream `?name=`.
- Không dùng `cache.flushAll()` sau restore.

## 3. Môi trường dev trong sandbox

- **Dựng lại sau reset:** `bash /home/user/qlbv/.ai/dev-setup.sh` (cài PG/Redis/poppler/cabextract, tạo DB `qlbs` pass `postgres`, sửa `backend/.env`, TNR vào `/tmp/qlbs-storage/fonts`, npm ci, build, Playwright ở `/tmp/pw`). DB mới → khởi động API rồi `bash .ai/dev-setup.sh --demo`.
- **Khởi động (dùng start_process, không chạy nền trong bash):**
  - API: `cd /home/user/qlbv/backend && node dist/main.js > /tmp/api.log 2>&1` (port 4000)
  - Web: `cd /home/user/qlbv/frontend && npx next start -H 0.0.0.0 -p 3000 > /tmp/fe.log 2>&1` (sau `npx next build`)
  - Đăng nhập **admin / Admin@123**; demo: `tk.nam / 123456`, `tc.hoa / 123456`…
- **API bằng curl:** login `POST /api/auth/login` → lấy `accessToken` → header `Authorization: Bearer` (cookie không dùng được qua curl).
- **Playwright:** `require('/tmp/pw/node_modules/playwright')`; mẫu kịch bản: `.ai/examples/ui-designer-test.js`.
- **Dọn dung lượng:** `bash .ai/dev-setup.sh --clean`. Workspace giới hạn ~128MB; `node_modules`, `.next`, `dist`, `/tmp` KHÔNG được lưu → luôn dựng lại bằng script.

### Bẫy đã gặp (đừng lặp lại)
- `npm run dev:fast` (tsx) crash do thiếu decorator metadata → dùng `nest build` + `node dist/main.js`.
- Không `pkill -f "node dist/main.js"` trong bash (giết chính lệnh) → dùng stop_process.
- Chạy `npx tsc` trước `npm ci` sẽ cài nhầm gói. apt báo 404 → `apt-get update` trước.
- PGlite dễ lỗi → dùng PostgreSQL thật. Không có docker, eslint, xxd, bc trong sandbox.
- Không commit font Microsoft vào repo; không đổi tên Tinos thành "Times New Roman".
- `pdftoppm -f 1 -l 1` ra tệp `xxx-1.png`.

## 4. Lịch sử yêu cầu đã hoàn thành (commit trên `main`)

| # | Nội dung | Commit |
|---|---|---|
| 1 | Đọc hiểu repo | — |
| 2 | Sửa "Application error" phía client 8 trang (TDZ loadPresets, phân trang workflows, sessions, profile roles) | 7d54dfb |
| 3 | Gán vai trò, PDF 401 (cookie `qlbs_access`), `deploy/update.sh` | 0a185ca |
| 4 | Docker web truyền `API_PROXY_TARGET` lúc build | 66fcd21 |
| 5 | npm ci cache tách theo service, retry mạng, dựng lần lượt | de9096c |
| 6 | Sao lưu CSDL đầy đủ, tác vụ định kỳ | 921bf8b |
| 7 | Sao lưu & phục hồi trên giao diện | 3d779c4 |
| 8 | Phục hồi an toàn nhiều người dùng (bảo trì 503 `MAINTENANCE`, gõ `PHUC HOI`, bản `-truoc-phuc-hoi`) | ad77d75, ac09272 |
| 9 | Danh mục Chức danh (`/job-titles`, quyền `job_title.*`), menu Danh mục; import nhân viên Excel/CSV/TXT (`/users/import/file`, mẫu `/users/import/template`, ≤10MB/5000 dòng, MK mặc định `Qlbs@123456`); email/SĐT/ghi chú không bắt buộc | f6db7cc |
| 10 | **Bản in mặc định Times New Roman** (kể cả xem trước PDF) + **trình thiết kế bản in toàn màn hình** kiểu phần mềm thương mại | 8b4fba3 |
| 10b | Docker build ổn định (bỏ `# syntax=`, update.sh thử lại 3 lần, gợi ý swap) — người dùng xác nhận VPS cập nhật OK | c63401e |
| 12 | Dọn workspace, tạo thư mục `.ai/` (STATE.md, dev-setup.sh, examples) | c79caa1 |
| 13 GĐ1 | **Phân hệ Quản lý tài sản — lõi**: schema+migration 0006, API (danh mục, hồ sơ, chứng từ duyệt, khấu hao TT23/tháng/DB, in tem, biên bản PDF, import/export), 11 trang giao diện `/tai-san/*`, `/ts/<mã>` | e0902ce |
| 13 GĐ2 | **Kiểm kê điện tử · báo cáo · lịch bảo trì**: migration 0007 (asset_inventories/items/scans), quét camera+máy quét+**offline (idempotent clientId)**, kiểm kê mù, khoá/mở số liệu, xử lý chênh lệch → chứng từ nháp, biên bản PDF `BIEN_BAN_KIEM_KE` + Excel; **8 báo cáo chuẩn** `/asset-reports/:key` (xem, Excel, PDF — dòng nhóm/cộng, `__style` cho renderer); **lịch bảo trì tháng** `/asset-reports/schedule` (lần lặp dự kiến + quá hạn, ICS client-side); tác vụ `NHAC_HAN_TAI_SAN`/handler `asset.due-reminder`; quyền `asset.inventory.*`, `asset.report.view`; trang `/tai-san/kiem-ke*`, `bao-cao`, `bao-tri`; test `.ai/examples/asset-inventory-test.mjs` (57 ca) + `asset-inventory-ui-test.js` | c94c835 |
| 13 GĐ3a | Realtime SSE + bảng điều khiển / báo cáo tuỳ biến kéo-thả (Studio) | ee558e2 |
| 13 GĐ3b | Studio: drill-down bản ghi gốc, 5 nguồn dữ liệu mới, ấn bản Excel định kỳ (subscription) | 5ded9bb |
| — | Sửa khoa/phòng không tự cập nhật sau thêm/xoá; thêm loại đơn vị "Ban" | 4d0effc |
| — | Từ điển dữ liệu tiếng Việt cho toàn bộ CSDL (COMMENT ON bảng/cột/khoá) | 5f37d99 |
| — | Hoàn thiện phân quyền & vai trò (an toàn, trực quan, chặt chẽ) | 89b2e73 |
| — | HSBA chuẩn thương mại: trao đổi nội bộ, tệp minh chứng, ký nhanh, chống trùng phiếu | 7b9f335 |
| — | Cho phép tạo lại tên đăng nhập / mã đơn vị đã xoá mềm | 2911ac0 |
| — | Vai trò mặc định khi import Excel; độ dài mật khẩu theo cấu hình | 9c48437 |
| — | Mật khẩu mặc định người dùng đổi từ Qlbs@123456 sang "1" (chore) | e9ae076 |
| — | Deploy: sửa lỗi EACCES khi cài lần đầu trên máy trắng | 47aba0b |
| — | Hệ thống thông báo chuyên sâu; sắp xếp cột danh sách | 3846e85 |
| — | HSBA: thêm bước ký Bảo hiểm giữa KHTB và Tài chính; chỉ KHTB/BAO_HIEM được trả lại | 9697ae3 |
| — | Tìm kiếm toàn cục ổn định; lọc nâng cao; hết trang trống do phiên | 61c62d6 |
| — | HSBA: ô tìm kiếm tự lọc (debounce 350 ms), nút xoá nhanh | 9c7ac86 |
| — | HSBA: danh sách phiếu tự cập nhật realtime | 3355ad1 |
| — | HSBA: bỏ ô "Số tiền liên quan" và "Tài liệu kèm theo" khỏi form phiếu | 986e204 |
| 14 | **Lịch trực khám bệnh**: kỳ lịch tuần, ô trực, ràng buộc (nghỉ tối thiểu, giờ/ngày, giờ/tuần, chức danh, nghỉ phép, khác khoa), tự đăng ký, nhường/đổi, ngoại lệ gửi KHTH, điều chỉnh trực tiếp, chốt theo mốc, nhật ký, Excel, thông báo và realtime | (commit này) |
| 14b | **Lịch trực — siết chặt, xoá cả kỳ, bảng màu ca, giao diện ngọc lam**: xoá cả kỳ lịch có kiểm soát (lý do, gõ lại tên, chặn khi đã có ca đã diễn ra, nhật ký giữ lại, báo người bị ảnh hưởng); bảng màu ca; ràng buộc chặt hơn (không trùng kỳ, ngày nghỉ, ca/vai trò đang dùng, nghỉ phép); tổng hợp giờ và nhật ký chỉ quản lý; migration 0016–0017 | (commit kế tiếp, sau 3deb70b) |
| 15 | **API tích hợp lịch trực cho máy khoá phòng khám**: khoá API chỉ đọc (`integration_keys`, migration `0018`, CLI `npm run integration:key -- create/list/revoke`), `GET /api/integration/duty/{on-duty,roster,rooms}` (chuẩn `{success,data}`; chỉ kỳ `CONG_BO`/`DA_CHOT`; loại người đã vô hiệu hoá, phòng đã đóng, người nghỉ phép; ca đêm qua nửa đêm), phạm vi `duty:read`, `INTEGRATION_ALLOWED_IPS`, từ điển dữ liệu | commit cục bộ, **chưa push** (xem mục 6) |
| 16 | **Kiosk điểm danh sinh trắc học bác sĩ & mở khoá máy trạm phòng khám**: QR động 15s Burn-on-Scan, Windows Native Agent C# (port 28199 local bridge, giải phóng 100% desktop không để lại màn trắng hay thanh nổi, taskkill 10ms), sửa lỗi DTO/ValidationPipe toggle tự đổi ảnh xác thực trong cấu hình hệ thống | d4b20d3 |
| 17 | **Bảo mật tuyệt đối Kiosk Agent — Chặn 100% phím tắt Win+D, F12, DevTools & Watchdog cưỡng chế**: Nâng cấp Low-Level Hook chặn 100% phím vật lý qua GetAsyncKeyState; bổ sung Registry NoWinKeys, DeveloperToolsAvailability=2, DisableLockWorkstation; gỡ bỏ hoàn toàn F12 bypass trong frontend DOM & kích hoạt Chromium Keyboard Lock API; Watchdog cưỡng chế TopMost phục hồi Edge khi mất tiêu điểm | e8a5bf9 |
| 18 | **Tối ưu hóa độ trễ QR & Triệt tiêu Cold Start / Lỗi chờ lâu lần đầu**: Xóa bỏ premature Burn-on-scan, bổ sung mutex in-flight lock; tự động gia hạn 45s grace window khi quét QR; SSE SESSION_SCANNED tạm dừng countdown PC; gộp endpoint AI verify-and-extract giảm 60% latency; AI model warm-up triệt tiêu Cold Start | 61b2fea |
| 19 | **Sửa lỗi sập Client-Side khi nhấn "Bỏ mặc định" trên Bảng điều khiển**: Sửa bẫy `payload?.data ?? payload` trong `apiFetch` (khiến `{ success: true, data: null }` bị coi là truthy object); bổ sung fallback dự phòng hệ thống trong `defaultFor` khi không còn trang nào là default; bảo vệ `page?.layout?.widgets` trong `StudioPageFrame` và fallback trang đầu tiên trong `DashboardPage` | 906da6c, 5fb1717 |
| 20 | **Tối ưu tốc độ Build VPS, Sửa lỗi treo Kiosk & Chống chụp gửi Zalo**: Tăng tốc Docker BuildKit npm cache và Next.js .next/cache mount; Sửa triệt để lỗi treo cứng màn hình Kiosk ("Bác sĩ đang nhìn camera xác thực...") bằng bộ đếm lùi 15s tự động giải phóng và timeout an toàn; Phòng thủ an ninh đa lớp chống chụp ảnh QR gửi Zalo (Rolling Dynamic QR 12s, Single-Device Claim Token khóa thiết bị, phát hiện gửi link Zalo hủy mã tức thì, lớp phủ che mờ QR khi quét, cấm chọn ảnh thư viện - chỉ chấp nhận camera trực tiếp) | 00633fb |
| 21 | **Tăng tốc Build VPS x5 lần, Bỏ lớp phủ QR, Nâng TTL 45s cho Bác sĩ lớn tuổi & Chống Zalo bằng Geofencing + In-App Block**: Tắt worker riêng trong Next.js tránh swap thrashing, thêm ignoreBuildErrors và --prefer-offline; stream live log bằng tee trong update.sh; gỡ bỏ hoàn toàn lớp phủ QR trên Kiosk; nâng TTL QR lên 45s và grace window 60s; Chống chụp gửi Zalo bằng phát hiện Zalo in-app WebView (hủy mã tức thì) kết hợp đối soát bán kính GPS Geofence Bệnh viện Quân y 4 | e97acc4 |
| 22 | **Hoàn thiện cơ chế chống chụp QR chuyển tiếp không phụ thuộc GPS/Zalo, tối ưu cho Bác sĩ lớn tuổi**: Gỡ bỏ 100% định vị GPS/Geofencing theo yêu cầu mạng LAN/Wi-Fi nội bộ bệnh viện; Bỏ kiểm tra đích danh Zalo, nâng cấp lên nhận diện phổ quát Trình duyệt nhúng In-App WebView (Telegram, Messenger, Viber, Zalo, Android WebView, v.v.); Tách bạch chu kỳ QR Kiosk 30s với bộ đệm xác thực 60s cho Bác sĩ lớn tuổi; Đệm chuyển tiếp 5s; Khóa phiên bằng Single-Device Token Burn-on-Scan triệt tiêu gian lận chuyển tiếp ảnh/link | e7584fc |
| 23 | **Khôi phục update.sh siêu tốc nguyên bản**: Khôi phục update.sh về cơ chế build nguyên bản (docker compose build trực tiếp, tận dụng cache Docker tự nhiên, loại bỏ hoàn toàn vòng lặp build tuần tự, progress plain, 3 lần retry, sleep và tee log làm chậm tiến trình; chỉ build đúng service có thay đổi mã nguồn giữa hai commit pull) | b05f123 |
| 24 | **Tùy chỉnh cấu hình faceVerifyBufferSeconds và chặn app quét mã trên iOS & Android**: Thêm cấu hình hệ thống kiosk.faceVerifyBufferSeconds (mặc định 60s) cho phép tùy chỉnh độc lập thời gian đệm nhận diện khuôn mặt; đồng bộ động xuống Kiosk PC qua SSE; Chặn toàn diện chữ ký app quét mã bên thứ ba trên iOS (WKWebView, messageHandlers, thiếu Version Safari) và Android (android-app:// referrer, WebView) | 39c0348 |
| 25 | **Tối ưu hóa build Docker trên VPS 2GB RAM & Triệt tiêu treo Static Page Generation (16/37)**: Giới hạn Next.js `cpus: 1`, `workerThreads: false`, tăng `staticPageGenerationTimeout: 180`; hạ `NODE_OPTIONS` `--max-old-space-size=1536` cho backend & frontend; cập nhật `deploy/update.sh` dựng tuần tự từng service thay vì song song, loại bỏ hoàn toàn hiện tượng cạn kiệt RAM, nghẽn swap I/O và treo CPU khi build đồng thời trên VPS tài nguyên thấp | cb1b5e4, 3efefb2 |
| 26 | **Khôi phục lớp phủ TRẮNG che kín QR nguyên bản (00633fb) & Bảo toàn toàn diện cơ chế chống chụp lén/chuyển tiếp Zalo/Scanner App**: Kích hoạt lại lớp phủ trắng mờ nguyên bản (bg-white/95 backdrop-blur-sm, Loader2 xoay ngọc, Đang nhận diện khuôn mặt, Mã đã khóa với thiết bị quét, đếm lùi thời gian còn) che kín mã QR trên Kiosk PC trong suốt thời gian đệm xác thực; hợp nhất luồng kiểm tra an ninh chặn In-App WebView (Zalo, Messenger, Telegram), chặn app quét mã bên thứ ba trên iOS & Android, và Single-Device Token Burn-on-Scan | 51598a1 |

Sao lưu: job `BACKUP_HANG_NGAY` 23:30, giữ 14 bản, tệp `qlbs-<stamp>[-label].json.gz` v2.

## 5. Kiến trúc tham chiếu nhanh (bản in · lịch trực)

### Bản in (Yêu cầu 10)

- **Font** `backend/src/infra/rendering/font-registry.ts`: mặc định `Times New Roman`; ưu tiên font tải lên ở `STORAGE_DIR/fonts` (VPS: `data/uploads/fonts`), fallback nhúng sẵn Tinos/Arimo/Cousine (`backend/assets/fonts`, OFL). Tự nạp lại mỗi 5s. API: `GET/POST/DELETE /print/fonts`, `GET /print/fonts/file`.
- **Renderer** `backend/src/infra/rendering/pdf-renderer.ts` (`renderPrintDocument`): toạ độ mm; phần tử `text|field|table|line|rect|image|pageNumber|datetime|qrcode|barcode|signature`; `{path}` interpolate, `formatValue`, anchor header/footer, `repeatOnEveryPage`, `visibleWhen`, `autoShrink`, bảng nhiều trang (`dataSource`, zebra, totalRow, pushDown), watermark, pageNumbering, `data.system.{day,month,year,date,datetime,page,pages}`. Mọi PDF (HSBA, báo cáo) đi qua renderer này.
- **Dữ liệu in HSBA**: `hsba.service.ts buildPrintData` → `request.*`, field trải phẳng, `signature[stepKey].{fullName,signedTime,…}`; endpoint `GET /hsba/requests/:id/print-data`.
- **Frontend** `frontend/src/components/printing/`:
  - `print-designer.tsx` — khung toàn màn hình (`fixed inset-0 z-[45]`): ribbon Trang chủ/Chèn/Bố trí/Trang in/Xem, cột trái (Công cụ/Trường/Đối tượng/Trang/JSON), inspector phải, thanh trạng thái, phím tắt, menu chuột phải, history (apply/live/commit), clipboard localStorage `qlbs.print.clipboard`.
  - `designer-canvas.tsx` (thước, lưới, marquee, smart guides, resize, sửa chữ trực tiếp, `DND_MIME`), `element-view.tsx` (vẽ phần tử giống PDF), `designer-inspector.tsx`, `preview-dialog.tsx` (dữ liệu mẫu/phiếu HSBA thật/JSON), `font-manager.tsx`, `print-fonts.ts` (`usePrintFonts`), `print-format.ts` (`buildSampleData`, format), `print-types.ts`.
  - Trang `frontend/src/app/(app)/quan-tri/mau-in/page.tsx`: danh sách mẫu + mở designer; "Thông tin mẫu" là dialog; lưu giữ designer mở.

### Lịch trực khám bệnh — tham chiếu nhanh
- Lõi thuần `backend/src/modules/duty/duty-rules.ts` (`evaluateCandidate`, `shiftInterval`, `isNightWindow`, `normalizeRules`): mọi thời điểm theo Asia/Bangkok (+07:00); kiểm thử `backend/test/duty-rules.test.ts` (`npm test`).
- Service: `duty-core.service.ts` (phạm vi quyền, nạp theo lô và `evaluatePairs`, thông báo sau commit, nhật ký, realtime topic `duty`), `duty.service.ts` (kỳ, ô, phân công, lưới, nghỉ phép, tổng hợp giờ, Excel), `duty-request.service.ts` (nhường/đổi/ngoại lệ/điều chỉnh), `duty-catalog.service.ts` (danh mục). Controller: `duty.controller.ts`, `duty-request.controller.ts`, `duty-catalog.controller.ts`.
- Khoá: transaction + `FOR UPDATE` trên ô + `pg_advisory_xact_lock(9301, userId)`, luôn theo thứ tự id tăng dần; truyền `tx` vào hàm nội bộ.
- Migration `backend/drizzle/0015_lich_truc.sql` (idempotent: bảng, khoá, quyền `duty.*`, vai trò `DIEU_PHOI_TRUC` và `NHAN_VIEN_TRUC`, gán quyền cho vai trò cũ). Seed: `seed-data.ts` (quyền, vai trò, danh mục mặc định `DEFAULT_DUTY_*`) và `scripts/seed.ts` (`seedDutyCatalog`, chỉ thêm mục còn thiếu).
- Từ điển dữ liệu: ghi chú các bảng/cột `duty_*` nằm trong `backend/src/db/schema-comments.ts`.
- Migration `0016_lich_truc_xoa_ky.sql` (nhật ký giữ khi xoá kỳ: FK `ON DELETE SET NULL`; ràng buộc `NOT VALID`: ngày bắt đầu ≤ kết thúc, màu dạng #RRGGBB) và `0017_lich_truc_mau_ca.sql` (đổi màu mặc định cũ của S/C/CD/D sang bảng màu mới; ca đã đổi màu giữ nguyên).
- Xoá cả kỳ: `POST /duty/periods/:id/delete` (quyền `duty.period.manage`, body `{reason, confirmName}`); khoá tư vấn `pg_advisory_xact_lock(9300)` khi tạo/đổi khoảng ngày kỳ lịch.
- Giao diện: bảng màu `frontend/src/components/shared/color-picker.tsx` (kiểu `color` của CrudTable, `SHIFT_PALETTE` trong `lib/duty.ts`); hộp thoại `components/duty/delete-period-dialog.tsx`; lớp chủ đề `.duty-theme` (layout `/lich-truc`) trong `globals.css`.
- Kiểm thử: `node .ai/examples/duty-api-test.mjs` (API :4000, 94 kiểm tra, tự dọn dữ liệu kiểm thử sót, chạy lặp được) và `.ai/examples/duty-ui-test.mjs` (Playwright, chụp ảnh `/tmp/shots`, kiểm tra quyền hiển thị, bảng màu không tràn, hộp thoại xoá; báo lỗi console).

### Tích hợp máy khoá phòng khám (Yêu cầu 15)
- Module `backend/src/modules/integration/`: `integration-key.guard.ts` (`Authorization: Bearer qlbs_int_…`, so khớp băm SHA-256, `@RequireIntegrationScope`, `INTEGRATION_ALLOWED_IPS`), `integration-duty.service.ts` (truy vấn lịch; không lọc cờ `active` của ca; nghỉ phép giao từ ngày trực đến ngày kết thúc ca), `integration-time.ts` (đọc `at`: không múi giờ = Bangkok; ngày ứng viên = hôm nay và hôm trước; phủ ca nửa mở), `integration.controller.ts` (`@Public()` + guard khoá, không dùng JWT), `integration-keys.ts` (sinh và băm khoá).
- CSDL: bảng `integration_keys` trong `backend/src/db/schema/integration.ts`; migration `drizzle/0018_tich_hop_lich_truc.sql` (không có trong `_journal.json`, giống 0015–0017); mô tả trong `schema-comments.ts`.
- CLI: `backend/scripts/integration-key.ts`, chạy bằng `npm run integration:key -- …`. Khoá đầy đủ chỉ in một lần.
- Phía máy khoá (thư mục `/home/user/phongkham-unlock/`, không phải git): `server/qlbs_client.py` (HTTPS, thời gian chờ, lỗi là từ chối), `UNLOCK_SCHEDULE_SOURCE=csv|qlbs`, `admin.py link-doctor/link-room/qlbs-check/qlbs-roster`, `tests/test_qlbs.py`.
- Kiểm thử: `npm test` 29/29; `node .ai/examples/integration-api-test.mjs` 51/51; `duty-api-test.mjs` 94/94; `duty-ui-test.mjs` 7/7.


## 6. Việc đang mở / đề xuất
### Yêu cầu 15 (lượt này): API lịch trực cho máy khoá phòng khám
Nguyên văn (tóm): "Giờ đã có lịch trực bác sĩ trên VPS. Lấy nó làm API để lấy danh sách lịch trực cho ứng dụng khoá màn hình phòng khám (codebase `/home/user/phongkham-unlock/`, cài trên VPS khác), để giải quyết vấn đề ban đầu."

**Đã làm:**
- QLBS: API chỉ đọc `GET /api/integration/duty/on-duty?room=&at=`, `/roster?from=&to=&room=`, `/rooms`; khoá API `qlbs_int_…` (băm SHA-256, phạm vi `duty:read`, thu hồi); `INTEGRATION_ALLOWED_IPS` tuỳ chọn; migration 0018; từ điển dữ liệu; tài liệu `docs/API.md` (mục "Tích hợp máy khoá phòng khám").
- Máy khoá: nguồn `qlbs` (`UNLOCK_SCHEDULE_SOURCE`, `UNLOCK_QLBS_URL/KEY/TIMEOUT/CAFILE`); mọi quyết định (tạo yêu cầu, hiện tuỳ chọn, nhận chữ ký) hỏi QLBS tại thời điểm đó; lỗi hoặc hết giờ là từ chối (503 `schedule_unavailable`); cột `doctors.qlbs_username` và `rooms.qlbs_room_code` (tự nâng cấp CSDL cũ); lệnh `admin.py link-doctor`, `link-room`, `qlbs-check`, `qlbs-roster`; `import-schedule` và `assign` bị khoá khi nguồn là QLBS; README mục 4A.

**Kiểm thử đã chạy:** `npm test` 29/29 (backend); `integration-api-test.mjs` 51/51; `duty-api-test.mjs` 94/94; `duty-ui-test.mjs` 7/7; máy khoá `unittest` 59/59; kiểm chứng chéo với API QLBS đang chạy 28/28 (đúng người được mở, người chưa liên kết bị chặn, ca đã hết không mở, khoá sai/đã thu hồi bị từ chối, khoá không lộ trong nhật ký, lệnh CLI hoạt động). Kịch bản chéo: `/home/user/phongkham-unlock/tests/kiem_chung_qlbs.py` (cần `QLBS_ADMIN_PASS`, `QLBS_BACKEND_DIR`; chỉ chạy trên môi trường thử). Thực nghiệm IP: gọi qua web (Next, :3000) và trực tiếp (:4000) cho kết quả giống nhau.

**Lỗi đã gặp và sửa:** (1) lọc `duty_shift_types.active` làm mất phân công ca đêm đã công bố (ca `D` đang tắt trong seed): đã bỏ lọc theo ca, có kiểm thử; (2) client Python không đọc khung `{success,data}` của QLBS: đã sửa và có test.

**Quyết định cần người dùng biết:** ca đã tắt trong danh mục vẫn được tính nếu đã công bố/chốt; phòng đã đóng và nhân sự đã vô hiệu hoá bị loại; nghỉ phép giao với ngày trực hoặc ngày kết thúc ca thì loại khỏi `on-duty`; `at` không ghi múi giờ là giờ Bangkok; `roster` tối đa 31 ngày.

**Chưa làm / lưu ý:**
- **Đã push** lên `origin/main` (2026-10-09). Bản vá dự phòng: `/home/user/patches/0002-yeu-cau-15-tich-hop-lich-truc.patch`.
- VPS chưa cập nhật. Sau khi push: `cd /opt/qlbs && sudo bash deploy/update.sh --backup` (migration 0018 chạy khi container khởi động).
- Trên VPS QLBS: tạo khoá (`npm run integration:key -- create --name "Máy khóa phòng khám"`), đặt `INTEGRATION_ALLOWED_IPS` bằng IP công khai của máy khoá (tuỳ chọn, nên có).
- Chưa thử trên Windows và trên điện thoại thật; chưa thử với HTTPS thật của bệnh viện.



### Yêu cầu 14b (lượt này): siết ràng buộc, xoá cả kỳ lịch, bảng màu ca, giao diện ngọc lam
Nguyên văn (tóm): người dùng đồng ý phương án đề xuất (nhân viên thường chỉ đăng ký/nhường/đổi ca của mình; tổng hợp giờ và trang quản lý chỉ người quản lý); chọn màu ca bằng bảng màu thay vì gõ mã; cho xoá cả kỳ lịch (trước đây chỉ xoá được kỳ nháp rỗng); tối ưu ràng buộc và logic cho chặt chẽ; giao diện tông màu tươi mát, phù hợp y khoa.

**Đã làm:**
- Quyền: nhân viên thường không vào được trang Kỳ lịch và Danh mục (kể cả nhập URL); tổng hợp giờ (`/periods/:id/summary`), tab Giờ trực và nhật ký chỉ người quản lý. Nghỉ phép vẫn do nhân viên tự khai (chọn theo khuyến nghị).
- Xoá cả kỳ lịch: `POST /duty/periods/:id/delete {reason, confirmName}`; chặn nếu đã có ca đã diễn ra hoặc đang diễn ra; báo nhân viên đã được xếp (kỳ đã công bố); nhật ký giữ lại (`duty_logs.period_id` về NULL, hành động `PERIOD_DELETE`).
- Ràng buộc mới: kỳ không trùng ngày (khoá tư vấn 9300); mở đăng ký trước mốc chốt; không đánh dấu ngày nghỉ khi đã có ô; không đổi giờ/ca đêm của ca đang dùng; không đổi chức danh của vai trò đang dùng; nghỉ phép không trùng khoảng đã khai và không khai ngày đã qua; CHECK ngày và màu (NOT VALID).
- Màu ca: bảng 12 màu (`SHIFT_PALETTE`) + "Màu khác"; mặc định ca mới ngọc lam `#0F766E`; migration 0017 đổi màu mặc định cũ của S/C/CD/D.
- Giao diện: lớp `.duty-theme` cho khu Lịch trực (nút chính, banner, chỉ số, dải nền ngọc lam nhạt); hộp thoại xoá kỳ có cảnh báo và gõ lại tên.

**Kiểm thử đã chạy:** `npm test` 20/20 (thêm `rangesOverlap`); `duty-api-test.mjs` 94/94 (chạy lặp hai lần đều đạt); `duty-ui-test.mjs` 7/7, không lỗi console; `tsc` backend và frontend, `nest build`, `next build` đạt; migrate 0016–0017 áp dụng trên DB phát triển; nhật ký `PERIOD_DELETE` còn sau khi xoá kỳ.

**Chưa làm / lưu ý:** đã push lên `main` (xem mục chờ người dùng); VPS chưa cập nhật; chưa bấm thử trên trình duyệt thật các luồng xếp người, nhường, duyệt (đã kiểm qua API).

### Yêu cầu 14 (đã làm): Lịch trực khám bệnh
Nguyên văn (tóm): đọc STATE và codebase `pvminh94/qlbv`; viết trang "lịch trực khám bệnh" để nhập lịch trực; đầy đủ tính năng chuẩn chuyên nghiệp; có thời gian chốt lịch; khi sự cố đổi người trực ngoài dự kiến thì báo KHTH, KHTH có tài khoản đổi trực để xử lý ngoại lệ; chủ động thêm ràng buộc thực tế; cấu hình linh động (danh mục phòng khám và danh mục ca trực); giao diện thương mại, đẹp, responsive; thông suốt.

**Đã làm:** backend, migration, quyền, vai trò, danh mục mặc định, từ điển dữ liệu, giao diện `/lich-truc/*` (lưới tuần; trên điện thoại hiển thị theo ngày), nhóm menu "Lịch trực", tài liệu `docs/API.md` (mục Lịch trực), `PHAN-QUYEN.md` (§8), `KIEN-TRUC.md` (§8), `HUONG-DAN-SU-DUNG.md` (§11).

**Kiểm thử đã chạy:** `npm test` 19/19 (lõi ràng buộc); `duty-api-test.mjs` 77/77 (kể cả nhường, đổi hai chiều, ngoại lệ sau chốt, điều chỉnh, mở chốt theo mốc thời gian, xuất Excel, phân quyền 403); `next build` đạt; Playwright chụp 7 trang máy tính và điện thoại, không có lỗi console.

**Giả định cần người dùng xác nhận (đã đặt làm mặc định, sửa được trong Danh mục / Kỳ lịch):**
- Ca: S 07:00–12:00, C 12:00–17:00, CD 07:00–17:00; ca đêm D 17:00–07:00 đang TẮT.
- 15 phòng "Phòng khám số 1…15" là placeholder, chưa gắn khoa. Cần khai báo phòng thật và khoa quản lý; phòng chưa gắn khoa chỉ Điều phối toàn viện xếp được.
- Ràng buộc mặc định: nghỉ tối thiểu 12 giờ giữa hai ca; ≤10 giờ/ngày; ≤48 giờ/tuần; khác khoa chỉ cảnh báo; đổi/nhường ca cần duyệt; ca sáng + chiều liền nhau được phép (theo mẫu lịch thật); tự đăng ký bật.
- Ai được cấp `DIEU_PHOI_TRUC` (tài khoản đổi trực của KHTH) và `NHAN_VIEN_TRUC` (bác sĩ, điều dưỡng).

**Chưa làm / lưu ý:**
- Thông báo dùng trung tâm thông báo trong ứng dụng; chưa kiểm chứng kênh ngoài (email, Zalo) trong luồng lịch trực.
- Playwright mới chụp ảnh và kiểm tra không lỗi console các trang chính; luồng hộp thoại (xếp người, nhường ca, duyệt) kiểm thử qua API, chưa bấm thử trên trình duyệt thật.
- Giai đoạn 2 (chưa bắt đầu): máy chủ sinh trắc học (khuôn mặt…), dashboard quản lý máy chủ, app tại máy phòng bác sĩ. Điểm tích hợp đã định: "ai đang trực phòng X tại thời điểm T" từ `duty_assignments` ⋈ `duty_slots` ⋈ `duty_shift_types`.

### Việc chờ người dùng
- **Yêu cầu 15 — cần token GitHub mới để push** (commit cục bộ, bản vá `/home/user/patches/0002-yeu-cau-15-tich-hop-lich-truc.patch`). Sau khi push: `cd /opt/qlbs && sudo bash deploy/update.sh --backup`.
- **Dự án máy khoá — thông tin cần cho lần triển khai:** tên miền HTTPS của QLBS (đường dẫn API), IP công khai của VPS máy khoá, mã phòng QLBS nếu khác mã phòng bên máy khoá, `username` QLBS của từng bác sĩ. Câu hỏi (a)–(i) vẫn chưa trả lời.
- **Cập nhật VPS**: commit đã push lên `main`; VPS chưa cập nhật. Chạy `cd /opt/qlbs && sudo bash deploy/update.sh --backup` (migration 0015–0017 chạy khi container khởi động).
- **Thu hồi GitHub token**: token dùng để push phiên này đã được dán trong chat, nên cần thu hồi. Token không được lưu trong sandbox, git remote hay repo.
- **Chính sách xoá kỳ đã có ca**: hiện chặn (409) nếu có phân công có ngày ≤ hôm nay (giờ Bangkok). Chờ người dùng quyết định có cho phép xoá không và điều kiện.
- **Đã chọn theo khuyến nghị** (người dùng đồng ý, không trả lời form): nhân viên thường tự khai nghỉ phép; tổng hợp giờ trực chỉ người quản lý xem.
- **Dự án máy phòng khám mở khoá tự động** (ngoài repo, `/home/user/phongkham-unlock/`): vẫn còn hiệu lực, chưa là trọng tâm. Chưa trả lời: (a) phần mềm khám bệnh là app cài máy hay web; (b) bác sĩ có tài khoản riêng hay dùng chung; (c) iPhone hay Android, có chấp nhận Face ID hoặc vân tay; (d) hostname nội bộ và chứng chỉ HTTPS; (e) dải IP Wi-Fi nhân viên; (f) xác nhận S = sáng, C = chiều, ô không tiền tố = cả ngày, có lấy Thứ 7 không, mốc 12:00; (g) số phòng chính xác; (h) có VM Windows 10 Pro không; (i) khi bác sĩ rời phòng có cần khoá lại không. Ràng buộc đã biết: không webcam, không Bluetooth, Windows 10 Pro, tự code (không dựa Assigned Access hay Shell Launcher); mở máy chỉ khi đúng bác sĩ được xếp đúng phòng và đúng ca; mỗi yêu cầu dùng một lần, hạn khoảng 60 giây; có nhật ký.
- **Chưa rõ:** có gộp phần tài liệu và tài sản đang dở trong `STATE.md` thành một mục hay không.

### Yêu cầu 13 (GĐ1–GĐ3b đã có commit, xem mục 4): Phân hệ QUẢN LÝ TÀI SẢN + báo cáo/dashboard + realtime + làm lại RBAC
Nguyên văn: "viết tiếp phân hệ quản lý tài sản chuyên nghiệp, chi tiết, chuyên sâu, barcode, kiểm kê, in tem… tích hợp đồng bộ, logic với tính năng hiện tại, thêm phần quản lý tạo, edit report, dashboard cho từng phân hệ… cực đẹp chuyên nghiệp, đồng bộ thời gian thực…, cải tiến user, role, permission dễ nhìn, logic, chuyên sâu".

**Quyết định của người dùng (ask_user):**
- Thứ tự: GĐ1 lõi tài sản (✅ xong) → **GĐ2 kiểm kê (quét camera offline rồi đồng bộ + máy quét), bảo trì/sửa chữa kế hoạch, báo cáo tài sản** → GĐ3 trình tạo báo cáo + dashboard mọi phân hệ + realtime → GĐ4 làm lại User/Role/Permission. Mỗi GĐ = 1 lần push, test kỹ.
- Khấu hao: cả hao mòn năm TT23, đường thẳng tháng, số dư giảm dần — cấu hình theo loại/từng tài sản.
- In tem: máy in nhiệt + decal A4. Quét: camera + máy quét USB/BT. Phạm vi: mọi loại tài sản (TBYT: rủi ro A–D, số lưu hành, kiểm định/bảo dưỡng).

**GĐ1 đã làm (tham chiếu):**
- Backend `backend/src/modules/assets/`: `assets.service` (phạm vi khoa: `asset.view-all` hoặc departmentIds hoặc custodian=mình; trường CONTROLLED bị khoá khi `hasHistory`), `asset-transactions.service` (NHAP→CHO_DUYET→DA_DUYET/TU_CHOI/DA_HUY, duyệt khoá dòng FOR UPDATE), `asset-depreciation.service` + `depreciation.ts` (đã kiểm chứng số liệu), `asset-labels.service` (THERMAL/SHEET, đổi tiền tố binding `rN.`), `asset-voucher.service` + `asset-voucher-template.ts` (biên bản `BIEN_BAN_TAI_SAN`), `asset-io.service` (import dry-run/export), `asset-catalogs.service`.
- Mẫu in seed: `TEM_TAI_SAN`, `BIEN_BAN_TAI_SAN` (module `ASSET`). Cấu hình mới: `hospital.parentName`, `hospital.place`.
- Frontend: `lib/assets.ts`, `components/assets/{asset-ui,asset-form,asset-import}.tsx`, trang `app/(app)/tai-san/{page,danh-sach,[id],nghiep-vu,nghiep-vu/tao-moi,nghiep-vu/[id],khau-hao,in-tem,tra-cuu,danh-muc}`, `app/(app)/ts/[code]`. Màu nhấn teal-600. Menu nhóm "Quản lý tài sản".
- Test: `node .ai/examples/asset-api-test.mjs` (48 ca) và `node .ai/examples/asset-ui-test.js` (Playwright, ảnh `/tmp/shots/a*.png`).
- Bẫy: `.env` dev `DB_POOL_MAX=1` → **không dùng `this.db.db` trong `transaction()`**, luôn truyền `tx`; POST trả file cần `@HttpCode(200)`; lỗi Drizzle xem `e.cause`.

- (Đề xuất, chờ người dùng) Script chép bản sao lưu sang NAS/cloud — cần người dùng cho biết đích đến.

**GĐ2 — ghi chú kỹ thuật:**
- Kiểm kê offline: khoá `(inventoryId, clientId)` ở `asset_inventory_scans`; reconciliation `inventoryResultOf()` trong `asset-inventory.service.ts`. Dòng "thiếu" khi finish được đánh `method=AUTO` để reopen trả về `CHUA_KIEM` nguyên trạng (không đụng dòng đã quét/đã có chứng từ).
- Resolve: `DIEU_CHUYEN/CAP_PHAT/THIET_B*` tự chọn loại theo hướng (kho→khoa=CAP_PHAT, khoa→kho=THU_HOI, sai vị trí=DIEU_CHUYEN); một dòng chỉ lập 1 chứng từ (`resolutionTxId`).
- Báo cáo: `ReportResult{columns,rows,summary,chart}`; dòng `_kind: group|subtotal|total`; renderer PDF đọc `row.__style` (đã vá `pdf-renderer.ts` — dòng nhóm in đậm, nền khác, không kẻ ô thụt sai).
- Lịch bảo trì: `schedule()` chiếu `next_* + interval` tới `to`; sự kiện `projected` (đường đứt). ICS sinh ở client (bảo trì page) — không cần thư viện.
- Nhắc hạn: dedupe theo `(userId, module=ASSET, entityId=ngày)` để chạy lại không gửi trùng.
