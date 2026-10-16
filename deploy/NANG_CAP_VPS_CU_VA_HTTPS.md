# Nâng VPS QLBS cũ và dùng Kiosk với chứng chỉ HTTPS khác

## 1. Không khẳng định nâng được mọi bản cũ

`deploy/update.sh` cập nhật code và dựng API/web; khi container API khởi động, nó chạy **migration → seed → API**. Migration mới `0021_duty_absence_approval.sql` thêm bảng yêu cầu nghỉ/bận riêng, không xóa phân công, không đổi các bản ghi nghỉ có hiệu lực trước đây.

Chưa có phiên bản, cấu hình hay quyền truy cập VPS3 để kiểm tra trực tiếp. Trước nâng cấp phải xác nhận:

- VPS dùng đúng repository/nhánh, Docker Compose và cấu trúc dịch vụ `postgres/api/web` của dự án.
- PostgreSQL vẫn dùng đúng dữ liệu/volume cũ. **Không đổi major PostgreSQL, không đổi đường dẫn volume/bind-mount** trong cùng thao tác nâng API. Repository hiện dùng `postgres:16-alpine`; nếu VPS đang khác major cần kế hoạch dump/restore riêng.
- CSDL có lịch sử `_qlbs_migrations` phù hợp, không phải schema nhập thủ công hoặc bản fork không tương thích. Nếu bảng tracking thiếu hoặc migration cũ từng được sửa tay, dừng để đối chiếu; không tự đánh dấu migration là đã chạy.
- Các thay đổi cục bộ được rà soát (`git status --short`). Không dùng `git reset --hard`, `git clean`, không chép `.env.example` đè `.env`, không `docker compose down -v` và không xóa `data/postgres`.
- Có đủ dung lượng backup/build và cửa sổ bảo trì. Một API restart sẽ thu hồi lease Kiosk trong RAM, máy trạm cần xác thực lại; không hứa không gián đoạn.

## 2. Lệnh nâng khuyến nghị khi các điều kiện trên đạt

```bash
cd /opt/qlbs                 # thay bằng đúng thư mục thật nếu khác
sudo bash deploy/update.sh --all --backup
```

Dùng `--all` để dựng cả API và web, kể cả đã `git pull` bằng tay trước đó. Không chỉ nâng EXE mà bỏ backend cũ.

**Ở bản update.sh mới:**

1. `--backup` sao chép `.env`, compose/override, `data/ssl` nếu có và dump PostgreSQL trước pull/build/migrate vào `data/upgrade-backups/pre-update-.../`, quyền riêng tư `0700/0600`. Thư mục này không phải thư mục backup được API phục vụ.
2. Dump lỗi, rỗng hoặc không đọc được bằng `pg_restore --list` làm **dừng cập nhật**; file `.partial` bị xóa. Kiểm tra danh mục archive không thay thế thử restore đầy đủ.
3. Chỉ pull fast-forward; xung đột khi phục hồi stash hoặc `.env` bị thay đổi làm dừng trước build. Không tiếp tục với cây mã đang xung đột.
4. Dựng API/web tuần tự, dùng dữ liệu hiện hữu. Không tạo lại certificate, không bật/tắt HTTPS, không tự thay `.env` hoặc port.
5. Chờ API, web và proxy web→API khỏe; lỗi health trả mã khác 0. Dữ liệu/cấu hình vẫn cần được kiểm tra nghiệp vụ sau nâng.

Nếu đang gọi **một update.sh rất cũ**, bước pull đầu tiên vẫn chạy bằng bản cũ trước khi tự chạy lại bản mới. Với trường hợp này phải sao lưu cấu hình/chứng thư và CSDL bằng quy trình CNTT đang dùng **trước lần chạy đầu tiên**, đồng thời bảo đảm working tree không có sửa đổi chưa xử lý. Không suy diễn rằng tính năng backup mới có thể bảo vệ ngược các thao tác mà bản cũ đã thực hiện.

