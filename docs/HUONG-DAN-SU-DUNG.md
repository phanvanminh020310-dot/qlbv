# Hướng dẫn sử dụng — QLBS

Tài liệu ngắn gọn theo từng vai trò. Mở giao diện bằng trình duyệt (máy tính, máy tính
bảng, điện thoại đều dùng được), đăng nhập bằng tài khoản được cấp.

---

## 1. Người đề nghị sửa hồ sơ bệnh án (vai trò `NHAP_LIEU`)

**Tạo phiếu**

1. Menu **Hồ sơ bệnh án → Tạo phiếu** (hoặc nút *Tạo phiếu* ở danh sách).
2. Điền thông tin người bệnh (họ tên, năm sinh, giới tính, mã KCB, mã thẻ BHYT,
   ngày vào/ra viện, đối tượng).
3. Ghi **lý do** và **nội dung cần sửa** trong HSBA điện tử; nhập số tiền cần huỷ
   thanh toán (nếu có).
4. Kiểm tra **quy trình ký** hiển thị bên phải (mấy bước, ai ký) rồi bấm
   **Tạo phiếu**. Bật *Ký xác nhận ngay* nếu muốn phiếu chuyển thẳng sang bước duyệt.

**Theo dõi & xử lý**

* Danh sách phiếu có các tab theo bước ký; bật *Chờ tôi xử lý* để chỉ xem việc của mình.
* Phiếu **bị trả lại** hiện màu vàng, kèm lý do. Bấm **Sửa & gửi lại** → sửa nội dung →
  bấm **Gửi lại phiếu** (hệ thống yêu cầu ký lại vì nội dung đã thay đổi).
* Bấm **In bản in** để kết xuất PDF khổ A4 theo mẫu in đang ban hành.

> Lưu ý: khi phiếu đã được ký ở bước tiếp theo thì không sửa được nội dung nữa —
> người duyệt phải trả lại phiếu trước.

## 2. Duyệt – TB.KHTH (vai trò `KHTB`)

1. Menu **Hồ sơ bệnh án**, bật *Chờ tôi xử lý*.
2. Mở phiếu → xem nội dung, nhật ký và các bước ký.
3. Chọn một trong hai:
   * **Duyệt**: bấm *Ký bước này*, có thể ghi ý kiến; phiếu chuyển sang bước Bảo hiểm.
   * **Trả lại**: bấm *Trả lại*, ghi rõ lý do; phiếu quay về người đề nghị và mọi chữ
     ký cũ bị huỷ (ghi vào nhật ký).
4. Ký nhiều phiếu cùng lúc: chọn các phiếu ở danh sách → **Ký hàng loạt**.

## 3. Bảo hiểm – Trưởng BP bảo hiểm (vai trò `BAO_HIEM`)

1. Menu **Hồ sơ bệnh án**, bật *Chờ tôi xử lý*; mở phiếu đang ở bước
   *Chờ Tr.BP bảo hiểm xác nhận*.
2. Rà soát nội dung liên quan bảo hiểm rồi chọn một trong hai:
   * **Xác nhận**: bấm *Ký bước này*; phiếu chuyển sang Tài chính.
   * **Trả lại**: bấm *Trả lại*, ghi rõ lý do; phiếu quay về người đề nghị.

> Chỉ **TB.KHTH** và **Tr.BP bảo hiểm** được trả lại phiếu — Tài chính chỉ ký
> xác nhận ở bước cuối, không được trả lại.

## 4. Tài chính (vai trò `TAI_CHINH`)

1. Mở phiếu đang ở bước *Chờ TC xác nhận hủy thanh toán*.
2. Đối chiếu số tiền và giao dịch BHYT; sau khi đã hủy thanh toán trên phần mềm kế toán,
   bấm **Ký bước này** để xác nhận. Phiếu chuyển sang trạng thái **Hoàn tất**.

## 5. Nhập số liệu báo cáo của khoa (vai trò `TRUONG_KHOA`, `NHAP_BAO_CAO`)

1. Menu **Báo cáo → Nhập số liệu**; chọn **mẫu báo cáo** của khoa.
2. Chọn **kỳ** (ngày / tuần / tháng / quý / năm / khoảng ngày / toàn bộ) rồi bấm *Tải số liệu*.
3. Nhập trực tiếp vào từng ô; các cột **Công thức** tự tính theo cột được tham chiếu.
4. Bấm **Lưu số liệu**. Mọi thay đổi được lưu vết (ai sửa, giá trị cũ → mới) — xem
   *Nhật ký số liệu* trong cùng trang.
5. Có thể dán số liệu từ Excel theo hướng dẫn ở cột *Dán từ Excel* hoặc nhập một lần
   cho cả kỳ bằng tuỳ chọn *Nhập cho cả kỳ*.

