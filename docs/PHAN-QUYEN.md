# Phân quyền — QLBS

> Tài liệu mô tả đầy đủ mô hình phân quyền sau cải tiến 2026-09. Nếu thay đổi vai trò/quyền mặc định
> trong `backend/src/db/seed-data.ts`, hãy tái sinh **mục 3–4** bằng cách chạy lại lệnh ở cuối tài liệu.

Hệ thống dùng **PBAC** (permission-based access control): mỗi endpoint/backend yêu cầu mã quyền cụ thể,
vai trò chỉ là tập hợp quyền kèm **phạm vi dữ liệu**. Quản trị viên thao tác toàn bộ trên giao diện
*Quản trị → Vai trò* và *Quản trị → Người dùng* — không cần sửa mã nguồn.

## 1. Ba trụ cột của phân quyền

1. **Quyền chức năng** (`permissions`) — ~100 mã dạng `module.action` (vd `hsba.request.create`,
   `report.snapshot.approve`). Endpoint khai báo `@RequirePermissions('...')`; FE ẩn/hiện nút bằng `can('...')`.
2. **Phạm vi dữ liệu** (`roles.data_scope`):
   - `OWN` — chỉ dữ liệu do chính mình tạo;
   - `DEPT` — dữ liệu các khoa được gán (xem *Quyền theo khoa* bên dưới);
   - `ALL` — toàn viện.
3. **Gán khoa** (`user_department_scopes`) — danh sách khoa một người được nhìn khi vai trò có phạm vi `DEPT`.

Quy tắc hợp nhất khi một người có nhiều vai trò (thiên về "rộng nhất" để tránh mất quyền bất ngờ):

- **Quyền** = HỢP NHẤT quyền của mọi vai trò;
- **Phạm vi** = phạm vi RỘNG NHẤT (`ALL` > `DEPT` > `OWN`);
- **Khoa** = HỢP NHẤT mọi khoa đã gán.

`SUPER_ADMIN` đặc biệt: luôn có **mọi quyền ngầm** (kể cả quyền chưa gán, kể cả quyền mới thêm về sau),
toàn viện, và không bị trừ quyền bởi bất kỳ cấu hình nào.

## 2. Quy tắc bất biến (không thể vô hiệu từ giao diện)

| # | Quy tắc | Lý do an toàn |
|---|---|---|
| 1 | Vai trò `SUPER_ADMIN` không sửa được tập quyền; chỉ đổi được mô tả + màu | Tránh khoá chết quyền hệ thống |
| 2 | Chỉ `SUPER_ADMIN` mới được **gán/gỡ** vai trò `SUPER_ADMIN` cho bất kỳ ai | Chống leo thang quyền |
| 3 | Không thể gỡ `SUPER_ADMIN` khỏi người DUY NHẤT còn lại | Tránh mất hoàn toàn quyền quản trị |
| 4 | Tài khoản có vai trò `SUPER_ADMIN` chỉ `SUPER_ADMIN` khác mới chạm (đổi/xoá/khoá/đặt lại mật khẩu) | Bảo vệ tài khoản chủ |
| 5 | Không tự khoá/xoá/đặt lại mật khẩu **chính mình** từ trang quản trị | Chống tự khoá cổng |
| 6 | Tài khoản gốc tạo lúc cài đặt không bị xoá/vô hiệu | Luôn còn lối vào hệ thống |
| 7 | Vai trò hệ thống không bị tắt hoạt động; chỉ xoá được vai trò chưa có người dùng | Tránh vỡ ma trận chuẩn |
| 8 | `backup.restore` và `setting.update` chỉ thuộc `SUPER_ADMIN` | Hai thao tác nguy hiểm nhất |
| 9 | Mật khẩu tạm do hệ thống phát sinh khi đặt lại — buộc đổi lần đăng nhập tới, mọi phiên cũ bị thu hồi | Chống mật khẩu mặc định tồn tại dai |

## 3. Ma trận vai trò mặc định