Kiểm tra sau nâng (không hiển thị `.env`/mật khẩu):

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose exec -T api npm run db:migrate -- --status
```

Đối chiếu migration `0021`, đăng nhập quản lý và thử quy trình nghỉ/bận. Thử restore bản backup trong môi trường tách biệt trước khi triển khai diện rộng. Không chỉ rollback code sau khi schema đã thay đổi; rollback dữ liệu phải theo bản backup và kế hoạch đã xác nhận.

## 3. Nghỉ/bận sau nâng cấp

- Bác sĩ bấm **Báo nghỉ / bận** → **Chờ duyệt**, giữ nguyên lịch công bố, QR và lease đang hợp lệ.
- Quản lý mở **Lịch trực → Yêu cầu lịch trực → Nghỉ / bận chờ duyệt**. Mỗi ca chưa kết thúc bị ảnh hưởng phải có bác sĩ thay hợp lệ.
- Backend kiểm tra lại chuyên môn, tài khoản hoạt động, nghỉ có hiệu lực, trùng ca, khoảng nghỉ, tải trực và các quy tắc của kỳ. Thiếu/sai/stale một người thay thì toàn bộ giao dịch bị rollback, không để lại ca trống.
- Ca đã chốt hoặc đang diễn ra còn cần quyền xử lý ngoại lệ KHTH. Ca qua đêm tính cả ngày thứ hai; ca đã kết thúc giữ nguyên lịch sử.
- Bác sĩ chỉ rút yêu cầu đang chờ; không tự hủy nghỉ đã duyệt. Dữ liệu nghỉ cũ giữ nguyên như lịch sử có hiệu lực, không tự suy đoán/khôi phục phân công quá khứ. CNTT/quản lý cần rà soát riêng các báo nghỉ cũ từng có hiệu lực ngay.

## 4. VPS3 chưa có HTTPS / certificate mới khác P2

**Có thể dùng cùng phần mềm Kiosk, nhưng không dùng nguyên profile P2 cho máy chủ khác.**

Profile P2 đã chốt gắn với đúng URL HTTPS máy chủ P2, mã phòng `P2` và SHA-256 **file PEM** `server.crt` được CNTT xác nhận. Các giá trị cụ thể nằm trong bộ cài P2 riêng, không tự nhận diện certificate mới rồi tin cậy.

Certificate mới sinh sẽ có hash khác — đó là bình thường. Không sửa cho trùng hash cũ, không tắt kiểm tra SSL, không chấp nhận mọi certificate, không sao chép `server.key` của P2.

Với VPS3 chưa từng có HTTPS, CNTT có thể cấu hình CA/chứng chỉ tin cậy hoặc dùng script hiện có **một lần đầu**:

```bash
sudo bash deploy/bat-https-port-3000.sh
```

Script hỏi IP và **sinh lại certificate**, thay cấu hình HTTPS/port cho máy đó. **Không chạy lại script này trên P2 hay một VPS đã có HTTPS chỉ để nâng phiên bản.** Nếu đang có certificate hợp lệ, giữ nguyên nó.

Sau khi cấu hình VPS3:

```bash
sha256sum data/ssl/server.crt
openssl x509 -in data/ssl/server.crt -noout -dates -ext subjectAltName
```

Gửi **URL HTTPS thực, mã phòng và hash PEM** qua kênh CNTT đã xác thực để tạo profile/bộ cài một-lần riêng. Chỉ cần public certificate nếu cần kiểm tra; **không gửi private key, `.env`, JWT/AI keys hoặc mật khẩu VPS**.

- URL phải khớp SAN của certificate và các URL công khai/QR trên server. Nếu có Nginx HTTPS 3000 → web HTTP 3001 thì origin máy trạm/điện thoại vẫn là **HTTPS 3000**, không phải 3001/4000/8001.
- Profile mới phải kiểm tra hash, tên máy chủ, thời hạn và TLS nghiêm ngặt. Bộ P2 phải từ chối certificate khác chứ không tự tin cậy.
- PC và điện thoại đều phải tin cậy certificate qua CA phù hợp/triển khai của CNTT. Bộ cài PC không tự cài chứng chỉ cho điện thoại. Quét bằng Camera mặc định → Safari/Chrome, không WebView/app quét QR, không webcam PC.
- Tự ký HTTPS không thay thế firewall/VLAN/hạn chế mạng bệnh viện.

## 5. Giới hạn của bằng chứng kiểm thử

Các bài tự động dùng production migrations + Drizzle/PGlite kiểm tra dữ liệu và rollback; kiểm thử updater dùng Docker/Git/curl giả lập để kiểm tra nhánh dừng và giữ cấu hình. Đây **không phải** nâng cấp/restore thật trên VPS3 hay kiểm thử tranh chấp nhiều kết nối PostgreSQL thật. Native self-test/SendInput trên Windows CI cũng không thay thế nghiệm thu tài khoản Administrator/User, UAC, bàn phím vật lý, điện thoại và AI tại viện.
