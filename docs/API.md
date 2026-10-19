# Danh mục API — QLBS

Tổng **187** endpoint. Đường dẫn đầy đủ có tiền tố `/api`, ví dụ `GET /api/hsba/requests`. Cột **Quyền** là (các) mã quyền cần có — nhiều mã cách nhau bởi `|` nghĩa là chỉ cần một trong số đó; quản trị tối cao (`SUPER_ADMIN`) bỏ qua mọi kiểm tra. Xem [PHAN-QUYEN.md](PHAN-QUYEN.md).

> Tài liệu tương tác (Swagger UI): `http://<máy chủ>:4000/api/docs`

**Quy ước chung**

- Mọi phản hồi bọc trong `{"success": true, "data": …}`; lỗi trả `{"success": false, "message": …}`.
- Danh sách dùng chung tham số: `page`, `pageSize`, `q`, `sortBy`, `sortDir`, `filters`, `dateField`, `dateFrom`, `dateTo`, `all`.
- `filters` có dạng `field:op:value`, nhiều điều kiện cách nhau bởi dấu phẩy, `op ∈ eq,ne,gt,gte,lt,lte,like,in,nin,isnull,notnull` (ví dụ `status:eq:HOAN_TAT,priority:in:HIGH|NORMAL`).
- Tham số boolean trên URL nhận `true/false/1/0/on/yes`.
- Danh sách trường lọc hợp lệ của từng màn hình lấy từ `GET /api/meta/filters[/:resource]` — giao diện tự dựng bộ lọc nâng cao từ dữ liệu này.

## Nhật ký hệ thống

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/audit` | Tra cứu nhật ký kiểm toán (lọc nâng cao + phân trang) | `audit.log.view` |
| `GET` | `/audit/stats` | Thống kê nhật ký theo phân hệ và thao tác | `audit.log.view` |
| `GET` | `/audit/top-users` | Người dùng thao tác nhiều nhất | `audit.log.view` |
| `GET` | `/audit/entity` | Nhật ký của một bản ghi cụ thể | `audit.log.view` |

## Xác thực & phiên đăng nhập

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `POST` | `/auth/login` | Đăng nhập | — |
| `POST` | `/auth/refresh` | Làm mới token | — |
| `POST` | `/auth/logout` | Đăng xuất khỏi phiên hiện tại | — |
| `GET` | `/auth/me` | Thông tin người dùng đang đăng nhập kèm quyền hiệu lực | — |
| `GET` | `/auth/profile` | Hồ sơ cá nhân chi tiết | — |
| `PUT` | `/auth/profile` | Cập nhật hồ sơ cá nhân | — |
| `POST` | `/auth/change-password` | Đổi mật khẩu | — |
| `GET` | `/auth/permissions` | Danh mục toàn bộ quyền (nhóm theo phân hệ) | — |
| `GET` | `/auth/sessions` | Các phiên đăng nhập đang hoạt động | — |
| `DELETE` | `/auth/sessions/:id` | Thu hồi một phiên đăng nhập | — |
| `DELETE` | `/auth/sessions` | Đăng xuất khỏi toàn bộ thiết bị | — |

## Bảng điều khiển

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/dashboard/summary` | Số liệu tổng quan: hồ sơ, báo cáo, người dùng, tác vụ, nhật ký | — |

## Khoa phòng (cây tổ chức)

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/departments` | Danh sách đơn vị (lọc nâng cao + phân trang) | `department.view` |
| `GET` | `/departments/tree` | Cây phân cấp đơn vị | `department.view` |
| `GET` | `/departments/options` | Danh sách gọn cho ô chọn | — |
| `GET` | `/departments/:id` | Chi tiết một đơn vị | `department.view` |
| `GET` | `/departments/:id/descendants` | Toàn bộ id trong nhánh (gồm chính nó) | `department.view` |
| `POST` | `/departments` | Thêm đơn vị/khoa mới | `department.create` |
| `PUT` | `/departments/:id` | Cập nhật đơn vị | `department.update` |
| `PATCH` | `/departments/reorder` | Sắp xếp lại thứ tự đơn vị | `department.update` |
| `DELETE` | `/departments/:id` | Xoá đơn vị (xoá mềm) | `department.delete` |
| `PATCH` | `/departments/:id/restore` | Khôi phục đơn vị đã xoá | `department.delete` |

## Hồ sơ bệnh án — phiếu đề nghị sửa

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/hsba/workflows` | Danh sách quy trình ký | `hsba.workflow.view` |
| `GET` | `/hsba/workflows/:id` | Chi tiết quy trình ký (các bước cấu hình động) | `hsba.workflow.view` |
| `POST` | `/hsba/workflows` | Tạo quy trình ký mới (số bước tuỳ ý) | `hsba.workflow.create` |
| `PUT` | `/hsba/workflows/:id` | Cập nhật quy trình ký | `hsba.workflow.update` |
| `DELETE` | `/hsba/workflows/:id` | Xoá quy trình ký (chặn nếu đang có phiếu dùng) | `hsba.workflow.delete` |
| `GET` | `/hsba/requests` | Danh sách phiếu — tìm kiếm sâu, lọc nâng cao, phân trang | `hsba.request.view` |
| `GET` | `/hsba/requests/my-turn` | Phiếu đang chờ chính tôi xử lý | `hsba.request.view` |
| `GET` | `/hsba/requests/stats` | Thống kê phiếu theo trạng thái và theo khoa | `hsba.request.view` |
| `GET` | `/hsba/requests/verify/:id/:stepKey/:hash` | Xác thực chữ ký số của nội dung phiếu (dùng cho QR) | — |
| `GET` | `/hsba/requests/:id` | Chi tiết phiếu kèm dòng thời gian ký | `hsba.request.view` |
| `GET` | `/hsba/requests/:id/print-data` | Dữ liệu đổ vào mẫu in của phiếu (dùng khi xem trước với phiếu thật) | `hsba.request.print` |
| `GET` | `/hsba/requests/:id/pdf` | Kết xuất phiếu ra PDF theo mẫu in cấu hình được | `hsba.request.print` |
| `POST` | `/hsba/requests` | Tạo phiếu đề nghị sửa HSBA (tự chọn quy trình theo khoa) | `hsba.request.create` |
| `PUT` | `/hsba/requests/:id` | Cập nhật nội dung phiếu | `hsba.request.update` |
| `POST` | `/hsba/requests/:id/sign` | Ký ở bước đang chờ (kiểm tra theo cấu hình quy trình) | `hsba.request.sign-requester | hsba.request.sign-khtb | hsba.request.sign-insurance | hsba.request.sign-finance` |
| `POST` | `/hsba/requests/bulk-sign` | Ký nhiều phiếu đang chờ tôi xử lý trong một lần | `hsba.request.sign-requester | hsba.request.sign-khtb | hsba.request.sign-insurance | hsba.request.sign-finance` |
| `POST` | `/hsba/requests/:id/return` | Trả lại phiếu kèm lý do (huỷ chữ ký phía sau) — chỉ TB.KHTH và Tr.BP bảo hiểm có quyền này | `hsba.request.return` |
| `POST` | `/hsba/requests/:id/cancel` | Huỷ phiếu | `hsba.request.cancel` |
| `PATCH` | `/hsba/requests/:id/restore` | Khôi phục phiếu đã xoá mềm | `hsba.request.delete` |
| `DELETE` | `/hsba/requests/:id` | Xoá mềm phiếu | `hsba.request.delete` |

