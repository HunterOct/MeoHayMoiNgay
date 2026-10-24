# Vận hành & triển khai

## 1. Yêu cầu

- Node.js ≥ 22.13 (khuyến nghị 24 LTS).
- Không cần build frontend.
- Dung lượng: mã nguồn + ảnh ~8 MB; DB tăng theo số bài (vài MB cho hàng nghìn bài).
- RAM tối thiểu 256 MB; 512 MB thoải mái.

## 2. Cài đặt lần đầu (local)

```bash
cp .env.example .env
# sửa SITE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (mật khẩu mạnh)
npm ci
npm run db:migrate
npm run db:seed              # tạo admin + 7 chuyên mục
npm run db:import-legacy     # import 70 bài từ bản tĩnh cũ (chạy 1 lần)
npm start
```

Mở http://localhost:3000 và http://localhost:3000/admin.

Nếu không đặt `ADMIN_PASSWORD`, script seed in ra mật khẩu tạm một lần. Đổi ngay sau khi đăng nhập hoặc chạy:

```bash
npm run create-admin -- --email admin@meohay.local --password 'MatKhauMoi123'
```

`db:seed` và `db:import-legacy` idempotent: bài đã có slug sẽ bị bỏ qua. `--force` trên import sẽ tạo bản ghi mới (slug tự thêm hậu tố — thường không cần).

## 3. Biến môi trường

Xem [.env.example](../.env.example). Các biến quan trọng:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | development | `production` bật HSTS (khi HTTPS) và giảm chi tiết lỗi. |
| `SITE_URL` | http://localhost:3000 | Canonical, sitemap, RSS, OG. Không có `/` cuối. |
| `DB_PATH` | data/blog.db | File SQLite. |
| `UPLOAD_DIR` | data/uploads | Ảnh upload. |
| `TRUST_PROXY` | 0 | Đặt `1` khi sau nginx/Cloudflare. |
| `SESSION_TTL_HOURS` | 168 | Hạn tuyệt đối của session admin. |
| `SESSION_IDLE_HOURS` | 8 | Hết hạn nếu không hoạt động. |
| `MAX_UPLOAD_MB` | 8 | Giới hạn ảnh. |
| `RATE_LIMIT_HTML_PER_MIN` | 120 | Rate limit IP cho trang HTML. |
| `BLOCK_AI_CRAWLERS` | 1 | Chặn AI crawler (robots + server). |
| `BLOCK_SCRAPER_UAS` | 1 | Chặn UA scraping phổ biến. |
| `BACKUP_RETENTION_DAYS` | 14 | Số ngày giữ backup. |
| `SITE_TIMEZONE` | Asia/Ho_Chi_Minh | Hiển thị ngày giờ, lên lịch. |

Không commit `.env`. Không đặt mật khẩu/API key trong mã.

## 4. Chạy production

Không cần build. Chạy trực tiếp:

```bash
NODE_ENV=production npm start
```

Hoặc dùng PM2/systemd. Ví dụ systemd `/etc/systemd/system/meohay.service`:

```ini
[Unit]
Description=Meo Hay Moi Ngay
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/meohay
EnvironmentFile=/var/www/meohay/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Docker

```bash
cp .env.example .env
docker compose up -d --build
```

`docker-compose.yml` mount `./data` để DB/ảnh/backup tồn tại ngoài container. Container chạy user `node`, health check gọi `/healthz`.

### Reverse proxy (nginx)

```nginx
limit_req_zone $binary_remote_addr zone=mh:10m rate=5r/s;