| Vai trò | Mã | Phạm vi dữ liệu | Ưu tiên | Số quyền | Tóm tắt quyền chính |
|---|---|---|---|---|---|
| Quản trị tối cao | `SUPER_ADMIN` | Toàn viện | 1 | * | Toàn bộ quyền (kể cả quyền mới thêm về sau, không thể chỉnh) |
| Quản trị hệ thống | `ADMIN` | Toàn viện | 10 | 76 | Vận hành: dashboard, studio, department, job_title, user, role, hsba, report, print, utility, job, audit, setting, data, backup, file, asset — KHÔNG có backup.restore, setting.update và quyền nghiệp vụ |
| Ban giám đốc / Lãnh đạo xét duyệt | `LANH_DAO` | Toàn viện | 15 | 30 | dashboard, studio, hsba, report, asset, print, utility |
| Duyệt — TB.KHTH | `KHTB` | Toàn viện | 20 | 22 | dashboard, studio, hsba, report, print, utility |
| Bảo hiểm (xác nhận BH) | `BAO_HIEM` | Toàn viện | 20 | 13 | dashboard, studio, hsba, report, print, utility |
| Tài chính (huỷ thanh toán) | `TAI_CHINH` | Toàn viện | 20 | 12 | dashboard, studio, hsba, report, utility |
| Quản lý tài sản | `QL_TAI_SAN` | Toàn viện | 25 | 28 | dashboard, studio, asset, print, utility, file |
| Trưởng khoa | `TRUONG_KHOA` | Theo khoa | 30 | 26 | dashboard, studio, report, print, hsba, asset, utility, file |
| Người đề nghị sửa HSBA | `NHAP_LIEU` | Cá nhân | 40 | 11 | dashboard, studio, hsba, file, utility |
| Nhân viên thống kê nhập báo cáo | `NHAP_BAO_CAO` | Theo khoa | 50 | 8 | dashboard, studio, report, utility |
| Xem báo cáo | `XEM_BAO_CAO` | Theo khoa | 60 | 7 | dashboard, studio, report, utility |

## 4. Danh mục đầy đủ quyền theo vai trò

### Quản trị tối cao (`SUPER_ADMIN`)

> Tài khoản chủ của hệ thống — toàn quyền ngầm, bỏ qua mọi kiểm tra. Chỉ nên dùng 1 tài khoản dự phòng, hạn chế dùng hằng ngày

Toàn bộ quyền ngầm — không cần liệt kê; chỉ Quản trị tối cao mới gán được vai trò này.

### Quản trị hệ thống (`ADMIN`)

> Quản lý người dùng, vai trò, khoa phòng, danh mục, mẫu báo cáo/in, tác vụ, sao lưu và tiện ích — KHÔNG thao tác nghiệp vụ, KHÔNG phục hồi CSDL, KHÔNG sửa cấu hình hệ thống

`dashboard.view` · `dashboard.view-all` · `studio.dashboard.view` · `studio.dashboard.manage` · `studio.report.view` · `studio.report.manage` · `department.view` · `department.create` · `department.update` · `department.delete` · `job_title.view` · `job_title.create` · `job_title.update` · `job_title.delete` · `user.view` · `user.create` · `user.update` · `user.delete` · `user.reset-password` · `user.assign-role` · `user.import` · `user.export` · `role.view` · `role.create` · `role.update` · `role.delete` · `hsba.workflow.view` · `hsba.workflow.create` · `hsba.workflow.update` · `hsba.workflow.delete` · `report.template.view` · `report.template.create` · `report.template.update` · `report.template.delete` · `print.template.view` · `print.template.create` · `print.template.update` · `print.template.delete` · `print.template.publish` · `print.render.view` · `print.render.export` · `utility.view` · `utility.create` · `utility.update` · `utility.delete` · `job.view` · `job.create` · `job.update` · `job.delete` · `job.run` · `audit.log.view` · `setting.view` · `data.import` · `data.export` · `backup.view` · `backup.create` · `file.upload` · `file.delete` · `hsba.request.view` · `hsba.request.view-all` · `report.entry.view` · `report.entry.view-audit` · `report.view.view` · `report.view.all-departments` · `report.summary.view` · `report.export.excel` · `report.export.word` · `report.export.pdf` · `asset.view` · `asset.view-all` · `asset.dashboard` · `asset.catalog.view` · `asset.transaction.view` · `asset.inventory.view` · `asset.depreciation.view` · `asset.report.view`