## Thông báo

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/notifications` | Thông báo của tôi | — |
| `PATCH` | `/notifications/:id/read` | Đánh dấu đã đọc | — |
| `PATCH` | `/notifications/read-all` | Đánh dấu đã đọc tất cả | — |
| `DELETE` | `/notifications/:id` | Xoá thông báo | — |

## Bản in & mẫu in

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/print/templates` | Danh sách mẫu in | `print.template.view` |
| `GET` | `/print/templates/:id` | Chi tiết mẫu in (kèm toàn bộ thiết kế JSON) | `print.template.view` |
| `GET` | `/print/templates/:id/versions` | Lịch sử phiên bản thiết kế | `print.template.view` |
| `POST` | `/print/templates` | Tạo mẫu in mới | `print.template.create` |
| `PUT` | `/print/templates/:id` | Cập nhật thiết kế (tự tăng phiên bản) | `print.template.update` |
| `POST` | `/print/templates/:id/duplicate` | Sao chép mẫu in | `print.template.create` |
| `POST` | `/print/templates/:id/restore/:version` | Khôi phục thiết kế về phiên bản cũ | `print.template.update` |
| `PATCH` | `/print/templates/:id/publish` | Ban hành / ngừng sử dụng mẫu in | `print.template.publish` |
| `DELETE` | `/print/templates/:id` | Xoá mẫu in | `print.template.delete` |
| `POST` | `/print/preview` | Xem trước bản in từ thiết kế đang chỉnh (trả về PDF) | `print.render.view` |
| `POST` | `/print/templates/:id/render` | Kết xuất mẫu in ra PDF với dữ liệu truyền vào | `print.render.export` |
| `GET` | `/print/resolve/:docType` | Tìm mẫu in đang áp dụng theo loại chứng từ | `print.render.view` |
| `GET` | `/print/fonts` | Danh sách font bản in (mặc định Times New Roman) và trạng thái từng kiểu chữ | `print.template.view` |
| `GET` | `/print/fonts/file?family=&variant=` | Tải tệp font (để khung thiết kế hiển thị đúng như PDF) | `print.template.view` |
| `POST` | `/print/fonts?name=` | Tải tệp TTF/OTF lên (body octet-stream) — tự nhận họ font và kiểu chữ | `print.template.update` |
| `DELETE` | `/print/fonts?family=&variant=` | Xoá font đã tải lên | `print.template.update` |

## Báo cáo khoa

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/reports/templates` | Danh sách mẫu báo cáo | `report.template.view` |
| `GET` | `/reports/templates/:id` | Chi tiết mẫu báo cáo (mục → nhóm → dòng, kèm danh sách cột) | `report.template.view` |
| `POST` | `/reports/templates` | Tạo mẫu báo cáo (kèm cột và cấu trúc bảng biểu) | `report.template.create` |
| `PUT` | `/reports/templates/:id` | Cập nhật thông tin mẫu báo cáo | `report.template.update` |
| `PUT` | `/reports/templates/:id/structure` | Lưu toàn bộ cấu trúc (cột, mục, nhóm, dòng) trong một lần | `report.template.update` |
| `POST` | `/reports/templates/:id/duplicate` | Sao chép mẫu báo cáo (có thể sang khoa khác) | `report.template.create` |
| `DELETE` | `/reports/templates/:id` | Xoá mẫu báo cáo (tự chuyển sang ngừng dùng nếu đã có số liệu) | `report.template.delete` |
| `POST` | `/reports/templates/validate-formula` | Kiểm tra công thức cột trước khi lưu | `report.template.view` |
| `GET` | `/reports/view` | Tính báo cáo theo kỳ (ngày/tuần/tháng/quý/năm/khoảng/toàn bộ) | `report.view.view` |
| `GET` | `/reports/summary` | Bảng tổng hợp toàn viện theo chỉ tiêu chuẩn | `report.summary.view` |
| `GET` | `/reports/stats` | Thống kê tình hình nhập liệu (dashboard) | `report.view.view` |
| `GET` | `/reports/export/:format` | Kết xuất báo cáo ra Excel / Word / PDF | `report.export.excel` |
| `GET` | `/reports/entries/grid` | Lưới nhập liệu: cấu trúc bảng + số liệu đã nhập theo kỳ | `report.entry.view` |
| `GET` | `/reports/entries/latest-date` | Ngày mới nhất đã có số liệu của một mẫu báo cáo | `report.entry.view` |
| `POST` | `/reports/entries` | Lưu số liệu hàng loạt (tự tạo/ghi đè theo ô, có nhật ký) | `report.entry.update` |
| `DELETE` | `/reports/entries` | Xoá một ô số liệu | `report.entry.delete` |
| `GET` | `/reports/entries/history` | Nhật ký thay đổi số liệu (ai sửa, giá trị cũ/mới) | `report.entry.view-audit` |
| `GET` | `/reports/snapshots` | Danh sách bản chốt số liệu | `report.view.view` |
| `GET` | `/reports/snapshots/:id` | Chi tiết bản chốt (kèm toàn bộ số liệu tại thời điểm chốt) | `report.view.view` |
| `POST` | `/reports/snapshots` | Chốt số liệu một kỳ báo cáo | `report.snapshot.create` |
| `PATCH` | `/reports/snapshots/:id/status` | Duyệt hoặc khoá bản chốt số liệu | `report.snapshot.approve | report.snapshot.lock` |

## Vai trò & phân quyền

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/roles` | Danh sách vai trò | `role.view` |
| `GET` | `/roles/all` | Toàn bộ vai trò đang hoạt động (cho ô chọn) | — |
| `GET` | `/roles/matrix` | Ma trận vai trò × quyền phục vụ giao diện phân quyền | `role.view` |
| `GET` | `/roles/:id` | Chi tiết vai trò kèm quyền và thành viên | `role.view` |
| `POST` | `/roles` | Thêm vai trò mới | `role.create` |
| `PUT` | `/roles/:id` | Cập nhật vai trò | `role.update` |
| `PUT` | `/roles/:id/permissions` | Gán lại toàn bộ tập quyền của vai trò | `role.update` |
| `PATCH` | `/roles/:id/permissions` | Bật/tắt một quyền của vai trò | `role.update` |
| `POST` | `/roles/:id/users` | Gán vai trò cho nhiều người dùng | `user.assign-role` |
| `POST` | `/roles/:id/duplicate` | Nhân bản vai trò | `role.create` |
| `DELETE` | `/roles/:id` | Xoá vai trò | `role.delete` |