## 6. Xem báo cáo & chốt số liệu

**Một khoa** — **Báo cáo**: chọn mẫu, kỳ, bấm *Xem báo cáo*; kết xuất
**Excel / Word / PDF** hoặc **In báo cáo**.

**Toàn viện** — **Báo cáo → Tổng hợp toàn viện**: bảng chỉ tiêu theo từng khoa, kèm
danh sách khoa chưa nhập số liệu trong kỳ.

**Chốt số liệu** (người có quyền `report.snapshot.create`):

1. Chọn đúng mẫu và kỳ cần chốt → bấm **Chốt số liệu kỳ này**.
2. Bản chốt lưu nguyên trạng số liệu tại thời điểm chốt và được đánh dấu *Bản nháp*.
3. Người có quyền duyệt bấm **Duyệt** rồi **Khoá** để chốt chính thức. Số liệu của bản
   chốt **không thay đổi** khi số liệu nhập về sau bị sửa.

### Xem lại và mở khoá bản chốt

* Danh sách bản chốt nằm ngay dưới nút **Chốt số liệu kỳ này** ở **Báo cáo**.
* Bấm **Xem** để mở lại đúng số liệu tại thời điểm chốt (bảng thu gọn, tô màu trạng thái).
* Bấm **Mở khoá** để đưa bản chốt về *Đã duyệt* và cho phép nhập tiếp. Việc mở khoá cần
  quyền `report.snapshot.lock` (hoặc quản trị tối cao) và luôn được ghi vào nhật ký hệ
  thống với thao tác `UNLOCK`. Khi bản chốt còn *Đã khoá*, ô nhập số liệu của kỳ đó bị
  chặn kèm cảnh báo màu vàng — tránh sửa nhầm số đã báo cáo.

## 7. Trưởng khoa / Ban giám đốc

* **Bảng điều khiển**: số phiếu theo trạng thái, số phiếu bị trả lại, tình hình nhập
  số liệu của các khoa, tác vụ sắp chạy và nhật ký gần nhất — phạm vi dữ liệu theo
  vai trò được gán.
* Duyệt số liệu: theo dõi bảng *Tổng hợp toàn viện* để biết khoa nào chưa nhập.

## 8. Quản trị hệ thống (vai trò `ADMIN`)

| Việc | Đường dẫn |
|---|---|
| Người dùng: thêm, sửa, gán vai trò, đặt lại mật khẩu, khoá tài khoản (thư điện tử, điện thoại, ghi chú không bắt buộc) | **Quản trị → Người dùng** |
| Nhập danh sách nhân viên từ Excel (.xlsx) / CSV / TXT: tải tệp mẫu → chọn tệp → xem trước từng dòng → xác nhận | **Quản trị → Người dùng → Nhập từ Excel/CSV** |
| Vai trò & quyền: tạo vai trò, tích chọn từng quyền, đặt phạm vi dữ liệu | **Quản trị → Vai trò** |
| Cây khoa phòng: thêm/sửa/xoá nhiều cấp, bật nhập báo cáo, gán mẫu báo cáo | **Quản trị → Danh mục → Khoa phòng** |
| Chức danh (Bác sĩ, Điều dưỡng…): dùng cho ô chọn chức danh; đổi tên sẽ cập nhật cho mọi người đang mang chức danh đó | **Quản trị → Danh mục → Chức danh** |
| Quy trình ký phiếu HSBA: số bước, loại người ký, cho trả lại, bắt buộc ý kiến | **Hồ sơ bệnh án → Quy trình ký** |
| Mẫu báo cáo: mục, nhóm, dòng, cột nhập/công thức, chỉ tiêu tổng hợp | **Báo cáo → Mẫu báo cáo** |
| Mẫu in: khổ giấy, lề, font, ảnh, chữ ký, phiên bản đang ban hành | **Quản trị → Mẫu in** |
| Tiện ích (menu): thêm/sửa/xoá, sắp xếp, đặt vị trí, giới hạn theo quyền | **Quản trị → Tiện ích** |
| Tác vụ định kỳ: cron, chạy tay, xem lịch sử chạy | **Quản trị → Tác vụ** |
| Cấu hình: thông tin bệnh viện, tuỳ chọn hệ thống, khôi phục mặc định | **Quản trị → Cấu hình** |
| Nhật ký toàn hệ thống (lọc theo người dùng, phân hệ, thao tác, thời gian) | **Quản trị → Nhật ký** |

### Nhập danh sách nhân viên