### Ban giám đốc / Lãnh đạo xét duyệt (`LANH_DAO`)

> Xem toàn bộ dữ liệu đọc của bệnh viện; duyệt & khoá bản chốt kỳ báo cáo, duyệt chứng từ tài sản và biên bản kiểm kê

`dashboard.view` · `dashboard.view-all` · `studio.dashboard.view` · `studio.report.view` · `hsba.request.view` · `hsba.request.view-all` · `hsba.request.export` · `hsba.request.print` · `report.view.view` · `report.view.all-departments` · `report.summary.view` · `report.export.excel` · `report.export.word` · `report.export.pdf` · `report.snapshot.approve` · `report.snapshot.lock` · `asset.view` · `asset.view-all` · `asset.dashboard` · `asset.export` · `asset.catalog.view` · `asset.transaction.view` · `asset.transaction.approve` · `asset.depreciation.view` · `asset.inventory.view` · `asset.inventory.approve` · `asset.report.view` · `print.render.view` · `print.render.export` · `utility.view`

### Duyệt — TB.KHTH (`KHTB`)

> Trưởng ban KHTB: duyệt hoặc trả lại phiếu đề nghị sửa hồ sơ bệnh án; duyệt & khoá bản chốt kỳ báo cáo khoa

`dashboard.view` · `dashboard.view-all` · `studio.dashboard.view` · `studio.report.view` · `hsba.request.view` · `hsba.request.view-all` · `hsba.request.sign-khtb` · `hsba.request.return` · `hsba.request.comment` · `hsba.request.export` · `hsba.request.print` · `report.view.view` · `report.view.all-departments` · `report.summary.view` · `report.export.excel` · `report.export.word` · `report.export.pdf` · `report.snapshot.approve` · `report.snapshot.lock` · `print.render.view` · `print.render.export` · `utility.view`

### Bảo hiểm (xác nhận BH) (`BAO_HIEM`)

> Trưởng BP bảo hiểm: xác nhận phần bảo hiểm của phiếu đề nghị sửa hồ sơ bệnh án (bước ký giữa TB.KHTH và Tài chính); được trả lại phiếu

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `hsba.request.view` · `hsba.request.view-all` · `hsba.request.sign-insurance` · `hsba.request.return` · `hsba.request.comment` · `hsba.request.export` · `hsba.request.print` · `report.view.view` · `report.export.excel` · `utility.view`

### Tài chính (huỷ thanh toán) (`TAI_CHINH`)

> Xác nhận đã huỷ thanh toán BHYT cho hồ sơ bệnh án trước khi sửa; xem báo cáo công tác — KHÔNG được trả lại phiếu (chỉ TB.KHTH và Tr.BP bảo hiểm)

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `hsba.request.view` · `hsba.request.view-all` · `hsba.request.sign-finance` · `hsba.request.comment` · `hsba.request.export` · `hsba.request.print` · `report.view.view` · `report.export.excel` · `utility.view`

### Quản lý tài sản (`QL_TAI_SAN`)

> Phòng HC-QT / Vật tư — TBYT: toàn bộ nghiệp vụ tài sản toàn viện (hồ sơ, danh mục, chứng từ, khấu hao, kiểm kê, in tem)

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `asset.view` · `asset.view-all` · `asset.create` · `asset.update` · `asset.delete` · `asset.import` · `asset.export` · `asset.dashboard` · `asset.label.print` · `asset.catalog.view` · `asset.catalog.manage` · `asset.transaction.view` · `asset.transaction.create` · `asset.transaction.approve` · `asset.depreciation.view` · `asset.depreciation.run` · `asset.inventory.view` · `asset.inventory.manage` · `asset.inventory.scan` · `asset.inventory.approve` · `asset.report.view` · `print.render.view` · `print.render.export` · `utility.view` · `file.upload`

### Trưởng khoa (`TRUONG_KHOA`)

