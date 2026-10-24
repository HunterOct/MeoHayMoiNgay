# Mẹo Hay Mỗi Ngày — Project web tĩnh

Blog tĩnh, không database, không backend. Chạy bằng HTML + CSS + JavaScript thuần.

## Cấu trúc

```
meo-hay-moi-ngay-project/
  index.html            # Khung trang: header, nav Đời sống / Công nghệ, lưới bài, sidebar, footer
  assets/
    css/style.css       # Toàn bộ CSS của trang
    js/main.js          # Toàn bộ logic + dữ liệu 70 bài viết (tiêu đề, intro, nội dung, ảnh)
    img/                # 61 ảnh thật (JPG/WebP), không nhúng base64 trong code
      img-001.jpg
      ...
      img-061.jpg
```

Trước đây bản export là 1 file HTML 11 MB, nhúng hết 61 ảnh dạng base64.
Bản này tách ra: `index.html` chỉ còn ~8 KB, `main.js` ~250 KB,
tổng project ~7,5 MB, file lớn nhất ~859 KB — đều dưới giới hạn
Cloudflare Pages (20.000 file/site, 25 MB/file).

## Bố cục kiểu tin tức + chống cào thô (2026-10-24)

- Trang chủ: thanh xanh trên cùng có nút toggle sáng/tối dạng công tắc, không dùng icon màu.
  Dưới menu là thanh TIN MỚI chạy tiêu đề 5 bài mới nhất, có nút trước/sau.
  Banner là slider ảnh lớn phủ tiêu đề, bên phải là danh sách số 01-03,
  dưới banner là dải ảnh nhỏ 6 bài, rồi mới tới lưới bài nổi bật 8 thẻ.
- Trang admin đã xoá hẳn theo yêu cầu, không còn file admin.html, không còn link Quản trị.
- Chống cào thô: nội dung bài (trường body của 70 bài) không còn ở dạng text thường
  trong main.js mà đã mã hoá XOR + base64, chỉ giải mã khi mở bài bằng JavaScript.
  Tiêu đề, mô tả ngắn và chuyên mục vẫn để thường để tìm kiếm và Google lập chỉ mục.
  Ảnh: chặn chuột phải và kéo thả trên ảnh. Đây là biện pháp ngăn cào thô,
  không phải bảo mật tuyệt đối: vì trình duyệt phải giải mã để hiển thị bài,
  người biết đọc code vẫn có thể giải mã lại, và ảnh hiển thị vẫn chụp màn hình được.

## Chạy local

Mở `index.html` bằng trình duyệt, hoặc chạy server tĩnh trong thư mục này:

```
python3 -m http.server 8000
```

rồi mở http://localhost:8000

## Deploy lên Cloudflare Pages (khuyên dùng)

Cách 1 — Kéo thả (nhanh nhất):
1. Vào Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets
2. Kéo thả toàn bộ thư mục `meo-hay-moi-ngay-project` (giữ nguyên cấu trúc)
3. Đặt tên project, deploy. Gắn domain riêng trong mục Custom domains.

Cách 2 — Qua Git:
1. Push toàn bộ thư mục này lên một repo GitHub/GitLab
2. Pages → Create → Connect to Git, chọn repo, framework preset: None / Static
3. Build command: để trống, Output directory: `/` (thư mục gốc)

Lưu ý cache: ảnh trong `assets/img/` được Cloudflare cache lâu.
Mỗi lần đổi nội dung bài, deploy lại là Cloudflare tự làm mới.

## Thêm / sửa bài (duy trì lâu dài)

- Sửa giao diện: sửa `assets/css/style.css`
- Sửa hành vi, tìm kiếm, lọc chuyên mục: sửa `assets/js/main.js`
- Thêm bài mới: thêm 1 object bài vào mảng dữ liệu trong `assets/js/main.js`,
  copy ảnh mới vào `assets/img/` (đặt tên tiếp theo, ví dụ `img-062.jpg`)
  và trỏ trường ảnh của bài đó tới `assets/img/img-062.jpg`
- Đừng quay lại cách nhúng base64 vào code: vừa nặng, vừa không cache được.

## Quy tắc nội dung

Blog chỉ đăng nội dung cho người đọc: vấn đề + cách giải quyết.
Không đăng kế hoạch nội bộ, kỳ vọng doanh thu, chiến lược affiliate
hay lịch đăng bài lên trang công khai.
