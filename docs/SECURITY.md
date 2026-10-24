# Bảo mật

## 1. Mô hình mối đe dọa

| Tài sản | Mối đe dọa chính |
|---|---|
| Nội dung/bài viết | XSS từ nội dung AI, sửa/xóa trái phép |
| Tài khoản admin | Brute-force, credential stuffing, session hijack |
| API key | Lộ key, lạm dụng xuất bản, spam |
| Ảnh upload | Malware, polyglot file, path traversal, hotlink |
| Dữ liệu | Mất do xóa nhầm, backup hỏng |
| Nội dung công khai | Scraping, sao chép, dùng để huấn luyện AI |

## 2. Kiểm soát đã triển khai

### Nội dung & XSS
- Mọi nội dung (admin + API) đi qua `sanitize-html` với allow-list thẻ/thuộc tính.
- Markdown render bằng `marked` rồi sanitize; `<script>`, event handler, `javascript:`, iframe bị loại.
- Link ngoài tự thêm `rel="noopener noreferrer nofollow"`, `target="_blank"`.
- Ảnh chỉ nhận http(s) hoặc đường dẫn nội bộ; thêm `loading=lazy`, `referrerpolicy`.
- CSP với nonce cho mọi script; `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.
- Toàn bộ output text escape (`esc`) ở template.

### SQL Injection
- 100% truy vấn dùng prepared statements (`better-sqlite3`).
- Không nối chuỗi từ input vào SQL. Các mệnh đề `ORDER BY` là hằng số nội bộ.

### CSRF
- Form admin có token CSRF gắn với session (so sánh timing-safe).
- Cookie session `HttpOnly`, `SameSite=Lax`, `Secure` khi HTTPS.
- Kiểm tra `Origin` với mọi POST/PUT/PATCH/DELETE.
- Login form có CSRF cookie riêng (`HttpOnly`, path `/admin`) + hidden token.
- API dùng bearer key, không dùng cookie → không bị CSRF.

### Xác thực & phân quyền
- Mật khẩu hash `scrypt` (N=16384, r=8, p=1), salt ngẫu nhiên; so sánh timing-safe.
- Session lưu DB dạng hash SHA-256; hết hạn tuyệt đối 7 ngày, idle 8 giờ; rotate session khi đăng nhập.
- Khóa tài khoản 15 phút sau 8 lần sai; rate limit 15 lần/15 phút/IP cho login.
- RBAC kiểm tra ở backend: `admin`, `editor`, `author`. Tác giả chỉ sửa bài của mình ở trạng thái nháp/chờ duyệt; không xuất bản.
- Không thể tự khóa/hạ quyền mình; luôn cần ít nhất một admin hoạt động.
- IDOR: mọi thao tác bài/ảnh đều kiểm tra quyền trên đối tượng cụ thể.

### API
- Key dạng `mh_<id>_<secret>`; server lưu `sha256(secret)`.
- Scope chi tiết (`posts:read/write/publish`, `media:write`, `taxonomy:read`).
- Hai chế độ `auto`/`review`; review mode tự hạ yêu cầu publish về duyệt.
- Rate limit theo client + IP; header `Retry-After`.
- Idempotency-Key + `external_id` chống tạo trùng khi retry.
- Validation zod strict (từ chối field lạ), giới hạn kích thước request.
- Key không bao giờ trả lại sau lần tạo/xoay vòng; không log key.

### Upload
- Chỉ JPG/PNG/WebP/GIF; kiểm tra magic bytes, không tin `Content-Type`.
- Giới hạn dung lượng (`MAX_UPLOAD_MB`, mặc định 8 MB), một file/request.
- Tên file ngẫu nhiên; không giữ đường dẫn gốc; chặn path traversal.
- Không cho SVG (nguy cơ XSS).
- Phục vụ với `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, CSP `sandbox`.
- Không có fetch URL từ xa phía server → không có SSRF.

### Headers & hạ tầng
- Helmet + CSP, `Referrer-Policy`, `X-Frame-Options`, `X-Content-Type-Options`.
- HSTS khi `SITE_URL` là HTTPS.
- Không bật CORS cho API (server-to-server).
- Secrets qua biến môi trường; `.env` bị gitignore.
- Log JSON có redaction cho password/token/key.

### Audit
- Ghi log: đăng nhập (thành công/thất bại/khóa), CRUD bài, media, taxonomy, user, API key, settings, job.
- Ghi sự kiện bảo mật: rate limit, bot giả, AI crawler, scraper UA, hotlink, API auth fail.
- Sự kiện bảo mật lặp lại được throttle (10 phút/action/IP) để tránh kẻ tấn công làm đầy DB log.
- Nhật ký xem tại `/admin/audit` (chỉ admin), giữ 180 ngày.