## Tác vụ định kỳ

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/jobs` | Danh sách tác vụ định kỳ | `job.view` |
| `GET` | `/jobs/handlers` | Danh mục hàm xử lý có sẵn | `job.view` |
| `GET` | `/jobs/stats` | Thống kê tác vụ và lần chạy gần nhất | `job.view` |
| `GET` | `/jobs/runs` | Lịch sử chạy tác vụ | `job.view` |
| `GET` | `/jobs/:id` | Chi tiết tác vụ kèm lịch sử chạy | `job.view` |
| `POST` | `/jobs` | Thêm tác vụ định kỳ | `job.create` |
| `PUT` | `/jobs/:id` | Cập nhật tác vụ | `job.update` |
| `PATCH` | `/jobs/:id/toggle` | Bật/tắt tác vụ | `job.update` |
| `POST` | `/jobs/:id/run` | Chạy tác vụ ngay lập tức | `job.run` |
| `POST` | `/jobs/sync` | Nạp lại toàn bộ lịch định kỳ vào hàng đợi | `job.update` |
| `DELETE` | `/jobs/:id` | Xoá tác vụ | `job.delete` |

## Người dùng

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/users` | Danh sách người dùng (lọc nâng cao + phân trang) | `user.view` |
| `GET` | `/users/stats` | Thống kê người dùng | `user.view` |
| `GET` | `/users/:id` | Chi tiết người dùng (vai trò, phạm vi khoa, lịch sử đăng nhập) | `user.view` |
| `POST` | `/users` | Thêm người dùng mới | `user.create` |
| `PUT` | `/users/:id` | Cập nhật người dùng | `user.update` |
| `DELETE` | `/users/:id` | Xoá người dùng (xoá mềm) | `user.delete` |
| `PATCH` | `/users/:id/restore` | Khôi phục người dùng đã xoá | `user.delete` |
| `PATCH` | `/users/:id/active` | Kích hoạt / vô hiệu hoá tài khoản | `user.update` |
| `POST` | `/users/:id/reset-password` | Đặt lại mật khẩu cho người dùng | `user.reset-password` |
| `POST` | `/users/:id/unlock` | Mở khoá tài khoản bị tạm khoá | `user.update` |
| `PUT` | `/users/:id/roles` | Gán vai trò cho người dùng | `user.assign-role` |
| `PUT` | `/users/:id/department-scopes` | Gán phạm vi khoa được phép truy cập | `user.assign-role` |
| `GET` | `/users/import/template` | Tải tệp Excel mẫu nhập nhân viên | `user.import` |
| `POST` | `/users/import/file?name=&dryRun=&overwrite=&addTitles=` | Nhập nhân viên từ tệp .xlsx/.csv/.txt (thân yêu cầu là nội dung tệp, `application/octet-stream`); `dryRun=true` để xem trước | `user.import` |
| `POST` | `/users/import` | Nhập danh sách người dùng từ JSON (dòng đã đọc sẵn) | `user.import` |
| `GET` | `/job-titles` | Danh mục chức danh (tìm kiếm, phân trang) | `job_title.view` |
| `GET` | `/job-titles/options` | Danh sách gọn cho ô chọn | (đăng nhập) |
| `POST` / `PUT` / `DELETE` | `/job-titles[/:id]` | Thêm / sửa (đổi tên cập nhật `users.title`) / xoá (chặn khi đang dùng) | `job_title.create/update/delete` |

## Tiện ích (menu động)

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/utilities` | Danh sách tiện ích | `utility.view` |
| `GET` | `/utilities/menu` | Menu tiện ích của người dùng hiện tại (đã lọc theo quyền) | — |
| `GET` | `/utilities/:id` | Chi tiết tiện ích | `utility.view` |
| `POST` | `/utilities` | Thêm tiện ích mới | `utility.create` |
| `PUT` | `/utilities/:id` | Cập nhật tiện ích | `utility.update` |
| `PATCH` | `/utilities/reorder` | Sắp xếp thứ tự tiện ích | `utility.update` |
| `DELETE` | `/utilities/:id` | Xoá tiện ích | `utility.delete` |

## Siêu dữ liệu bộ lọc nâng cao

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/meta/filters` | Danh sách tài nguyên hỗ trợ lọc nâng cao và toán tử kèm nhãn tiếng Việt | — |
| `GET` | `/meta/filters/:resource` | Trường lọc, kiểu dữ liệu, toán tử và nguồn giá trị của một tài nguyên | — |

