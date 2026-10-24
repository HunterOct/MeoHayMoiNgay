# Mẹo Hay Mỗi Ngày — nền tảng blog tự động hóa

Blog mẹo vặt đời sống & công nghệ, được nâng cấp từ site tĩnh HTML/CSS/JS thành nền tảng đầy đủ:

- Public site render server-side, giữ nguyên giao diện cũ, tối ưu SEO.
- Admin CMS: đăng nhập, dashboard, soạn/sửa/duyệt/lên lịch/xuất bản, media, chuyên mục, thẻ, người dùng, lịch sử phiên bản, thùng rác, nhật ký.
- Publishing API cho hệ thống AI bên ngoài: key theo scope, hai chế độ auto/review, idempotency, `external_id`, rate limit, upload ảnh.
- Bảo mật: sanitize HTML, CSP, CSRF, RBAC backend, scrypt, chống brute-force, security headers.
- Chống scraping nhiều lớp: robots (chặn AI crawler, ưu tiên search engine), UA blocklist, rate limit, phát hiện duyệt tuần tự, hotlink protection, audit.
- SEO kỹ thuật: URL sạch, canonical/OG/Twitter, JSON-LD, sitemap, RSS, 301 khi đổi slug, 410 khi xóa, noindex admin/draft.
- Vận hành: SQLite WAL, migration, backup, health check, job xuất bản theo lịch, Docker.

## Chạy nhanh

```bash
cp .env.example .env      # đặt SITE_URL + ADMIN_EMAIL + ADMIN_PASSWORD
npm ci
npm run db:migrate
npm run db:seed           # admin + 7 chuyên mục
npm run db:import-legacy  # 70 bài từ bản tĩnh cũ (chạy một lần)
npm start
```

- Website: http://localhost:3000
- Quản trị: http://localhost:3000/admin
- API: http://localhost:3000/api/v1
- OpenAPI: http://localhost:3000/api/v1/openapi.yaml

Admin mặc định lấy từ `ADMIN_EMAIL`. Nếu bỏ trống `ADMIN_PASSWORD`, script seed in mật khẩu tạm một lần — đổi ngay sau khi đăng nhập.

## Cấu trúc

```
.
├── server.js                  # entry point, job, graceful shutdown
├── src/
│   ├── app.js                 # Express app
│   ├── config.js              # env + constants
│   ├── db/                    # schema, migration, repositories
│   ├── lib/                   # sanitize, SEO, auth helpers, uploads, slug...
│   ├── middleware/            # security, session, bot guard, rate limit, API auth
│   ├── routes/                # public, admin, api, feeds, media
│   ├── views/                 # SSR templates (public + admin)
│   └── jobs/scheduler.js      # xuất bản theo lịch, cleanup
├── public/
│   ├── assets/css/style.css   # giao diện gốc (giữ nguyên)
│   ├── assets/css/site.css    # bổ sung cho SSR
│   ├── assets/css/admin.css
│   ├── assets/js/site.js      # slider, ticker, theme, checklist
│   ├── assets/js/admin.js     # editor, media picker, xác nhận
│   └── assets/img/            # 61 ảnh gốc
├── scripts/                   # seed, import, backup, create-admin, retag
├── tests/                     # node:test
├── docs/                      # kiến trúc, API, bảo mật, vận hành
└── openapi.yaml
```

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `npm start` | Chạy production (đọc `.env` nếu có). |
| `npm run dev` | Chạy với watch. |
| `npm run db:migrate` | Áp migration (tự chạy khi start). |
| `npm run db:seed` | Tạo admin + chuyên mục. |
| `npm run db:import-legacy` | Import 70 bài cũ. |
| `npm run db:retag` | Gắn lại thẻ cho bài import (nếu sửa logic tag). |
| `npm run create-admin -- --email ... --password ...` | Tạo/đổi mật khẩu tài khoản. |
| `npm run backup` | Backup DB + uploads. |
| `npm run check` | Kiểm tra cú pháp toàn bộ JS. |
| `npm test` | Chạy test (unit + tích hợp). |

## Tài liệu

- [Kiến trúc & báo cáo kiểm toán](docs/ARCHITECTURE.md)
- [API cho hệ thống AI](docs/API.md) · [OpenAPI](openapi.yaml)
- [Bảo mật & chống scraping](docs/SECURITY.md)
- [Vận hành & triển khai](docs/OPERATIONS.md)

## Thay đổi so với bản tĩnh

- Bỏ hash routing, dùng URL thật; link hash cũ tự chuyển hướng.
- Bỏ mã hoá XOR thân bài (cần HTML server-side cho SEO). Nội dung vẫn được bảo vệ bằng kiểm soát server/CDN, không dựa vào chặn chuột phải.
- Dữ liệu 70 bài được giải mã, sanitize và import vào SQLite; ảnh giữ nguyên trong `public/assets/img`.
- UI, CSS, animation, dark mode, slider, ticker, checklist được giữ lại và render từ dữ liệu thật.

Chi tiết giới hạn và các bước trước production: xem [docs/OPERATIONS.md](docs/OPERATIONS.md).