- Chỉ bắt buộc cột **Họ và tên**. Các cột khác (Tên đăng nhập, Chức danh, Mã khoa hoặc tên khoa, Thư điện tử, Điện thoại, Vai trò, Ghi chú, Mật khẩu, Mã nhân viên) có thể có hoặc không, thứ tự tuỳ ý, tên cột không phân biệt dấu/hoa thường.
- Tên đăng nhập để trống → tự tạo từ họ tên: “Nguyễn Văn An” → `annv` (trùng thì `annv2`…). Nhập lại cùng tệp không tạo trùng.
- Thư điện tử/điện thoại sai định dạng chỉ bị bỏ qua (cảnh báo), khoa không tìm thấy thì để trống khoa.
- Tài khoản mới dùng mật khẩu mặc định `1`, bắt buộc đổi khi đăng nhập lần đầu. Chọn “Ghi đè” để cập nhật tài khoản đã có (không đổi mật khẩu, ô trống không xoá dữ liệu cũ).
- Tệp CSV/TXT: UTF-8, UTF-16 (Excel “Unicode Text”) hoặc Windows-1258; phân cách bằng `,` `;` Tab hoặc `|`. Tệp `.xls` cũ cần lưu lại thành `.xlsx`. Tối đa 5000 dòng / 10 MB mỗi lần.

## 8b. Quản lý tài sản (vai trò `QL_TAI_SAN`; trưởng khoa xem & đề nghị)

Menu **Quản lý tài sản**: Tổng quan · Danh sách · Chứng từ · Kiểm kê · Khấu hao · Lịch bảo trì · Báo cáo · In tem · Quét mã · Danh mục.

1. **Danh mục trước tiên** (*Danh mục tài sản*): kiểm tra cây *Loại tài sản* — mỗi loại mang tiền tố mã (vd `TBYT` → `TBYT.2026.0001`), phương pháp khấu hao, thời gian sử dụng, tỉ lệ hao mòn, chu kỳ kiểm định/bảo dưỡng. Tỉ lệ nạp sẵn chỉ là tham khảo TT23/2023 — **đơn vị quân đội áp dụng theo quy định riêng của BQP, hãy sửa lại cho đúng**. Khai báo thêm *Vị trí*, *Nhà cung cấp/hãng*, *Nguồn vốn*.
2. **Đưa tài sản vào**: *Danh sách → Thêm tài sản* (chọn loại sẽ tự điền khấu hao/kiểm định; ô *Số lượng tạo* để tạo cả lô, mỗi chiếc một mã) hoặc *Nhập Excel* (tải tệp mẫu → hệ thống kiểm tra toàn bộ, chỉ ghi khi không còn dòng lỗi). Tài sản đã dùng trước đây: nhập *Hao mòn luỹ kế đầu kỳ* + *Ngày chốt số dư*.
3. **In tem & dán**: chọn tài sản → *In tem* (máy in tem nhiệt 50×30 mm mỗi tem 1 trang, hoặc giấy decal A4 — đặt *Bỏ qua ô đầu* để tận dụng tờ dùng dở). Sửa mẫu tem trong *Quản trị → Thiết kế bản in* (mẫu `TEM_TAI_SAN`). Quét QR trên tem bằng điện thoại sẽ mở ngay hồ sơ tài sản (cần đăng nhập).
4. **Nghiệp vụ = chứng từ**: cấp phát, điều chuyển, thu hồi, báo hỏng, sửa chữa, bảo dưỡng, kiểm định, đánh giá lại, đề nghị thanh lý, thanh lý, báo mất. Lập → *Gửi duyệt* → người có quyền duyệt bấm *Duyệt & áp dụng* thì tài sản mới đổi khoa/người giữ/trạng thái/hạn kiểm định và ghi vào dòng thời gian. Có thể chọn nhiều tài sản ở *Danh sách* rồi *Lập chứng từ*, hoặc quét mã liên tục trong hộp chọn. Nút **In biên bản** xuất PDF theo mẫu `BIEN_BAN_TAI_SAN` (địa danh, cơ quan cấp trên khai báo ở *Cấu hình hệ thống → Thông tin bệnh viện*).
5. **Khấu hao / hao mòn**: chọn *Hao mòn năm (TT23)* hoặc *Khấu hao tháng* → nhập kỳ → *Xem trước* (có cảnh báo sót kỳ) → *Chốt kỳ*. Xuất *Sổ theo dõi* Excel ở lịch sử; chỉ huỷ được kỳ mới nhất.
6. **Kiểm kê điện tử** (*Kiểm kê*):
   - *Lập đợt kiểm kê*: đặt tên, chọn **phạm vi** (khoa/phòng, vị trí, loại, nhóm — đếm thử số tài sản trước khi lưu), nhập **thành phần hội đồng** và **phân công quét**; bật *Kiểm kê mù* nếu muốn lực lượng độc lập quét mà không thấy sổ sách.
   - **Bắt đầu** = hệ thống chốt “sổ sách” toàn bộ tài sản thuộc phạm vi. Phạm vi không đổi được nữa (huỷ đợt để lập lại).
   - **Quét**: vào *Quét mã* trên máy tính có cắm máy quét, hoặc mở trang quét bằng điện thoại rồi bật camera quét QR trên tem.  quét chỉ cần quét — hệ thống tự đối chiếu: *Khớp · Sai vị trí · Khác tình trạng · Thiếu · Thừa · Chưa có hồ sơ*. Chọn *Tải cho chế độ offline* để quét khi mất mạng: lượt quét lưu trên máy và tự gửi khi có mạng lại (gửi thế nào cũng không bị trùng).
   - Theo dõi đợt: thanh tiến độ tổng và theo từng khoa, ai quét gì lúc nào. Có thể sửa từng dòng (có/không thấy/vị trí/tình trạng thực tế) hoặc đánh dấu hàng loạt.
   - **Khoá số liệu & trình duyệt**: phần còn lại không quét được tự tính là “Không tìm thấy” (nếu sót có thể *Mở lại*). Người điều hành lập **chứng từ xử lý chênh lệch** ngay từ đợt kiểm kê: điều chuyển về đúng nơi thực tế, báo hỏng, báo mất (chứng từ vẫn duyệt như bình thường), phần còn lại *Ghi nhận*.
   - Người có quyền `asset.inventory.approve` **Duyệt kết quả**: tài sản được ghi ngày kiểm kê và (mặc định) cập nhật tình trạng thực tế vào hồ sơ. In **Biên bản kiểm kê** (A4 ngang, mẫu `BIEN_BAN_KIEM_KE` chỉnh được trong Thiết kế bản in; chọn *chỉ phần chênh lệch* để in ngắn) hoặc xuất **Excel** kết quả.
