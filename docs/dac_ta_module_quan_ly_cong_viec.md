# ĐẶC TẢ PHÂN HỆ QUẢN LÝ CÔNG VIỆC (GIAO VIỆC – THỰC HIỆN – DUYỆT)

> Tài liệu này vừa là **prompt đặc tả đầy đủ** vừa là **thiết kế triển khai** của phân hệ
> “Quản lý công việc” trong QLBV. Đã đối chiếu nghiệp vụ của các ứng dụng quản lý công việc
> hàng đầu (Asana, Jira, Trello, ClickUp, Monday.com, Wrike, Bitrix24 Tasks, Microsoft Planner,
> Basecamp) và chọn lọc những gì phù hợp môi trường bệnh viện công: giao việc theo khoa/phòng,
> có người duyệt kết quả, truy vết đầy đủ, báo cáo hiệu suất định kỳ.

---

## 1. Mục tiêu

1. Lãnh đạo khoa/phòng **giao việc** cho cá nhân hoặc **giao dự án** cho nhóm; mỗi người thấy rõ việc
   của mình, hạn chót, ưu tiên.
2. Người thực hiện đi theo quy trình chuẩn: **Nhận việc → Đang làm → Gửi duyệt (kèm kết quả và tệp)**.
3. Người giao/duyệt: **Duyệt hoàn thành – Trả lại làm lại – Hủy**.
4. Mọi thay đổi đều có **nhật ký, lịch sử, audit**; mỗi việc có **khung trao đổi (chat)** riêng.
5. Thông báo **trong web (chuông + toast realtime)** và **Telegram** cho từng người liên quan.
6. **Tổng quan, hiệu suất, thống kê theo ngày/tuần/tháng**, xuất **Excel/CSV/Word/PDF**, in theo
   **mẫu thiết kế bản in** với **nguồn dữ liệu SQL** linh hoạt.
7. **Bảng Kanban** kéo thả trực quan.
8. Không ảnh hưởng chức năng cũ; triển khai chỉ bằng `cd /opt/qlbs && sudo bash deploy/update.sh`.

## 2. Đối chiếu ứng dụng hàng đầu → yêu cầu được bổ sung

| Tính năng | Lấy cảm hứng từ | Áp dụng trong QLBV |
|---|---|---|
| Quy trình trạng thái có duyệt (review/approval) | Jira workflow, Wrike approvals, Bitrix24 “kiểm soát kết quả” | Máy trạng thái 9 trạng thái, chỉ người có thẩm quyền mới chuyển |
| Người thực hiện chính + người theo dõi (watcher) | Jira, Asana collaborators, Bitrix24 observers | `assignee`, `reviewer`, danh sách theo dõi |
| Việc con (subtask) & checklist | Asana, ClickUp, Planner | Việc con là một công việc đầy đủ; checklist nhẹ trong việc |
| Dự án nhiều thành viên, ai làm việc gì | Asana Projects, Basecamp, Monday | Dự án + thành viên + bảng “Ai làm gì” + tiến độ |
| Ưu tiên, hạn chót, quá hạn, nhắc hạn | Mọi ứng dụng | 4 mức ưu tiên, nhắc trước hạn, cảnh báo quá hạn tự động |
| Phụ thuộc (blocked by) | Jira, Wrike, ClickUp | Không cho bắt đầu khi việc tiên quyết chưa xong |
| Việc lặp lại | Asana, ClickUp, Planner | Lặp ngày/tuần/tháng, tự sinh lần kế tiếp khi hoàn thành |
| Nhãn (label/tag) | Trello, Jira | Mảng nhãn tự do, lọc theo nhãn |
| Mẫu công việc (template) | ClickUp, Asana | Mẫu tiêu đề/mô tả/checklist/ưu tiên/ước lượng |
| Bình luận + @nhắc tên | Mọi ứng dụng | Chat trong việc, @username gởi thông báo |
| Nhật ký công việc / log giờ | Jira worklog, Bitrix24 time tracking | Nhật ký ngày: giờ làm, nội dung, % tiến độ |
| Lịch sử thay đổi trường (activity) | Jira history | Bảng `task_logs` lưu trạng thái trước/sau + diff trường |
| Kanban kéo thả | Trello, Jira board | Cột theo trạng thái, kéo thả gọi đúng thao tác nghiệp vụ |
| Báo cáo khối lượng (workload) & hiệu suất | Monday, Wrike, ClickUp | Theo người/khoa/dự án; điểm hiệu suất có công thức minh bạch |
| Từ chối nhận việc có lý do | Bitrix24 | Trạng thái `Từ chối` → người giao giao lại |
| Tạm hoãn | Wrike “On hold” | Trạng thái `Tạm hoãn` |