Tài nguyên hỗ trợ: `hsba`, `report-entries`, `print-templates`, `users`, `roles`, `departments`, `utilities`, `audit`.

## Studio — bảng điều khiển & báo cáo tuỳ biến

Query engine an toàn phía máy chủ: câu hỏi (`StudioDataSpec`) chỉ gồm tên **nguồn**
+ chỉ số/nhóm/lọc theo từ khoá cho phép (không SQL tự do), tự áp phạm vi dữ liệu
theo vai trò. Nguồn nào yêu cầu quyền riêng (ví dụ `assets` cần `asset.view`,
`hsba-requests` cần `hsba.request.view`) thì người thiếu quyền nhận `403`.

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/studio/sources` | Danh mục nguồn dữ liệu + trường + từ vựng lọc, đã lọc theo quyền người xem | đăng nhập |
| `POST` | `/studio/query` | Chạy `dataSpec` → `{columns, rows}` (số liệu/bảng/biểu đồ) | theo nguồn |
| `POST` | `/studio/query/export` | Chạy `dataSpec` rồi trả tệp **Excel** (.xlsx, ExcelJS) | theo nguồn |
| `GET` | `/studio/pages?kind=DASHBOARD\|REPORT` | Trang của tôi + trang vai trò + trang hệ thống | `studio.*.view` |
| `GET` | `/studio/pages/default?kind=…` | Trang mặc định theo độ ưu tiên: cá nhân → vai trò → hệ thống | `studio.*.view` |
| `GET` | `/studio/pages/:id` | Chi tiết trang (chủ sở hữu/phạm vi được phép mới xem) | `studio.*.view` |
| `POST` | `/studio/pages` | Tạo trang `{kind, scope: PERSONAL\|ROLE\|SYSTEM, layout{widgets[]}}` | `studio.*.view` (phạm vi SYSTEM cần `studio.*.manage`) |
| `PUT` | `/studio/pages/:id` | Sửa tên/bố cục; chủ sở hữu sửa trang mình, `manage` sửa trang hệ thống | chủ/`manage` |
| `DELETE` | `/studio/pages/:id` | Xoá mềm (không xoá được trang hệ thống mặc định) | chủ/`manage` |
| `POST` | `/studio/pages/:id/duplicate` | Nhân bản thành bản "Của tôi" | `studio.*.view` |
| `POST` | `/studio/pages/:id/default` | `{value}` đặt/bỏ mặc định (mỗi người/vai trò/phạm vi 1 trang) | chủ/`manage` |

`StudioWidget.type`: `kpi, line, area, bar, barh, pie, donut, table, text, builtin`
(builtin: `jobs` — tác vụ định kỳ, `activity` — hoạt động gần đây). Kích thước
`w` = 2–12 cột, `h` = `S/M/L`. Ô dữ liệu tự tải lại khi có sự kiện realtime thuộc
chủ đề của nguồn đó.

## Realtime (SSE)

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| `GET` | `/realtime/stream?topics=hsba,notifications,assets&token=<JWT>` | Luồng **Server-Sent Events**: keep-alive 25s, gửi `{topic, event, data}` khi có thay đổi; chiếu theo phạm vi dữ liệu của người nhận (QUAN_TRỌNG: gửi JWT qua query vì `EventSource` không đặt được header — chỉ chấp nhận trên endpoint này) |
| `GET` | `/realtime/stats` | Số kết nối đang mở theo chủ đề (quản trị) |

Frontend gộp kết nối qua `RealtimeProvider`: một `EventSource` dùng chung, các
component đăng ký `useRealtimeEvent(topic, cb)`; bảng điều khiển Studio ánh xạ
nguồn → chủ đề để tự làm mới đúng ô.

## Quản lý tài sản

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/asset-catalogs/meta` | Nhãn liệt kê: phân loại, nhóm, phương pháp khấu hao, loại vị trí, vai trò NCC | `asset.view` \| `asset.catalog.view` |
| `GET` | `/asset-catalogs/:kind` | Danh mục `categories` \| `locations` \| `suppliers` \| `funding` (cây, kèm `usage`), `?activeOnly=true` | `asset.view` \| `asset.catalog.view` |
| `POST` | `/asset-catalogs/:kind` | Thêm mục danh mục | `asset.catalog.manage` |
| `PUT` | `/asset-catalogs/:kind/:id` | Sửa (một phần) mục danh mục | `asset.catalog.manage` |
| `DELETE` | `/asset-catalogs/:kind/:id` | Xoá mục chưa dùng, không có mục con | `asset.catalog.manage` |
| `GET` | `/assets` | Danh sách: `q, status (ACTIVE = đang theo dõi, nhiều giá trị cách dấu phẩy), categoryId, locationId (gồm cây con), departmentId (-1 = kho), fundingSourceId, supplierId, custodianId, group, kind, condition, due (calibration\|maintenance\|warranty\|overdue), dueDays, costMin, costMax, acquiredFrom, acquiredTo, ids, sortBy, sortDir` — kèm `summary` tổng nguyên giá/hao mòn/còn lại | `asset.view` |
| `GET` | `/assets/dashboard` | Tổng quan: KPI, cơ cấu trạng thái/khoa/loại/nhóm/nguồn vốn/năm/tuổi, lịch đến hạn, hoạt động | `asset.dashboard` \| `asset.view` |
| `GET` | `/assets/options` | Khoa/phòng (theo phạm vi) và người dùng cho ô chọn | `asset.view` |
| `GET` | `/assets/export` | Xuất Excel theo cùng bộ lọc với danh sách | `asset.export` |
| `GET` | `/assets/import/template` | Tệp Excel mẫu nhập tài sản | `asset.import` |
| `POST` | `/assets/import?name=&dryRun=&updateExisting=` | Nhập Excel/CSV (thân = tệp thô octet-stream); `dryRun=true` chỉ kiểm tra; có dòng lỗi thì không ghi | `asset.import` |
| `GET` | `/assets/lookup/:code` | Tra theo mã tài sản / mã vạch / serial (quét mã, QR `/ts/<mã>`) | `asset.view` |
| `GET` | `/assets/labels/templates` | Mẫu tem (docType `TEM_TAI_SAN`) | `asset.label.print` |
| `POST` | `/assets/labels` | In tem PDF: `{ids \| filter, layout: THERMAL\|SHEET, copies, templateId, origin, sheet:{cols,rows,marginTop,marginLeft,gapX,gapY,skip}}`; header `X-Label-Count` | `asset.label.print` |
| `GET` | `/assets/:id` | Hồ sơ đầy đủ + dòng thời gian, chứng từ, khấu hao đã chốt, lịch dự kiến, thành phần, `locked` | `asset.view` |
| `POST` | `/assets` | Thêm tài sản; `copies` > 1 tạo cả lô (mỗi chiếc 1 mã) | `asset.create` |
| `PUT` | `/assets/:id` | Sửa hồ sơ (nguyên giá, khoa, người giữ, trạng thái… bị khoá khi đã phát sinh nghiệp vụ) | `asset.update` |
| `DELETE` | `/assets/:id` | Xoá (mềm) tài sản chưa phát sinh | `asset.delete` |
| `GET` | `/asset-transactions/meta` | Loại chứng từ (trạng thái tài sản hợp lệ, nhãn số tiền), trạng thái | `asset.view` \| `asset.transaction.view` |
| `GET` | `/asset-transactions` | Danh sách: `q, type, status, dateFrom, dateTo, assetId, mine` — kèm `counts.pending/draft` | `asset.transaction.view` |
| `GET` | `/asset-transactions/:id` | Chi tiết + dòng tài sản (ảnh trước/sau) + quyền thao tác `can` | `asset.transaction.view` |
| `GET` | `/asset-transactions/:id/print` | In biên bản PDF (mẫu `BIEN_BAN_TAI_SAN`, tiêu đề theo loại nghiệp vụ) | `asset.transaction.view` |
| `POST` | `/asset-transactions` | Lập chứng từ `{type, txDate, toDepartmentId, toLocationId, toCustodianId, delivererName, receiverName, reason, decisionNo, supplierId, items:[{assetId, amount, condition, note}], submit?, approveNow?}` | `asset.transaction.create` |
| `PUT` | `/asset-transactions/:id` | Sửa chứng từ Nháp / Từ chối | `asset.transaction.create` |
| `POST` | `/asset-transactions/:id/submit` | Gửi duyệt (thông báo người duyệt) | `asset.transaction.create` |
| `POST` | `/asset-transactions/:id/approve` | Duyệt & áp dụng vào tài sản (một giao dịch, khoá dòng) | `asset.transaction.approve` |
| `POST` | `/asset-transactions/:id/reject` | Từ chối `{reason}` | `asset.transaction.approve` |
| `POST` | `/asset-transactions/:id/cancel` | Huỷ chứng từ chưa duyệt | `asset.transaction.create` |
| `GET` | `/asset-depreciation/suggest` | Kỳ gần nhất đã chốt, kỳ gợi ý (năm/tháng) | `asset.depreciation.view` |
| `GET` | `/asset-depreciation/preview?period=YYYY\|YYYY-MM` | Xem trước kỳ: từng tài sản, theo khoa, cảnh báo sót kỳ | `asset.depreciation.view` |
| `GET` | `/asset-depreciation/runs` | Lịch sử các kỳ | `asset.depreciation.view` |
| `GET` | `/asset-depreciation/runs/:id` | Chi tiết kỳ | `asset.depreciation.view` |
| `GET` | `/asset-depreciation/runs/:id/export` | Sổ theo dõi khấu hao/hao mòn (Excel) | `asset.depreciation.view` |
| `POST` | `/asset-depreciation/runs` | Chốt kỳ `{period, note}` | `asset.depreciation.run` |
| `POST` | `/asset-depreciation/runs/:id/cancel` | Huỷ kỳ (chỉ kỳ mới nhất của mỗi loại) | `asset.depreciation.run` |