## 3. Chống scraping / sao chép

### Đã bật
- `robots.txt`: cho Googlebot/Bingbot/DuckDuckBot/Applebot; chặn GPTBot, CCBot, ClaudeBot, Bytespider, PerplexityBot, Meta-ExternalAgent, Amazonbot, Applebot-Extended… (có thể bật lại trong Cài đặt).
- Chặn UA AI crawler ở server (403) và ghi audit.
- Chặn UA công cụ scraping phổ biến (curl, python-requests, scrapy, aiohttp, scraping API…) trên trang công khai. Không chặn headless browser/Playwright/Puppeteer để tránh làm hỏng công cụ kiểm thử, accessibility và Lighthouse; các bot tinh vi này được xử lý bằng rate limit/WAF.
- Rate limit IP cho HTML; phát hiện duyệt bài tuần tự (>40 bài/5 phút → khóa 10 phút).
- Hotlink protection cho `/media` (cho phép Google/Bing/social).
- Xác thực Googlebot/Bingbot bằng reverse DNS + forward DNS trước khi miễn rate limit; UA giả bị ghi audit và không được miễn.
- RSS chỉ chứa mô tả ngắn, không full content.
- Audit log để điều chỉnh ngưỡng và phát hiện đợt cào.

### Giới hạn (quan trọng)
- Nội dung công khai cho trình duyệt thì **không thể chống sao chép tuyệt đối**. Người biết kỹ thuật vẫn đọc được HTML/ảnh.
- Chặn chuột phải/DevTools là hình thức, gây khó chịu; dự án không dựa vào đó.
- UA blocklist chỉ chặn bot "dễ tính"; bot tinh vi giả UA trình duyệt cần WAF/CDN (Cloudflare Bot Management, Turnstile).
- Rate limit trong RAM chỉ hiệu lực một instance. Production nên đặt Cloudflare/nginx rate limit phía trước.
- Muốn chặn mạnh hơn có thể bật Cloudflare "Bot Fight Mode", WAF rules, hoặc yêu cầu đăng nhập cho nội dung (không khuyến nghị vì hại SEO).

## 4. Khuyến nghị trước production

1. Chạy sau HTTPS (Caddy/nginx/Cloudflare) và đặt `SITE_URL=https://...`.
2. Đặt `TRUST_PROXY=1` khi sau proxy để rate limit theo IP thật.
3. Đổi mật khẩu admin mạnh; không dùng `ADMIN_PASSWORD` trong `.env` production.
4. Bật MFA ở lớp hạ tầng (Cloudflare Access) hoặc bổ sung TOTP nếu cần.
5. Bật backup định kỳ (`npm run backup` + cron) và thử restore.
6. Giới hạn truy cập `/admin` theo IP/VPN nếu có thể.
7. Rotate API key định kỳ 90 ngày; thu hồi key không dùng.
8. Theo dõi `/admin/audit?scope=security` và log 401/403/429.
9. Dùng CDN/WAF cho rate limit toàn cụm.
10. Review nội dung AI trước khi publish (chế độ `review`) ít nhất giai đoạn đầu.

## 5. Xử lý sự cố

- **Lộ API key:** Thu hồi ngay trong `/admin/api-clients`; tạo key mới; kiểm tra audit các bài tạo gần đây.
- **Lộ mật khẩu admin:** Đổi mật khẩu, xóa session (đăng nhập lại sẽ tạo session mới; có thể vô hiệu hóa/xóa session trong DB), kiểm tra audit `auth.*`.
- **Bị scrape:** Xem `/admin/audit?scope=security`, chặn IP/ASN ở proxy, giảm ngưỡng rate limit, bật WAF.
- **Bài bị chèn mã:** Kiểm tra revision, khôi phục bản trước; chạy sanitize lại toàn bộ (`syncAllFts` không đủ, cần script riêng) — báo kỹ thuật.
- **Mất dữ liệu:** Dừng service, khôi phục file backup mới nhất (`data/backups/<timestamp>/blog.db` + `uploads/`), kiểm tra `PRAGMA integrity_check`.

## 6. Báo cáo lỗ hổng

Gửi email trong Cài đặt (`contact_email`) kèm mô tả, bước tái hiện, mức ảnh hưởng. Không đăng công khai trước khi có bản vá.