## 3. Vai trò và phân quyền

| Mã quyền | Ý nghĩa |
|---|---|
| (đăng nhập) | Mọi nhân viên xem/thao tác **việc liên quan đến mình** (được giao, theo dõi, là thành viên dự án) |
| `task.assign` | Giao việc, tạo dự án, tạo mẫu công việc cho nhân viên **trong phạm vi khoa/phòng** (data_scope) |
| `task.manage` | Quản lý (xem/duyệt/trả lại/hủy/sửa) **mọi** công việc thuộc phạm vi khoa/phòng |
| `task.report` | Xem tổng quan, thống kê, hiệu suất theo phạm vi |
| `task.export` | Xuất báo cáo Excel/CSV/Word/PDF |
| `print.datasource.sql` | Soạn/chạy **nguồn dữ liệu SQL** trong Thiết kế bản in (chỉ đọc, an toàn) |

* Vai trò hệ thống mới **`QUAN_LY_CONG_VIEC`** (Quản lý giao việc khoa/phòng, phạm vi DEPT).
* **Trưởng khoa** (`TRUONG_KHOA`) được bổ sung `task.assign/manage/report/export`.
* **Lãnh đạo** (`LANH_DAO`, phạm vi ALL) được `task.assign/manage/report/export`.
* **Quản trị hệ thống** (`ADMIN`) được `print.datasource.sql`.
* Quyền tùy chỉnh của vai trò hệ thống được **giữ nguyên** khi chạy `update.sh` (seed chỉ bổ sung).

**Phạm vi:** phạm vi DEPT chỉ giao/quản lý nhân viên thuộc các khoa được gán; phạm vi ALL thấy toàn viện.
Người duyệt/người giao luôn thao tác được việc do mình giao dù khác khoa.

## 4. Máy trạng thái

```
            ┌─────────── Từ chối (DECLINED) ◄──┐
 Nháp ──► Đã giao (ASSIGNED) ──► Đã nhận (ACCEPTED) ──► Đang làm (IN_PROGRESS) ──► Chờ duyệt (SUBMITTED)
 (DRAFT)        ▲                     │                   ▲   │                       │      │
                └── Giao lại ─────────┘                   │   └► Tạm hoãn (ON_HOLD) ──┘      │
                                                          └──── Trả lại (RETURNED) ◄─────────┤
                                                                                     Hoàn thành (DONE)
 Mọi trạng thái chưa kết thúc ──► Đã hủy (CANCELLED)          Hoàn thành ──(Mở lại)──► Trả lại
```

| Thao tác | Từ trạng thái | Sang | Ai | Bắt buộc |
|---|---|---|---|---|
| Giao việc | DRAFT, DECLINED | ASSIGNED | Người giao/quản lý | Có người thực hiện |
| Nhận việc | ASSIGNED | ACCEPTED | Người thực hiện | — |
| Từ chối | ASSIGNED | DECLINED | Người thực hiện | Lý do |
| Bắt đầu | ACCEPTED, RETURNED, ON_HOLD | IN_PROGRESS | Người thực hiện | Việc tiên quyết đã xong |
| Tạm hoãn | ACCEPTED, IN_PROGRESS | ON_HOLD | Người thực hiện/quản lý | Lý do |
| Gửi duyệt | IN_PROGRESS, ACCEPTED, RETURNED | SUBMITTED | Người thực hiện | Nội dung kết quả; việc con đã kết thúc |
| Duyệt hoàn thành | SUBMITTED | DONE | Người duyệt/quản lý | — |
| Trả lại | SUBMITTED | RETURNED | Người duyệt/quản lý | Lý do |
| Hủy | mọi trạng thái chưa kết thúc | CANCELLED | Người giao/quản lý | Lý do |
| Mở lại | DONE, CANCELLED | RETURNED | Người giao/quản lý | Lý do |

Mỗi lần chuyển: ghi `task_logs` (trạng thái trước/sau, lý do, IP), audit, phát realtime, thông báo
web + Telegram cho người liên quan. Người thực hiện tự giao cho chính mình vẫn cần duyệt (trừ khi người
giao = người duyệt = người thực hiện: cho phép tự duyệt).

## 5. Dữ liệu (migration bổ sung `0044_quan_ly_cong_viec.sql`)

* `task_projects`: dự án (mã DA-YYYY-####, tên, mô tả, khoa, quản lý dự án, trạng thái, ưu tiên,
  ngày bắt đầu/kết thúc, màu, lưu trữ).