| `GET` | `/asset-inventories/meta` | Nhãn trạng thái, kết quả, cách xử lý kiểm kê | `asset.inventory.view` \| `asset.inventory.scan` |
| `POST` | `/asset-inventories/scope-preview` | Đếm thử tài sản theo phạm vi `{scope}` | `asset.inventory.manage` |
| `GET` | `/asset-inventories` | Danh sách đợt kiểm kê: `q, status` (nhiều, cách dấu phẩy) kèm tiến độ `stats` và `counts`; phạm vi nhìn theo khoa | `asset.inventory.view` \| `asset.inventory.scan` |
| `POST` | `/asset-inventories` | Lập đợt `{name, scope{departmentIds,locationIds,categoryIds,groups,includeStore}, committee[], memberIds, blind, decisionNo, plannedDate, start?}` | `asset.inventory.manage` |
| `GET` | `/asset-inventories/:id` | Chi tiết: stats, tiến độ theo khoa, người quét, lượt quét gần, `can{…}` | liên quan đợt |
| `PUT` | `/asset-inventories/:id` | Sửa đợt (phạm vi chỉ sửa khi còn NHAP) | `asset.inventory.manage` |
| `DELETE` | `/asset-inventories/:id` | Xoá đợt nháp | `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/start` | Bắt đầu = chốt sổ sách snapshot theo phạm vi, thông báo phân công | `asset.inventory.manage` |
| `GET` | `/asset-inventories/:id/items` | Dòng kiểm kê `q,result,checkState,departmentId,expected`; kiểm kê mù chỉ thấy dòng đã quét | liên quan đợt |
| `PUT` | `/asset-inventories/:id/items/:itemId` | Sửa dòng: trạng thái kiểm, vị trí/tình trạng thực tế, ghi chú | `asset.inventory.scan` \| `asset.inventory.manage` |
| `DELETE` | `/asset-inventories/:id/items/:itemId` | Xoá dòng thừa quét nhầm | `asset.inventory.scan` \| `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/items/bulk` | Đánh dấu hàng loạt `CO/KHONG_THAY/CHUA_KIEM` (dòng sổ) | `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/scans` | Aloy quét idempotent theo `clientId` — camera/máy quét/offline; lượt cũ không ghi đè lượt mới | `asset.inventory.scan` \| `asset.inventory.manage` |
| `GET` | `/asset-inventories/:id/offline-pack` | Gói lấy mẫu offline (sổ rút gọn + danh mục khoa/vị trí) | `asset.inventory.scan` \| `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/finish` | Khoá số liệu: chưa kiểm → Thiếu tự động, trình duyệt | `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/reopen` | Mở lại (dòng Thiếu tự động quay về chưa kiểm) | `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/resolve` | `{action: DIEU_CHUYEN\|BAO_MAT\|BAO_HONG\|GHI_NHAN, itemIds?, submit?}` lập chứng từ nháp/gửi duyệt | `asset.inventory.manage` |
| `POST` | `/asset-inventories/:id/complete` | Duyệt hoàn tất: ghi `lastInventoryAt`, cập nhật tình trạng hồ sơ, dòng thời gian | `asset.inventory.approve` |
| `POST` | `/asset-inventories/:id/cancel` | Huỷ đợt | `asset.inventory.manage` |
| `GET` | `/asset-inventories/:id/export` | Excel kết quả (2 sheet) | xem được đợt (không mù) |
| `GET` | `/asset-inventories/:id/print?onlyDiff=` | PDF biên bản kiểm kê (mẫu `BIEN_BAN_KIEM_KE`); `onlyDiff=true` chỉ phần chênh lệch | xem được đợt (không mù) |
| `GET` | `/asset-reports` | Danh mục 8 báo cáo + tham số mặc định | `asset.report.view` |
| `GET` | `/asset-reports/:key` | Chạy báo cáo: `so-tai-san` · `tang-giam` · `theo-khoa` · `chi-phi` · `den-han` · `het-khau-hao` · `thanh-ly` · `kiem-ke` → `columns/rows` (gồm `_kind: group\|subtotal\|total`), `summary`, `chart` | `asset.report.view` |
| `GET` | `/asset-reports/:key/export` | Excel báo cáo | `asset.report.view` |
| `GET` | `/asset-reports/:key/print` | PDF báo cáo A4 (chữ ký, số trang) | `asset.report.view` |
| `GET` | `/asset-reports/schedule?from&to&types&departmentId&group` | Lịch KĐ/BD/BH + lần lặp dự kiến (`projected`) + `overdue` | `asset.view` |