> Nhập & chịu trách nhiệm số liệu báo cáo của khoa; xem tài sản của khoa, lập đề nghị chứng từ, tham gia kiểm kê tại khoa

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `report.entry.view` · `report.entry.update` · `report.entry.import` · `report.entry.view-audit` · `report.view.view` · `report.export.excel` · `report.export.word` · `report.export.pdf` · `report.snapshot.create` · `print.render.view` · `print.render.export` · `hsba.request.view` · `hsba.request.sign-requester` · `asset.view` · `asset.dashboard` · `asset.transaction.view` · `asset.transaction.create` · `asset.catalog.view` · `asset.inventory.view` · `asset.inventory.scan` · `asset.report.view` · `utility.view` · `file.upload`

### Người đề nghị sửa HSBA (`NHAP_LIEU`)

> Bác sĩ / điều dưỡng: tạo phiếu đề nghị sửa hồ sơ bệnh án và ký với tư cách người đề nghị

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `hsba.request.view` · `hsba.request.create` · `hsba.request.update` · `hsba.request.sign-requester` · `hsba.request.comment` · `hsba.request.print` · `file.upload` · `utility.view`

### Nhân viên thống kê nhập báo cáo (`NHAP_BAO_CAO`)

> Chỉ nhập số liệu báo cáo công tác của khoa được gán

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `report.entry.view` · `report.entry.update` · `report.view.view` · `report.export.excel` · `utility.view`

### Xem báo cáo (`XEM_BAO_CAO`)

> Chỉ xem và kết xuất báo cáo của khoa được gán, không sửa số liệu

`dashboard.view` · `studio.dashboard.view` · `studio.report.view` · `report.view.view` · `report.export.excel` · `report.export.pdf` · `utility.view`



## 5. Quyền theo khoa (DEPT)

- Người dùng có vai trò `DEPT` (Trưởng khoa, Nhân viên thống kê, Xem báo cáo…) chỉ thấy dữ liệu của khoa được gán.
- Gán khoa tại *Quản trị → Người dùng → nút biểu tượng toà nhà*.
- Trường hợp chưa gán khoa nào: hệ thống mặc định áp dụng **khoa công tác** của người đó.

## 6. Thao tác thường dùng

### Thêm vai trò mới cho một nhóm người (khuyến nghị: nhân bản rồi chỉnh)
1. *Quản trị → Vai trò* → chọn vai trò gần giống nhất → **Nhân bản** → đặt mã mới.
2. Bật/tắt quyền theo nhóm chức năng; hệ thống cảnh báo đỏ khi bạn sắp cấp **quyền nhạy cảm**
   (quản trị người dùng, vai trò, cấu hình, sao lưu, nhật ký).
3. Chọn **phạm vi dữ liệu**, màu nhận diện, thứ tự ưu tiên → Lưu.
4. *Quản trị → Người dùng* → gán vai trò cho người cần; nếu vai trò `DEPT` thì gán thêm phạm vi khoa.

### Kiểm tra "người này đang được làm gì"
*Quản trị → Người dùng → nút con MẮT* — mở bảng **Quyền hiệu lực**: hợp nhất quyền từ tất cả vai trò,
phạm vi dữ liệu thực tế, danh sách khoa, và với từng quyền biết rõ **đến từ vai trò nào**.

### Đồng bộ vai trò hệ thống sau khi nâng cấp phiên bản
Khi bản seed mới thay đổi ma trận chuẩn, API container sẽ tự chạy đồng bộ sau migration/seed trước khi khởi động.
Việc này chỉ cập nhật **vai trò hệ thống**; vai trò do đơn vị tự tạo giữ nguyên. Có thể kiểm tra thủ công:

```bash
cd backend
npx tsx scripts/sync-system-roles.ts            # xem trước thay đổi
npx tsx scripts/sync-system-roles.ts --apply    # áp dụng ngay khi không chạy bằng container
```

Mọi quyền bị gỡ vẫn được script in ra trong log để kiểm soát.

## 7. Tái sinh mục 3–4 khi seed thay đổi

```bash
cd backend && npx tsx -e " /* xem state.md §5 hoặc lịch sử git để lấy lệnh sinh */ "
```



## 8. Lịch trực khám bệnh (`duty.*`)

Các quyền lịch trực được tạo bởi migration `0015_lich_truc.sql`; migration `0022_nguoi_xep_lich_truc_khoa.sql` bổ sung vai trò điều phối theo khoa và xoá quyền tự phục vụ cũ `duty.register`, kể cả khỏi vai trò tự tạo.