7. **Lịch bảo trì** (*Lịch bảo trì / kiểm định*): lưới tháng các việc kiểm định/bảo dưỡng/hết bảo hành, cột ngoài **Quá hạn**, các “lần lặp dự kiến” theo chu kỳ (có thể ẩn). Nút **Tải lịch (.ics)** mở được trong Outlook/Google Calendar. Mỗi sáng 07:30 hệ thống tự gửi thông báo “Nhắc hạn thiết bị” cho phòng Vật tư (toàn viện) và trưởng khoa (khoa mình) — cấu hình trong *Quản trị → Tác vụ định kỳ*.
8. **Báo cáo tài sản** (*Báo cáo*): 8 báo cáo chuẩn — Sổ TSCĐ (cộng từng loại) · Tăng giảm trong kỳ · Theo khoa/phòng · Chi phí sửa chữa/bảo dưỡng/kiểm định · Thiết bị đến hạn · Hết khấu hao vẫn sử dụng · Ghi giảm (thanh lý, mất) · Kết quả kiểm kê. Chọn thông số → bảng hiện ngay (dòng tổng dính cuối), xuất **Excel** hoặc **In PDF** chuẩn sổ có chữ ký. Trưởng khoa tự xem báo cáo khoa mình.
6. **Quét mã**: máy quét USB/Bluetooth gõ mã + Enter, hoặc bấm biểu tượng camera (Chrome/Edge/Android).
7. Hồ sơ tài sản đã phát sinh chứng từ/khấu hao sẽ **khoá** nguyên giá, khoa, người giữ, trạng thái — muốn đổi phải lập chứng từ để đảm bảo sổ sách.

## 8c. Bảng điều khiển & báo cáo tuỳ biến (Studio)

Hệ thống có sẵn **bộ công cụ kéo-thả** (giống Power BI thu nhỏ): mọi người đều tự
dựng trang tổng quan và báo cáo của riêng mình từ các nguồn dữ liệu được cấp quyền,
không cần biết lập trình. Chấm xanh **Trực tiếp** trên đầu trang nghĩa là số liệu tự
cập nhật ngay khi có thay đổi (kết nối thời gian thực qua SSE), không phải bấm tải lại.