* `task_project_members`: thành viên dự án (vai trò MANAGER/MEMBER/VIEWER).
* `tasks`: công việc (mã CV-YYYY-#####, tiêu đề, mô tả, dự án, việc cha, khoa, người giao, người thực
  hiện, người duyệt, trạng thái, ưu tiên, ngày bắt đầu, hạn chót, ước lượng giờ, % tiến độ, nhãn,
  nội dung kết quả, các mốc thời gian nhận/bắt đầu/gửi/duyệt/hủy, số lần trả lại, lặp lại, cờ nhắc).
* `task_watchers`, `task_dependencies`, `task_checklist_items`.
* `task_comments`: chat theo việc (có @nhắc tên).
* `task_attachments`: tệp tham khảo / tệp kết quả theo lần gửi duyệt / tệp trong chat.
* `task_worklogs`: nhật ký công việc (ngày, giờ, nội dung, % tiến độ).
* `task_logs`: lịch sử thay đổi (trạng thái, trường thay đổi trước/sau).
* `task_templates`: mẫu công việc.
* View an toàn phục vụ báo cáo/in: `v_cv_cong_viec`, `v_cv_du_an`, `v_cv_nhat_ky`, `v_cv_trao_doi`,
  `v_cv_nhat_ky_cong_viec`, `v_nguoi_dung` (không có mật khẩu, khóa 2 lớp, Telegram).
* Mẫu in mặc định: Báo cáo tình hình công việc, Báo cáo hiệu suất nhân viên, Phiếu giao việc.

Tất cả chỉ **thêm mới** (CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING) — không sửa/xóa dữ liệu cũ.

## 6. Tệp đính kèm

* Cho phép: ảnh (png, jpg, gif, webp, heic), pdf, txt, csv, doc/docx, xls/xlsx, ppt/pptx, odt/ods/odp,
  rtf, zip/rar/7z. Tối đa 15MB/tệp, 10 tệp/lần; tổng dung lượng một lần gửi còn bị giới hạn bởi `UPLOAD_MAX_MB` (mặc định 25MB, base64 phình ≈33%).
* Kiểm tra chữ ký đầu tệp (ảnh, PDF, Office OOXML/zip) chống đổi đuôi; lưu ngoài web root,
  ghi nguyên tử, tải về qua API có kiểm tra quyền xem việc.
* Tệp kết quả gắn với **lần gửi duyệt** (`submission_no`) để biết bản nào bị trả lại.

## 7. Thông báo

| Sự kiện | Người nhận | Web | Telegram |
|---|---|---|---|
| Được giao việc / giao lại | Người thực hiện | ✓ | ✓ |
| Nhận việc / Từ chối / Tạm hoãn | Người giao, người duyệt | ✓ | ✓ |
| Gửi duyệt | Người duyệt (hoặc người giao) | ✓ | ✓ |
| Duyệt / Trả lại / Hủy / Mở lại | Người thực hiện + theo dõi | ✓ | ✓ |
| Bình luận mới | Người liên quan (trừ người viết) | ✓ | — |
| @Nhắc tên | Người được nhắc | ✓ | ✓ |
| Sắp đến hạn (mặc định trước 24 giờ) | Người thực hiện | ✓ | ✓ |
| Quá hạn | Người thực hiện + người giao | ✓ | ✓ |
| Được thêm vào dự án | Thành viên | ✓ | ✓ |

**Telegram & số điện thoại:** Telegram Bot API **không cho phép bot nhắn tin chỉ bằng số điện thoại**;
bot cần mã cuộc trò chuyện (chat_id) do người dùng mở bot trước. Vì vậy hệ thống bổ sung **liên kết
bằng số điện thoại**: nhân viên mở bot, bấm **“📱 Chia sẻ số điện thoại”**; nếu số trùng với số điện
thoại đã khai báo trong hồ sơ người dùng thì tự liên kết. Từ đó mọi thông báo công việc được gởi qua
Telegram. Cách liên kết bằng mã ở trang Cá nhân vẫn giữ nguyên.

## 8. Giao diện

1. **Tổng quan công việc** (`/cong-viec`): thẻ KPI (đang mở, chờ nhận, đang làm, chờ duyệt, quá hạn,
   hoàn thành kỳ, tỷ lệ đúng hạn), biểu đồ xu hướng giao/hoàn thành theo ngày/tuần/tháng, phân bố trạng
   thái, ưu tiên; “Việc của tôi” (quá hạn, hôm nay, sắp tới), “Chờ tôi duyệt”, “Tôi đã giao”.
2. **Danh sách công việc** (`/cong-viec/danh-sach`): lọc theo phạm vi (của tôi/tôi giao/tôi duyệt/theo
   dõi/tất cả trong phạm vi), trạng thái, ưu tiên, khoa, dự án, người thực hiện, nhãn, hạn, từ khóa;
   phân trang; tạo việc mới.