server {
    listen 443 ssl http2;
    server_name meohay.example.com;

    client_max_body_size 10m;

    location / {
        limit_req zone=mh burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
```

Đặt `TRUST_PROXY=1` để app lấy đúng IP client.

### Cloudflare (khuyến nghị)

- SSL/TLS: Full (strict).
- Cache Rules: cache `/assets/*` và `/media/*` (Edge TTL 1 tháng), bỏ qua `/admin/*`, `/api/*`.
- WAF rate limit cho `/api/v1/*` và `/admin/login` (ví dụ 60 req/phút/IP).
- Bật Bot Fight Mode/Turnstile cho login nếu bị spam.
- `SITE_URL` là domain HTTPS; app tự đặt cookie `Secure` + HSTS.
- Giữ `robots.txt` của app (đừng chặn nhầm Googlebot).

## 5. Backup & restore

Tạo backup (DB + uploads + manifest), tự xóa bản cũ hơn `BACKUP_RETENTION_DAYS`:

```bash
npm run backup
```

Cron gợi ý (2h sáng):

```cron
0 2 * * * cd /var/www/meohay && /usr/bin/npm run backup >> /var/log/meohay-backup.log 2>&1
```

Restore:

```bash
# dừng service trước
cp data/backups/<timestamp>/blog.db data/blog.db
cp -r data/backups/<timestamp>/uploads/. data/uploads/
# kiểm tra
node -e "const D=require('better-sqlite3');const db=new D('data/blog.db');console.log(db.pragma('integrity_check'))"
```

Với Docker, backup thư mục `./data` ra ngoài ổ khác/object storage (R2/S3) định kỳ.

## 6. Job & lịch xuất bản

- Khi chạy, job kiểm tra mỗi **20 giây** các bài `status='scheduled'` có `scheduled_at <= now` và chuyển sang `published`.
- Ghi audit `post.published_scheduled`.
- Không cần cron riêng khi chạy một instance. Nếu chạy nhiều instance, chỉ nên để một instance bật job hoặc chuyển sang queue.

## 7. Log & giám sát

- Log JSON ra stdout (`LOG_LEVEL=debug|info|warn|error`).
- Mỗi request có `X-Request-Id`; lỗi 4xx/5xx được log kèm path, code, request id.
- Không log mật khẩu/token/key (redaction).
- `GET /healthz`: kiểm tra DB + uptime (dùng cho load balancer).
- `GET /api/v1/health`: health cho API.
- `GET /admin/audit?scope=security`: sự kiện bot/rate limit/hotlink.
- Có thể forward log sang Loki/Datadog/CloudWatch.

## 8. Migration

- Schema tự chạy khi khởi động (`PRAGMA user_version`).
- Trước khi nâng cấp production: `npm run backup`, sau đó khởi động bản mới.
- Migration hiện tại: v1 schema gốc, v2 `content_source`, v3 `external_id`.
- Không sửa tay file DB khi service đang chạy.

## 9. Quản trị thường ngày

- Tạo/sửa bài: `/admin/posts`, trình soạn thảo Markdown/HTML, xem trước, lịch sử phiên bản.
- Duyệt bài AI: lọc trạng thái **Chờ duyệt**.
- Media: `/admin/media`; không xóa được ảnh đang dùng.
- API client: xoay vòng key 90 ngày/lần; thu hồi ngay khi lộ.
- Người dùng: tác giả chỉ sửa bài của mình; editor duyệt/xuất bản; admin toàn quyền.
- Cài đặt: tên site, mô tả, tác giả mặc định cho API, chính sách AI crawler.

## 10. Sự cố thường gặp

| Hiện tượng | Nguyên nhân / xử lý |
|---|---|
| 403 khi dùng curl/Postman vào trang | Bot guard chặn UA scraper. Dùng UA trình duyệt hoặc gọi API đúng key. |
| 429 khi test | Rate limit; xem `RATE_LIMIT_*`, `Retry-After`. |
| Upload 413 | Ảnh > `MAX_UPLOAD_MB` hoặc giới hạn proxy (`client_max_body_size`). |
| Đăng nhập báo khóa | Sai 8 lần → khóa 15 phút; chờ hoặc admin mở DB/reset? (không khuyến nghị) — chờ hết hạn. |
| `SQLITE_BUSY` | Hiếm do WAL + busy timeout 5s; kiểm tra process khác đang mở DB/backup. Không chạy nhiều writer. |
| Bài lên lịch không đăng | Service không chạy job (đã tắt?), `scheduled_at` timezone sai, hoặc đang ở chế độ review. |
| Googlebot bị chặn | Kiểm tra `robots.txt`, UA blocklist, WAF; reverse DNS verification cần DNS hoạt động. |
| Ảnh không hiển thị | `UPLOAD_DIR` sai quyền, file bị xóa, hoặc hotlink protection (referer lạ). |

## 11. Checklist trước production

- [ ] `NODE_ENV=production`, `SITE_URL` HTTPS đúng domain.
- [ ] HTTPS + HSTS hoạt động; `TRUST_PROXY=1` nếu sau proxy.
- [ ] Mật khẩu admin mạnh, không dùng mật khẩu seed mặc định.
- [ ] Backup tự động + đã thử restore.
- [ ] `robots.txt`/`sitemap.xml` truy cập được; kiểm tra Google Search Console.
- [ ] `/admin` không bị index (`X-Robots-Tag`), tốt nhất giới hạn IP/VPN.
- [ ] API key production tạo mới, scope tối thiểu, chế độ review.
- [ ] WAF rate limit cho `/api/v1` và `/admin/login`.
- [ ] Log được thu thập; health check được giám sát.
- [ ] Kiểm tra email liên hệ trong Cài đặt.
- [ ] Chạy `npm test` và `npm run check` trước khi deploy.