1. **Bảng điều khiển** (*Tổng quan → Bảng điều khiển*):
   - Trang mặc định "Tổng quan công tác" do quản trị dựng sẵn: 6 ô KPI, diễn biến
     phiếu 14 ngày, phiếu theo trạng thái, số liệu theo khoa, tác vụ định kỳ.
   - **Chỉnh sửa**: bấm *Chỉnh sửa* → thêm ô (KPI, đường, miền, cột, cột ngang,
     tròn, bánh, bảng, văn bản, ô tích hợp như Tác vụ định kỳ/Hoạt động gần đây),
     đổi rộng hẹp bằng nút **[−]/[+]**, sắp xếp bằng mũi tên, xoá ô. Ô dữ liệu bấm
     biểu tượng bánh răng để chọn **nguồn dữ liệu, chỉ số (đếm/tổng/trung bình…),
     nhóm theo, bộ lọc, khoảng thời gian** — xem trước ngay trong hộp thoại.
     Bấm **Lưu bố cục** để ghi.
   - **Nhân bản**: với trang hệ thống/vai trò, bấm *Nhân bản* để tạo bản riêng rồi
     tuỳ biến thoải mái; đặt làm **Mặc định** để mở đầu tiên khi vào.
   - **Trang mới**: nút *＋ Trang mới* tạo trang trống của riêng bạn (có thể tạo
     nhiều trang — chuyển bằng hộp chọn trên đầu).
2. **Báo cáo tuỳ biến** (*Báo cáo khoa → Báo cáo tuỳ biến*):
   - Danh sách hiển thị phạm vi: **Của tôi / Vai trò / Hệ thống**. Mở trang →
     thiết kế giống bảng điều khiển; ô **bảng dữ liệu** có nút **xuất Excel** ngay
     trên ô (máy chủ tổng hợp, tôn trọng phân quyền dữ liệu — bạn chỉ thấy nguồn
     mình được quyền xem).
   - Quản trị (quyền `studio.report.manage`) tạo báo cáo **phạm vi Hệ thống** cho
     toàn viện dùng chung.
3. **Phạm vi dữ liệu an toàn**: mọi câu hỏi dữ liệu chạy phía máy chủ qua "query
   engine" — câu hỏi chỉ gồm tên nguồn + chỉ số theo từ khoá cho phép, không SQL tự
   do; người xem thiếu quyền nguồn sẽ thấy ô trống thay vì số liệu.

## 9. Câu hỏi thường gặp

**Tôi không thấy menu nào?** Menu được cấp theo quyền — liên hệ quản trị để được gán
vai trò phù hợp. Menu **Tiện ích** hiển thị theo cấu hình *Quản trị → Tiện ích*.

**Tìm phiếu nhanh thế nào?** Ô tìm kiếm nhận cả chữ có dấu và không dấu (`hồng ánh`,
`hong anh`), tìm được theo số phiếu, mã KCB, mã thẻ BHYT, tên người bệnh, khoa.
Bấm **Bộ lọc nâng cao** để lọc theo khoa, mức ưu tiên, đối tượng, khoảng số tiền,
phiếu đã bị trả lại và chọn kiểu sắp xếp.

**Lọc sâu theo từng trường thế nào?** Trong bảng *Bộ lọc nâng cao* còn có mục **Bộ lọc
nâng cao** (dạng điều kiện): chọn *trường* → *điều kiện* (bằng, khác, chứa, từ … trở lên,
thuộc danh sách, rỗng/có giá trị…) → *giá trị*, rồi bấm **Áp dụng**. Danh sách trường,
kiểu dữ liệu và danh mục giá trị do hệ thống tự cung cấp (API `/api/meta/filters`), nên
mọi màn hình đều có cùng cách lọc. Bấm **Lưu bộ lọc** để đặt tên và dùng lại bộ điều kiện
này về sau. Các màn *Người dùng*, *Tiện ích*, *Mẫu in*, *Nhật ký* cũng có thanh lọc này.

**Thiết kế bản in ở đâu?** Vào **Quản trị → Mẫu in**, bấm **Thiết kế** ở một mẫu. Trình
thiết kế mở **toàn màn hình** theo kiểu phần mềm thương mại:

* **Ribbon** phía trên: *Trang chủ* (hoàn tác, cắt/sao chép/dán, font – cỡ chữ – đậm/nghiêng/
  gạch chân – màu chữ/nền – căn lề – giãn dòng – khung viền), *Chèn* (chữ, trường dữ liệu,
  bảng, đường kẻ, khung, ảnh/logo, mã QR, mã vạch, ô chữ ký, ngày giờ, số trang), *Bố trí*
  (căn thẳng hàng, giãn đều, cùng kích thước, thứ tự lớp, khoá, ẩn khi in, lặp mọi trang),
  *Trang in* (khổ giấy, hướng, lề, số trang tự động, chữ mờ, thêm/nhân bản/xoá trang),
  *Xem* (thu phóng, lưới, hít lưới, đường gióng thông minh, thước đo, hiện dữ liệu mẫu).
* **Cột trái**: Hộp công cụ, danh sách **Trường dữ liệu** (kéo thả thẳng vào trang), danh
  sách **Đối tượng** (ẩn/khoá từng đối tượng), **Trang** và **JSON** (tải/nạp thiết kế).