> Kiểm kê — kết quả đối chiếu: `KHOP` khớp · `SAI_VI_TRI` sai khoa/vị trí · `SAI_TINH_TRANG` khác tình trạng · `THIEU` thiếu · `THUA` thừa · `KHONG_RO` chưa có hồ sơ. Trạng thái đợt: `NHAP → DANG_KIEM_KE → CHO_DUYET → HOAN_TAT` (+ `DA_HUY`).
>
> Tác vụ định kỳ `asset.due-reminder` (mã `NHAC_HAN_TAI_SAN`, 07:30 mỗi ngày): nhắc hạn kiểm định/bảo dưỡng/bảo hành cho người quản lý tài sản (toàn viện) và trưởng khoa (khoa mình), tối đa 1 thông báo/người/ngày; cấu hình `payload.days` (mặc định 15).

### Thông báo (`/api/notifications`)

| Route | Mô tả |
|---|---|
| `GET /api/notifications?limit=12` | Danh sách phẳng cho nút chuông (giữ nguyên); kèm `unread` |
| `GET /api/notifications?page=1&pageSize=15&read=unread&module=HSBA` | Phân trang cho trang Thông báo; `read=all\|read\|unread`, `module` lọc mô-đun |
| `GET /api/notifications/modules` | Các mô-đun đã phát thông báo (dựng bộ lọc) |
| `PATCH /api/notifications/:id/read` · `PATCH /api/notifications/read-all` | Đánh dấu đã đọc (một/tất cả) |
| `DELETE /api/notifications/:id` · `DELETE /api/notifications/read` | Xoá (một/tất cả đã đọc) |

Nội bộ: mọi phân hệ gọi `NotificationCenterService.notify(userIds, input)` — tự đồng bộ
ghi DB + phát SSE `topic=notification` kèm `data` (title/body/level/link) + kênh ngoài.
Sắp xếp: các bảng danh sách nhận `sortBy`/`sortDir` (whitelist từng service).

Kênh Telegram (tuỳ chọn, nhóm khoá Cấu hình → Thông báo: `telegram.enabled`, `telegram.botToken`,
`notify.channel.appUrl`): `GET /api/notify-channels/telegram/status`, `POST /api/notify-channels/telegram/link-code`, `DELETE /api/notify-channels/telegram/link`.


## Lịch trực khám bệnh