3. **Kanban** (`/cong-viec/kanban`): cột theo trạng thái; kéo thả thực hiện đúng thao tác (thả vào
   “Chờ duyệt” mở hộp nhập kết quả, thả vào “Trả lại” bắt nhập lý do…); hỗ trợ cảm ứng qua menu
   “Chuyển sang…”; hiển thị ưu tiên, hạn, người làm, tiến độ checklist.
4. **Chi tiết công việc** (`/cong-viec/[id]`): thông tin, thanh thao tác theo quyền, kết quả và tệp theo
   lần gửi, việc con, checklist, phụ thuộc, người theo dõi; các thẻ **Trao đổi**, **Nhật ký công việc**,
   **Tệp**, **Lịch sử & audit**.
5. **Dự án** (`/cong-viec/du-an`, `/cong-viec/du-an/[id]`): danh sách, tiến độ; chi tiết gồm thành viên,
   bảng “Ai làm việc gì”, dòng thời gian (Gantt rút gọn), công việc theo trạng thái.
6. **Báo cáo – thống kê** (`/cong-viec/bao-cao`): chọn kỳ (ngày/tuần/tháng/tùy chọn), khoa, dự án;
   hiệu suất theo nhân viên, theo khoa, theo dự án, chuỗi thời gian; xuất **Excel (nhiều sheet), CSV,
   Word, JSON**; **In theo mẫu bản in** (PDF) dùng nguồn SQL.
7. **Mẫu công việc** (`/cong-viec/mau`).

## 9. Hiệu suất – công thức minh bạch

* Tỷ lệ hoàn thành = Hoàn thành / (Được giao trong kỳ − Đã hủy).
* Tỷ lệ đúng hạn = Hoàn thành đúng hạn / Hoàn thành có hạn chót.
* Tỷ lệ trả lại = Số việc bị trả lại ≥ 1 lần / Số việc đã gửi duyệt.
* **Điểm hiệu suất (0–100)** = 50% × tỷ lệ đúng hạn + 30% × tỷ lệ hoàn thành + 20% × (1 − tỷ lệ trả lại).
* Thời gian hoàn thành trung bình (giờ) = trung bình (duyệt xong − giao).
* Giờ công ghi nhận = tổng giờ trong nhật ký công việc.

## 10. Thiết kế bản in – Nguồn dữ liệu SQL

* Thêm thẻ **“Nguồn SQL”** trong trình thiết kế: khai báo **nhiều truy vấn** (mỗi truy vấn một khóa),
  **tham số** (`:tu_ngay`, `:den_ngay`, `:khoa_id`…) có kiểu và giá trị mặc định; **Chạy thử** xem bảng
  kết quả; **Tự tạo danh sách trường** để kéo vào bản in; **Xuất Excel/CSV** dữ liệu bất kỳ.
* Kết quả: truy vấn đầu tiên là `rows` (bảng mặc định), mọi truy vấn có ở `ds.<khóa>` (bảng) và
  `one.<khóa>.<cột>` (dòng đầu, dùng cho ô trường), tham số ở `params.<tên>`.
* Tham số hệ thống tự cấp: `:nguoi_dung_id`, `:khoa_id`, `:pham_vi_khoa` (mảng khoa được phép, NULL =
  toàn viện) để mẫu tự giới hạn theo phạm vi người in.
* An toàn: chỉ một câu SELECT/WITH; giao dịch **READ ONLY**, timeout 15 giây, tối đa 5.000 dòng; chặn
  ghi/khóa/hàm quản trị, chặn bảng và cột nhạy cảm (mật khẩu, khóa 2 lớp, khóa tích hợp, sinh trắc
  học, cấu hình, nhật ký đăng nhập, danh mục hệ thống `pg_*`), chặn `query_to_xml`… Người soạn SQL
  cần quyền `print.datasource.sql`; người in chỉ cần quyền kết xuất.

## 11. Kiểm thử & triển khai

* Unit test máy trạng thái, phân quyền, chính sách SQL in ấn, gắn tham số.
* Test PostgreSQL (PGlite) chạy migration thật: luồng giao → nhận → làm → gửi → trả lại → gửi → duyệt,
  hủy, việc con, phụ thuộc, tệp, chat, nhật ký, báo cáo, view in ấn, mẫu in mặc định render được PDF.
* Build backend và frontend; chạy test updater.
* Triển khai: `cd /opt/qlbs && sudo bash deploy/update.sh` (migration tự chạy khi khởi động backend,
  seed chỉ bổ sung quyền/vai trò).