* **Khung vẽ** có thước milimét, lưới, khung chọn nhiều đối tượng, đường gióng khi kéo,
  nhấp đúp để sửa chữ trực tiếp, chuột phải để mở menu nhanh, Ctrl + lăn chuột để thu phóng.
* **Cột phải**: toàn bộ thuộc tính của đối tượng đang chọn (hoặc của cả bản in).
* **Thanh trạng thái**: khổ giấy, toạ độ con trỏ, vị trí/kích thước đối tượng, thu phóng.

Phím tắt chính: Ctrl+Z/Y, Ctrl+C/X/V/D, Ctrl+A, Delete, mũi tên (Shift ×10 mm, Alt ×0,1 mm),
Ctrl+B/I/U, Ctrl+L (khoá), Ctrl+S (lưu), Ctrl+P (xem trước PDF), F1 (bảng phím tắt đầy đủ).
Nút **Thông tin mẫu** để sửa mã/tên/loại chứng từ/khoa áp dụng; đóng trình thiết kế khi còn
thay đổi chưa lưu, hệ thống sẽ hỏi lại.

**Xem trước PDF** kết xuất đúng bằng bộ máy in của máy chủ, cho phép chọn *Dữ liệu mẫu*, *Để
trống*, lấy dữ liệu của **một phiếu HSBA thật** (tìm theo mã/tên) hoặc sửa JSON trực tiếp.

**Font chữ bản in:** mọi bản in mặc định **Times New Roman**, kể cả khi xem trước và tải PDF.
Nút **Font chữ** trong trình thiết kế cho biết máy chủ đang dùng Times New Roman gốc hay font
tương thích (Tinos — cùng kích thước ký tự), cho phép tải thêm font TTF/OTF khác. Để dùng
Times New Roman gốc của Microsoft trên máy chủ, chạy `sudo bash deploy/install-times-font.sh`
(lệnh cập nhật `deploy/update.sh` đã tự chạy bước này).

**Bản in bị lệch/thiếu chữ?** Kiểm tra *Quản trị → Mẫu in*: khổ giấy, lề và font. Bản in
được kết xuất theo đúng mẫu đang ban hành.

**Quên mật khẩu?** Liên hệ quản trị để *Đặt lại mật khẩu*; lần đăng nhập kế tiếp hệ
thống có thể yêu cầu đổi mật khẩu.

---

## 10. Trung tâm thông báo

Hệ thống thông báo 3 lớp giúp không bỏ lỡ biến động của phiếu/hồ sơ:

1. **Thông báo nổi (toast)** — khi có sự kiện liên quan tới bạn (phiếu chờ ký, phiếu
   bị trả lại kèm lý do, phiếu được duyệt thành công…), một thẻ nổi hiện ở góc dưới
   phải màn hình ngay lập tức (không cần tải lại trang). Bấm thẻ để mở thẳng phiếu;
   tự tắt sau ~9 giây. Màu viền trái thể hiện mức: xanh dương (thông tin),
   xanh lá (thành công), vàng (cảnh báo), đỏ (lỗi).
2. **Âm thanh “ting” nhẹ** và **số chưa đọc hiện trên tiêu đề tab** trình duyệt.
3. **Chuông 🔔 trên thanh công cụ + trang Thông báo** (`/thong-bao` — mục Tổng
   quan trên menu): xem lại toàn bộ, lọc theo mô-đun / chưa đọc / đã đọc, đánh dấu
   đọc tất cả, xoá các tin đã đọc.

Tuỳ chọn (bật/tắt toast, âm thanh, badge tab) nằm ngay trên đầu trang Thông báo,
lưu riêng theo từng máy sử dụng.