Tiền tố `/api/duty`. Ngày dạng `YYYY-MM-DD`; thời điểm dạng ISO 8601 có múi giờ (ví dụ `2026-10-10T17:00:00+07:00`). Thông báo gửi với `module: DUTY`. Realtime topic `duty` (lọc theo quyền `duty.view`). Vi phạm ràng buộc trả `409` với thông điệp liệt kê lý do (ví dụ "Trùng giờ với ca …"); dữ liệu sai `400`; thiếu quyền `403`.

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/duty/rooms` · `/duty/shifts` · `/duty/roles` · `/duty/closed-days` | Danh mục phân trang (`q`, `activeOnly`, `page`, `pageSize`) | `duty.view` |
| `GET` | `/duty/rooms/options` · `/duty/shifts/options` · `/duty/roles/options` | Danh mục gọn cho ô chọn | `duty.view` |
| `POST` · `PUT` · `DELETE` | `/duty/rooms[/:id]` (tương tự `shifts`, `roles`, `closed-days`) | Thêm / sửa / xoá danh mục. Xoá bị chặn khi đang được dùng trong ô trực (hãy tắt thay vì xoá) | `duty.catalog.manage` |
| `GET` | `/duty/periods` | Kỳ lịch, kèm `phase` (`NHAP` · `MO` · `CHOT`) và số ô, số người. Bản nháp chỉ người quản lý thấy | `duty.view` |
| `POST` | `/duty/periods` | Tạo kỳ lịch: `name, startDate, endDate, lockAt, registrationOpensAt?, rules?, note?` | `duty.period.manage` |
| `GET` · `PUT` | `/duty/periods/:id` | Xem · sửa (kỳ đã chốt chỉ sửa tên và ghi chú; đổi ngày chỉ khi là kỳ nháp và không trùng kỳ khác) | `duty.view` · `duty.period.manage` |
| `POST` | `/duty/periods/:id/delete` | Xoá cả kỳ lịch `{reason (≥5 ký tự), confirmName (gõ lại đúng tên kỳ)}`. Chặn nếu đã có ca đã diễn ra hoặc đang diễn ra. Xoá kèm ô, phân công và yêu cầu đang chờ; báo nhân viên đã được xếp (kỳ đã công bố); nhật ký được giữ | `duty.period.manage` |
| `POST` | `/duty/periods/:id/publish` | Công bố `{force?}`: kiểm tra ô còn thiếu người, thông báo từng người được xếp | `duty.period.manage` |
| `POST` | `/duty/periods/:id/lock` | Chốt sớm (trước mốc chốt) | `duty.period.manage` |
| `POST` | `/duty/periods/:id/unlock` | Mở chốt `{reason, lockAt}` — lý do tối thiểu 5 ký tự, mốc mới phải ở tương lai | `duty.period.manage` |
| `GET` | `/duty/periods/:id/grid` | Lưới: phòng, ca, vai trò, ngày (kèm ngày nghỉ), ô kèm người trực, nghỉ phép (chỉ quản lý), `viewer` (quyền của người xem) | `duty.view` |
| `GET` | `/duty/periods/:id/my-options` | Các ca tôi có thể đăng ký, kèm lý do nếu không được | `duty.register` |
| `GET` | `/duty/periods/:id/summary` | Giờ trực, số ca, ca đêm, số ngày trực theo người; chênh lệch giờ giữa người nhiều nhất và ít nhất | `duty.manage` · `duty.manage-all` |
| `GET` | `/duty/periods/:id/logs` | Nhật ký thay đổi (kèm lý do, người thực hiện) | `duty.view` (chỉ người quản lý) |
| `GET` | `/duty/periods/:id/export` | Xuất Excel: sheet lưới lịch và sheet tổng hợp giờ | `duty.export` |
| `POST` | `/duty/periods/:id/slots/generate` | Sinh ô hàng loạt `{roomIds, shiftIds, roleIds, weekdays: [1..7], requiredCount?, skipClosedDays?}`; `requiredCount` là chỉ tiêu người trực, tối đa 4000 ô | `duty.manage` · `duty.manage-all` |
| `POST` | `/duty/periods/:id/slots` | Thêm một ô `{dutyDate, roomId, shiftId, roleId, requiredCount?, note?}`; `requiredCount` là chỉ tiêu, không phải trần phân công trực tiếp | `duty.manage` · `duty.manage-all` |
| `PUT` | `/duty/slots/:id` | Sửa chỉ tiêu người trực, ghi chú; chỉ tiêu có thể thấp hơn số đã xếp | `duty.manage` · `duty.manage-all` |
| `POST` | `/duty/slots/:id/delete` | Xoá ô. Ô đang có người trực cần `{force: true, reason}` | `duty.manage` · `duty.manage-all` |
| `GET` | `/duty/slots/:id/candidates?q=` | Ứng viên kèm kết quả kiểm tra ràng buộc (lỗi, cảnh báo, cùng khoa) | `duty.manage` · `duty.manage-all` |
| `POST` | `/duty/slots/:id/assignments` | Xếp người trực `{userId, note?, force?, reason?}`. `force` chỉ dành cho `duty.manage-all`, bắt buộc có lý do | `duty.manage` · `duty.manage-all` |
| `POST` | `/duty/assignments/:id/remove` | Gỡ người trực khỏi ca (kỳ đã chốt không gỡ tại đây) | `duty.manage` · `duty.manage-all` |
| `POST` | `/duty/slots/:id/register` · `/duty/slots/:id/unregister` | Tự đăng ký ca trống · huỷ ca tự đăng ký (trước giờ trực, kỳ chưa chốt) | `duty.register` |
| `GET` | `/duty/absences` | Nghỉ phép: người thường chỉ thấy của mình; quản lý lọc theo `from`, `to`, `userId` | `duty.view` |
| `POST` | `/duty/absences` | Ghi nhận nghỉ phép `{userId?, startDate, endDate, reason, note?}`. Trả về `affected` (ca trực bị ảnh hưởng) và báo người quản lý | `duty.register` |
| `DELETE` | `/duty/absences/:id` | Xoá ghi nhận nghỉ phép | `duty.register` |
| `GET` | `/duty/staff?q=` | Danh bạ nhân viên đang hoạt động (họ tên, chức danh, khoa) để chọn người nhận ca | `duty.register` |
| `GET` | `/duty/me` | Lịch của tôi: ca sắp tới (có `canSelfCancel`, `canRequestSwap`), nghỉ phép, kỳ đang mở | `duty.view` |
| `GET` | `/duty/requests?box=mine\|incoming\|approval\|all&periodId=` | Hộp yêu cầu, kèm `actions` cho từng dòng | `duty.register` (box `approval`: duyệt tương ứng) |
| `POST` | `/duty/requests` | Tạo yêu cầu `{type: NHUONG\|DOI\|NGOAI_LE, slotId, targetUserId?, targetSlotId?, replacementUserId?, reason, urgent?}` | `duty.register` |
| `POST` | `/duty/requests/:id/accept` · `/decline` · `/cancel` | Người nhận đồng ý (có thể chuyển sang chờ duyệt) · từ chối · người tạo huỷ | `duty.register` |
| `POST` | `/duty/requests/:id/approve` · `/reject` | Duyệt / từ chối. Đổi, nhường ca: cần `duty.swap.approve` đúng khoa. Ngoại lệ: cần `duty.exception.resolve` | `duty.swap.approve` \| `duty.exception.resolve` |
| `POST` | `/duty/exceptions/override` | Điều chỉnh người trực trực tiếp `{slotId, removeUserId?, addUserId?, reason, force?}`, kể cả sau khi chốt | `duty.exception.resolve` |

## Tích hợp máy khoá phòng khám (lịch trực, chỉ đọc)

Tiền tố `/api/integration/duty`. Dành cho máy khoá màn hình phòng khám (`phongkham-unlock`). **Không dùng JWT của người dùng.** Đây là API chỉ đọc và chỉ trả dữ liệu tối thiểu: họ tên, chức danh, mã phòng, mã ca, giờ. Không trả số điện thoại, email hay dữ liệu khác của nhân viên.

**Xác thực.** Gửi header `Authorization: Bearer qlbs_int_…`. Khoá được quản lý bằng lệnh trên máy chủ QLBS (thư mục `backend`):

```bash
npm run integration:key -- create --name "Máy khóa phòng khám"   # khoá chỉ hiện một lần, đặt vào máy khoá
npm run integration:key -- list                                  # khoá, lần dùng cuối, số lần dùng, trạng thái
npm run integration:key -- revoke --id 3                         # thu hồi ngay, mọi yêu cầu sau đó bị từ chối
```

CSDL chỉ lưu băm SHA-256 của khoá (bảng `integration_keys`, migration `0018`). Khoá có phạm vi `duty:read`. Khoá sai, đã thu hồi hoặc thiếu phạm vi đều bị từ chối.

**Giới hạn IP (tuỳ chọn).** Biến môi trường `INTEGRATION_ALLOWED_IPS=<ip>[,<ip>…]` (để trống = không giới hạn). Địa chỉ được so với IP mà API thấy. Sau nginx, đó là IP thật của máy gọi. Đã kiểm thử: gọi qua web (Next.js) và gọi trực tiếp cho kết quả giống nhau.

| Phương thức | Đường dẫn | Mô tả | Xác thực |
|---|---|---|---|
| `GET` | `/integration/duty/on-duty?room=&at=` | Ai đang trực phòng `room` (bỏ trống = mọi phòng) tại thời điểm `at`. Mặc định `at` là bây giờ. Không gồm người đang nghỉ phép | khoá, phạm vi `duty:read` |
| `GET` | `/integration/duty/roster?from=&to=&room=` | Lịch trực theo khoảng ngày `YYYY-MM-DD` (tối đa 31 ngày). Có cờ `onLeave` | như trên |
| `GET` | `/integration/duty/rooms` | Danh mục phòng đang hoạt động (`code`, `name`) | như trên |

Ví dụ:

```bash
curl -H "Authorization: Bearer $QLBS_KEY" \
  "https://<qlbs>/api/integration/duty/on-duty?room=P7&at=2026-10-12T19:30:00%2B07:00"