| Quyền | Ý nghĩa | Vai trò mặc định |
|---|---|---|
| `duty.view` | Xem lịch trực đã công bố, danh mục, lưới lịch | Bác sĩ/điều dưỡng và các vai trò lịch trực |
| `duty.manage` | Sinh ô, xếp và gỡ người trực tại mọi phòng; với vai trò phạm vi khoa chỉ chọn/điều chỉnh **nhân viên trong khoa được giao** | `NGUOI_XEP_LICH_TRUC_KHOA`, `KHTB`, `DIEU_PHOI_TRUC` |
| `duty.manage-all` | Xếp trực mọi phòng khám; bỏ qua ràng buộc khi có lý do | `KHTB`, `DIEU_PHOI_TRUC` |
| `duty.period.manage` | Tạo, cấu hình, công bố, chốt sớm, mở chốt và xoá cả kỳ lịch | `KHTB`, `DIEU_PHOI_TRUC` |
| `duty.catalog.manage` | Danh mục phòng khám, ca trực, vai trò trực, ngày nghỉ | `ADMIN`, `DIEU_PHOI_TRUC` |
| `duty.swap.approve` | Duyệt đổi/nhường ca trước khi chốt (**trong khoa**) | `NGUOI_XEP_LICH_TRUC_KHOA`, `KHTB`, `DIEU_PHOI_TRUC` |
| `duty.exception.resolve` | Duyệt ngoại lệ sau khi chốt; điều chỉnh người trực trực tiếp (**tài khoản đổi trực của KHTH**) | `KHTB`, `DIEU_PHOI_TRUC` |
| `duty.export` | Xuất Excel lịch và bảng giờ trực | `NGUOI_XEP_LICH_TRUC_KHOA`, `KHTB`, `DIEU_PHOI_TRUC` |

**Vai trò lịch trực**

- `DIEU_PHOI_TRUC` — *Điều phối lịch trực (KHTH)*. Phạm vi toàn viện; lập/công bố/chốt kỳ, quản lý danh mục và xử lý ngoại lệ sau khi chốt.
- `NGUOI_XEP_LICH_TRUC_KHOA` — *Người xếp lịch trực khoa*. Gán thêm cho Hành chính khoa, Chủ nhiệm khoa hoặc Phó chủ nhiệm khoa; phạm vi `DEPT`. Vai trò có thể xem và thao tác lịch ở **mọi phòng khám**, nhưng chỉ xem/chọn/xếp/gỡ/duyệt nhân viên thuộc các khoa đã gán; không lập/công bố kỳ và không điều phối nhân sự khoa khác.
- `NHAN_VIEN_TRUC` — *Nhân viên trực khám*. Bác sĩ, điều dưỡng chỉ có `duty.view`: chỉ xem lịch đã công bố. Không được tự đăng ký, nhường/đổi ca hoặc tự báo nghỉ/bận.

**Quy tắc phạm vi**

- Phòng khám là tài nguyên dùng chung: `duty.manage` không bị giới hạn bởi khoa gắn trên phòng. Với người có phạm vi `DEPT`, mọi kiểm tra phạm vi nằm ở **nhân viên được chọn** (`user.department_id` phải thuộc `user_department_scopes`), kể cả khi gọi API trực tiếp.
- `duty.swap.approve` của vai trò phạm vi khoa áp dụng cho yêu cầu của nhân viên trong khoa được giao, không theo khoa trên phòng.
- `duty.exception.resolve` là quyền toàn viện. Mỗi lần dùng đều ghi nhật ký kèm lý do.
- Bỏ qua ràng buộc khi xếp người (`force`) chỉ dành cho `duty.manage-all` và bắt buộc ghi lý do.
- Bản nháp kỳ lịch và nhật ký thay đổi chỉ người quản lý (`duty.manage` hoặc `duty.manage-all`) thấy.
- Danh sách ứng viên khi xếp trực chỉ hiển thị cho người có quyền quản lý lịch; phạm vi nhân sự luôn được kiểm tra lại ở máy chủ.