**Nhận thông báo qua Telegram (miễn phí, tuỳ chọn):**
quản trị viên vào *Quản trị → Cấu hình hệ thống → Thông báo*, bật “Gửi thông báo qua
Telegram Bot” và dán Bot Token (tạo miễn phí bằng `/newbot` tại @BotFather). Mỗi
người dùng vào *Cá nhân → Thông báo qua Telegram → Tạo mã liên kết*, mở bot và gởi
`/start <mã>` — xong, tin ký/duyệt sẽ đẩy thẳng về điện thoại kể cả khi không mở
phần mềm. Có thể điền “Địa chỉ web hệ thống” (ví dụ http://192.168.1.10:3000) để
tin nhắn kèm liên kết mở phiếu.


## 11. Lịch trực khám bệnh

Lịch trực lập theo **tuần** (Thứ 2 → Thứ 7), theo phòng khám × ca (sáng, chiều, cả ngày; ca đêm nếu bật). Mỗi ô có số người cần và vai trò (bác sĩ, điều dưỡng).

### 11.0 Dùng thuận tiện trên điện thoại

- Mở QLBS từ đường link **HTTPS** lần đầu sẽ có nút **Cài ứng dụng**. Trên Android/Chrome, chạm nút và xác nhận hộp cài của trình duyệt. Trên iPhone/iPad, mở bằng Safari → **Chia sẻ** → **Thêm vào Màn hình chính**. Khi đã cài, lời mời sẽ tự ẩn và QLBS mở như một ứng dụng riêng.
- Trong **Lịch trực tuần**: chọn tuần → chọn ngày → chạm vào thẻ phòng để xem từng ca hoặc xếp người. Nhãn vàng cho biết số vị trí còn thiếu; người xếp lịch có thể bấm **vị trí cần xếp** để chỉ xem các phòng cần xử lý.

### 11.1 Điều phối lịch (KHTH, vai trò `DIEU_PHOI_TRUC`)

1. **Kỳ lịch & công bố → Tạo kỳ lịch.** Đặt tên, từ ngày đến ngày, **mốc chốt lịch** (sau mốc này lịch tự khoá), thời điểm mở đăng ký tự nguyện (nếu cần) và các ràng buộc giờ trực. Hai kỳ lịch không được trùng ngày; thời điểm mở đăng ký phải trước mốc chốt.
2. **Sinh ô trực.** Chọn phòng, ca, vai trò và các thứ trong tuần. Ngày nghỉ lễ được bỏ qua tự động. Có thể thêm lẻ từng ô.
3. **Xếp người.** Vào **Lịch trực tuần**, bấm vào ô → *Quản lý người trực*. Danh sách ứng viên có nhãn *Phù hợp / Có cảnh báo / Không đủ điều kiện*, kèm lý do cụ thể.
4. **Công bố.** Hệ thống kiểm tra ô còn thiếu người. Sau khi công bố, mỗi người trực nhận thông báo.
5. **Theo dõi** số ô còn thiếu trên các chỉ số đầu trang. Nhân viên có thể tự đăng ký ca trống trước mốc chốt.
6. **Chốt.** Tự động theo mốc chốt, hoặc bấm *Chốt sớm*. Muốn mở lại: *Mở chốt* và ghi lý do.
7. **Ngoại lệ sau chốt.** Yêu cầu ngoại lệ nằm ở **Yêu cầu đổi trực → Chờ tôi duyệt**; duyệt để gỡ người cũ và xếp người thay. Khi cần đổi gấp, dùng **Điều chỉnh trực tiếp** (bắt buộc ghi lý do; chỉ bỏ qua ràng buộc khi thật cần).
8. **Xoá cả kỳ lịch** (*Kỳ lịch → Xoá kỳ lịch*). Phải ghi lý do (tối thiểu 5 ký tự) và gõ lại đúng tên kỳ. Không xoá được khi đã có ca trực đã diễn ra hoặc đang diễn ra, để giữ dữ liệu đối soát giờ trực. Nhân viên đã được xếp nhận thông báo huỷ ca; nhật ký vẫn được giữ.

### 11.2 Người xếp lịch trực khoa (`NGUOI_XEP_LICH_TRUC_KHOA`)

- Xem, tạo/sửa ô và xếp/gỡ người trực tại **mọi phòng khám**; không còn bị khóa theo khoa gắn trên phòng.
- Danh sách chọn người chỉ hiển thị và chỉ cho phép phân công **nhân viên thuộc khoa/phạm vi khoa đã được gán**. Hệ thống chặn cả trường hợp gửi yêu cầu API trực tiếp để chọn người ngoài phạm vi.
- Duyệt đổi/nhường của nhân viên trong khoa trước khi chốt; xuất Excel lịch và bảng giờ trực.

### 11.3 Nhân viên trực (`NHAN_VIEN_TRUC`)

- **Lịch của tôi**: xem ca sắp tới; đăng ký ca trống khi kỳ đã công bố và chưa chốt; huỷ ca tự đăng ký trước giờ trực.
- **Nhường / đổi ca**: chọn đồng nghiệp hoặc ca của đồng nghiệp; người kia đồng ý; sau đó chờ duyệt nếu cấu hình yêu cầu duyệt.
- **Báo nghỉ / bận**: ca trong khoảng ngày đó sẽ không được xếp cho bạn; nếu đã có ca, Điều phối được báo. Chỉ khai từ hôm nay trở đi, và không trùng khoảng đã khai.
- **Báo sự cố / thay trực**: dùng khi không thể trực. Sau khi lịch đã chốt, đây là cách duy nhất để đổi người (gửi KHTH).

### 11.4 Danh mục (`ADMIN`, `DIEU_PHOI_TRUC`)

- **Phòng khám**: mã, tên, khoa quản lý, vị trí. Phòng đã có ô trực thì tắt thay vì xoá.
- **Ca trực**: mã, giờ bắt đầu và kết thúc (kết thúc trước giờ bắt đầu là ca qua đêm), đánh dấu ca đêm. Mặc định: S 07:00–12:00, C 12:00–17:00, CD 07:00–17:00; ca đêm D để tắt sẵn. Chọn màu bằng bảng màu có sẵn (bấm ô màu; cần màu khác thì bấm *Màu khác*). Không đổi giờ hay tính chất ca đêm khi ca đang được dùng: tắt ca cũ và tạo ca mới.
- **Vai trò trực**: bác sĩ, điều dưỡng, kèm chức danh bắt buộc. Không đổi chức danh khi vai trò đang được dùng.
- **Ngày nghỉ**: ngày không sinh ô trực khi tạo lịch. Không đánh dấu ngày nghỉ khi ngày đó đã có ô trực.

> Mặc định hệ thống có 15 phòng "Phòng khám số 1…15" chưa gắn khoa. Hãy đổi tên và gắn khoa quản lý trước khi dùng thật.

### 11.5 Ràng buộc được kiểm tra tự động

Kỳ lịch mới mặc định **1 ca tối đa/ngày**. Các ngưỡng số giờ/ngày, giờ/tuần, nghỉ tối thiểu, tổng ca/kỳ và ca đêm/kỳ mặc định là **0 = không giới hạn**; có thể đặt lại riêng cho từng kỳ. Riêng ca đêm liền kề một ca khác vẫn bị chặn để tránh hai ca sát nhau không có khoảng chuyển ca.

| Ràng buộc | Kết quả |
|---|---|
| Trùng giờ giữa hai ca | Chặn |
| Nghỉ giữa hai ca dưới mức đã cấu hình; ca đêm liền kề ca khác | Chặn |
| Vượt giờ trực trong ngày/tuần khi kỳ lịch đặt giới hạn lớn hơn `0` | Chặn |
| Sai chức danh; đang nghỉ phép; ô đã đủ người; ca đã qua; kỳ đã chốt | Chặn |
| Khác khoa với phòng | Cảnh báo (có thể cấu hình thành chặn) |
| Ca sáng và ca chiều liền nhau trong cùng ngày | Được phép |
| Hai kỳ lịch trùng ngày | Chặn |
| Mở đăng ký sau mốc chốt; đánh dấu ngày nghỉ khi đã có ô trực; đổi giờ hoặc ca đêm của ca đang dùng; đổi chức danh của vai trò đang dùng | Chặn |
| Nghỉ phép trùng khoảng đã khai; nhân viên khai nghỉ cho ngày đã qua | Chặn |

### 11.6 Nhật ký và báo cáo

Mọi thao tác quan trọng được ghi vào **Kỳ lịch → Nhật ký**, kèm người thực hiện và lý do. Tab **Giờ trực** cho thấy số ca, ca đêm, số ngày trực, tổng giờ theo người và độ chênh lệch giữa người nhiều nhất và ít nhất để điều chỉnh cho công bằng. Tab **Giờ trực** và **Nhật ký** chỉ người quản lý lịch thấy. Khi xoá kỳ lịch, nhật ký vẫn được giữ, ghi rõ tên kỳ, người xoá và lý do.

### 11.7 Theo dõi xác thực và xử lý sự cố máy trạm

Người có quyền điều phối mở **Lịch trực → Theo dõi xác thực** để quan sát đúng các ca đang diễn ra. Nhãn **Đã xác thực** chỉ xuất hiện khi hệ thống đã lưu kết quả **sinh trắc học khuôn mặt AI**.

Khi máy tính phòng khám gặp sự cố, kỹ thuật viên có thể dùng PIN IT đã được cấu hình để mở khẩn cấp trong phạm vi ca hiện hành. Hệ thống ghi bền vững sự kiện này tại đúng phòng, ca và người trực bị ảnh hưởng; trang theo dõi hiển thị nhãn **Mở khẩn cấp IT** cùng thời điểm và có bộ lọc riêng. Sự kiện PIN IT **không** được tính là xác thực khuôn mặt, không biến thành trạng thái “Đã xác thực”, và vẫn cần hoàn thành sinh trắc học khi điều kiện cho phép.

Đăng ký hồ sơ khuôn mặt tại **Cá nhân**: bấm **Bật Camera và cấp quyền** rồi chấp thuận yêu cầu của trình duyệt. Trên iPhone, thao tác cấp quyền phải được bấm trực tiếp trong Safari và hệ thống phải được mở bằng địa chỉ **HTTPS**; nếu quyền từng bị từ chối, vào *Cài đặt → Safari → Camera* để cho phép rồi bấm thử lại. Có thể dùng mục tải ảnh chân dung khi camera thiết bị không khả dụng.