```

Phản hồi thành công theo chuẩn chung `{success: true, data, timestamp}`:

```json
{
  "success": true,
  "data": {
    "at": "2026-10-12T19:30:00+07:00",
    "onDuty": [{
      "room": {"code": "P7", "name": "Phòng khám số 7"},
      "dutyDate": "2026-10-12",
      "role": {"code": "BS", "name": "Bác sĩ trực"},
      "shift": {"code": "D", "name": "Ca đêm", "startTime": "17:00", "endTime": "07:00",
                "crossesMidnight": true, "startsAt": "2026-10-12T17:00:00+07:00",
                "endsAt": "2026-10-13T07:00:00+07:00"},
      "staff": {"username": "bs.huy", "fullName": "Đặng Văn Huy", "title": "Bác sĩ"},
      "onLeave": false
    }]
  },
  "timestamp": "2026-10-12T12:30:00.000Z"
}
```

Lỗi theo chuẩn chung `{success: false, statusCode, message, path, timestamp}`:

| Mã | Khi nào |
|---|---|
| 400 | `at` không phải thời điểm ISO 8601 có giờ; `from` hoặc `to` sai định dạng; `to` trước `from`; khoảng quá 31 ngày |
| 401 | Thiếu khoá, khoá sai hoặc khoá đã thu hồi |
| 403 | Khoá thiếu phạm vi, hoặc địa chỉ không nằm trong `INTEGRATION_ALLOWED_IPS` |

Quy tắc (mã nguồn: `backend/src/modules/integration/`):

- Chỉ tính **kỳ lịch đã công bố (`CONG_BO`) hoặc đã chốt (`DA_CHOT`)**. Kỳ nháp không bao giờ được trả về.
- Loại nhân sự đã vô hiệu hoá (`users.active = false`) và phòng đã đóng (`duty_rooms.active = false`).
- Ca đã tắt trong danh mục vẫn được tính nếu nằm trong kỳ đã công bố hoặc đã chốt. Tắt ca chỉ ngừng xếp ca mới; phân công đã công bố vẫn là cam kết thực tế.
- Khoảng ca: đầu ca tính vào, cuối ca không tính. Ca đêm `17:00–07:00` phủ cả buổi tối hôm trước lẫn sáng hôm sau.
- `at` không ghi múi giờ thì hiểu là giờ Bangkok (+07:00).
- Người có đơn nghỉ phép giao với ngày trực hoặc ngày kết thúc ca (với ca đêm) bị loại khỏi `on-duty`. `roster` vẫn liệt kê, với `onLeave: true`.
- Mỗi lần khoá được chấp nhận, `last_used_at` và `use_count` được cập nhật. Giá trị khoá không bao giờ được ghi vào nhật ký.

Kiểm thử: `node .ai/examples/integration-api-test.mjs` (51 kiểm tra: xác thực, ca S/C/đêm theo giờ, nghỉ phép, nháp, vô hiệu hoá nhân sự, đóng phòng, phạm vi, thu hồi, nhật ký). Kịch bản tự dọn dữ liệu.
