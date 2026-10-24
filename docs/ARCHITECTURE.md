# Kiến trúc & báo cáo kiểm toán

## 1. Hiện trạng ban đầu (audit)

| Hạng mục | Hiện trạng |
|---|---|
| Frontend | `index.html` + `assets/css/style.css` + `assets/js/main.js`; UI hoàn chỉnh, responsive, dark mode, slider, ticker, checklist. |
| Nội dung | 70 bài viết hard-code trong `main.js` (mảng `ARTICLES` + 7 mảng `MORE_*`), thân bài XOR+base64. |
| Routing | Hash SPA (`#bai-viet/<slug>`), toàn bộ render phía client. |
| Backend | Không có. |
| Database | Không có. |
| Admin CMS | Đã bị xóa; muốn sửa bài phải sửa code và deploy. |
| API | Không có. |
| SEO | Chỉ title/description trang chủ tĩnh; bài viết không có HTML server-side, không canonical/OG/JSON-LD, không sitemap/robots/RSS, URL hash. |
| Bảo mật | Không security headers, không auth, không rate limit; XOR key nằm trong client; chặn chuột phải chỉ là hình thức. |
| Hiệu năng | `main.js` ~397 KB tải mọi bài mỗi lần vào trang; 61 ảnh ~7,5 MB; không có width/height (CLS); font Google. |
| Vận hành | Không log, không health check, không backup, không test. |

### Gap analysis

| Hạng mục | Hiện trạng ban đầu | Vấn đề | Giải pháp đã triển khai | Mức |
|---|---|---|---|---|
| Frontend | HTML/CSS/JS tĩnh, UI 80% | Nội dung hard-code, URL hash, render client | Giữ nguyên CSS/UI; SSR template + `site.js` tương tác; URL thật, redirect hash cũ | P0 |
| Backend | Không có | Không thể quản trị/xuất bản | Express 5 + service/repository layer, xử lý lỗi tập trung | P0 |
| Database | Không có | Không có nguồn dữ liệu, versioning | SQLite WAL + migration + FTS5; 14 bảng; import 70 bài | P0 |
| Admin CMS | Đã xóa | Không vận hành được | Login, dashboard, editor, media, taxonomy, users, API clients, audit, trash, revisions | P0 |
| Publishing API | Không có | AI không thể gửi bài an toàn | REST v1 + bearer key/scope/mode + idempotency + external_id + OpenAPI | P0 |
| Security | Không có lớp bảo vệ | XSS/CSRF/brute-force/lộ secret | Sanitize, CSP nonce, CSRF, RBAC, scrypt, lockout, headers, audit | P0 |
| Anti-Scraping | Chặn chuột phải, XOR | Không hiệu quả, hại SEO | robots AI, UA block, rate limit, enumeration guard, reverse-DNS bot verify, hotlink, audit | P1 |
| SEO | Title tĩnh, hash URL | Google khó index bài | SSR, canonical, OG, JSON-LD, sitemap, RSS, 301/410, noindex | P0 |
| Performance | 397 KB JS, ảnh không kích thước | Tải nặng, CLS | HTML nhẹ, lazy load, width/height, cache, preload, asset version | P1 |
| Deployment | Kéo thả Pages | Không chạy được backend | Node/Docker, backup, health check, systemd/nginx/Cloudflare docs | P1 |

### Các vấn đề ưu tiên (tóm tắt)

| # | Vấn đề | Mức |
|---|---|---|
| 1 | Không có nguồn dữ liệu thật; xuất bản = sửa code | P0 |
| 2 | Không có admin/API; không thể vận hành | P0 |
| 3 | Nội dung không render server-side → SEO gần như bằng 0 | P0 |
| 4 | Không có auth/phân quyền/CSRF/security headers | P0 |
| 5 | Không có sitemap/robots/canonical/OG/structured data | P1 |
| 6 | URL hash, không có 404/410/301 | P1 |
| 7 | Payload JS lớn, lặp dữ liệu, không cache theo bài | P1 |
| 8 | Không có rate limit/chống scraping thực chất | P1 |
| 9 | Không có test, backup, logging, health check | P1 |
| 10 | Ảnh không có kích thước, không tối ưu | P2 |

## 2. Quyết định kiến trúc

**Refactor từng phần + bổ sung backend, giữ nguyên UI.** Không viết lại giao diện.

- HTML/CSS hiện có được tái sử dụng 1:1 (giữ `style.css`, bổ sung `site.css`).
- `main.js` được thay bằng template server-side + `site.js` chỉ xử lý tương tác (slider, ticker, theme, checklist).
- Dữ liệu chuyển vào SQLite, import một lần từ dữ liệu cũ (đã giải mã XOR, sanitize).
- URL chuyển từ hash sang đường dẫn thật; thêm redirect phía client cho link hash cũ.

### Tech stack

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Runtime | Node.js ≥ 22 (đang dùng 24) | Có sẵn, không cần build, hệ sinh thái ổn. |
| HTTP | Express 5 | Ổn định, middleware rõ ràng, dễ bảo trì. |
| DB | SQLite (better-sqlite3, WAL) | Quy mô blog cá nhân/nhỏ, một file, backup đơn giản, FTS5 cho tìm kiếm. |
| Render | Template JS thuần (server-side) | Giữ CSS/HTML hiện có, không thêm build step; kiểm soát HTML/SEO tuyệt đối. |
| Nội dung | Markdown (marked) hoặc HTML, sanitize-html | An toàn với nội dung AI; editor vẫn sửa được nguồn. |
| Auth | Session DB + scrypt; API key hash SHA-256 | Không phụ thuộc dịch vụ ngoài; key thu hồi/xoay vòng được. |
| Jobs | `setInterval` trong process | Xuất bản theo lịch mỗi 20 giây; đủ cho single-instance, không cần Redis. |
| Test | `node:test` + fetch | Không dependency test nặng. |

**Không chọn** Next.js/Astro/headless CMS vì: UI đã là HTML/CSS thuần, số bài nhỏ, cần ít phụ thuộc và build step; thêm framework sẽ tăng chi phí bảo trì mà không giải quyết vấn đề cốt lõi. Khi lên multi-instance/lưu lượng lớn, có thể thay SQLite bằng Postgres và tách job queue.

## 3. Kiến trúc cuối

```
Browser / Googlebot ──► Reverse proxy / CDN ──► Node (Express)
                                                 │
        ┌────────────────────────────────────────┼───────────────────────────┐
        │                                        │                           │
   Public SSR                              Admin CMS                    Publishing API
   / /bai-viet/:slug                       /admin/*                     /api/v1/*
   /chuyen-muc /the /nhom                  session + CSRF + RBAC        bearer key + scopes
        │                                        │                           │
        └───────────────┬────────────────────────┴───────────────┬───────────┘
                        │                                        │
                  SQLite (WAL)  ── posts, revisions, tags, media, users, keys, audit
                        │
                data/uploads/  ── ảnh upload (phục vụ qua /media/:file)
```

Luồng chính:

1. Request → security headers/CSP → session (chỉ admin) → router.
2. Public: bot guard → rate limit → truy vấn SQLite → render HTML đầy đủ → cache header.
3. Admin: session + CSRF → RBAC → thao tác → audit log → redirect + flash.
4. API: bearer key → scope + rate limit → validate (zod) → sanitize → ghi DB → audit → JSON.
5. Job 20s: chuyển bài `scheduled` đến giờ thành `published` + audit.

## 4. Mô hình dữ liệu

- `posts`: nội dung gốc (`content_source`), HTML đã render (`content_html`), trạng thái, SEO, cover, lịch, xóa mềm, `external_id` theo client.
- `revisions`: snapshot mỗi lần lưu, khôi phục được.
- `slug_history`: slug cũ → 301 khi đổi slug.
- `categories`, `tags`, `post_tags`.
- `users`, `sessions`, `login_attempts`: RBAC + chống brute-force.
- `api_clients`, `idempotency_keys`: key hash/scopes/mode + chống trùng.
- `media`, `media_usages`: ảnh + chặn xóa ảnh đang dùng.
- `audit_log`: thao tác người dùng/API/hệ thống + sự kiện bảo mật.
- `settings`: cấu hình site, tác giả mặc định, chính sách AI crawler.
- `posts_fts` (FTS5): tìm kiếm tiếng Việt không dấu.

Xem [schema.js](../src/db/schema.js) để biết migration đầy đủ.

## 5. SEO

- URL sạch: `/bai-viet/:slug`, `/chuyen-muc/:slug`, `/the/:slug`, `/nhom/:group`, phân trang `/trang/:n`.
- SSR toàn bộ nội dung; canonical, OG, Twitter Cards, Article timestamps.
- JSON-LD: `WebSite` + `SearchAction`, `Organization`, `BlogPosting`, `BreadcrumbList`, `CollectionPage`.
- `sitemap.xml` động (bài/chuyên mục/thẻ + image sitemap), `robots.txt`, RSS 2.0.
- 301 khi đổi slug; 410 cho bài đã xóa; 404 noindex; admin/search noindex.
- Ảnh có `width/height` (đọc từ file) + lazy loading; hero preload.
- Cache: HTML `s-maxage` 60–120s; asset versioned; media 30 ngày.

## 6. Bảo mật & chống scraping

Chi tiết trong [SECURITY.md](SECURITY.md). Tóm tắt:

- Sanitize HTML allow-list, CSP nonce, security headers, output escaping.
- Prepared statements, RBAC backend, CSRF per-session, login rate limit + lockout.
- API key hash + scopes + mode + rate limit + idempotency/external_id.
- Upload kiểm tra magic bytes, đổi tên, không SVG.
- Chống scraping: robots (chặn AI crawler, cho search engine), UA scraper blocklist, rate limit IP, phát hiện duyệt bài tuần tự, hotlink protection, audit log; Googlebot/Bingbot được xác thực reverse DNS và miễn rate limit.
- Thừa nhận: nội dung công khai cho trình duyệt không thể chống sao chép tuyệt đối; ưu tiên kiểm soát server/CDN + giám sát thay vì chặn chuột phải.

## 7. Giới hạn đã biết

- Rate limit trong bộ nhớ: hiệu lực trên một instance. Nhiều instance cần Redis/WAF.
- SQLite: một writer; phù hợp blog tới hàng chục nghìn bài/chục nghìn request/ngày. Cần Postgres khi mở rộng ngang.
- Chưa có MFA (khuyến nghị bật ở reverse proxy/Cloudflare Access nếu cần).
- Chưa gửi email (quên mật khẩu do admin đặt lại; có thể tích hợp SMTP sau).
- Tag tiếng Việt không stemming; FTS5 `remove_diacritics` hỗ trợ tìm không dấu.
- Ảnh không tự resize/WebP; nên tối ưu trước khi upload hoặc thêm pipeline `sharp` khi cần.
- Nội dung AI vẫn cần người duyệt nếu dùng chế độ `review` (khuyến nghị cho giai đoạn đầu).

## 8. Kết quả kiểm chứng (2026-10-24)

| Hạng mục | Kết quả |
|---|---|
| Cú pháp | `npm run check` — 84 file, 0 lỗi |
| Test tự động | `npm test` — 47/47 pass (unit, public SSR/SEO, admin/RBAC/CSRF/media, API, security/anti-scraping, rate limit, scheduled job) |
| Giao diện thật | Headless Chrome 141: desktop 1440×1000 và mobile 390×844; 21 kiểm tra pass; 0 lỗi console/CSP/network; 0 tràn ngang |
| Luồng thủ công | Tạo → sửa → xuất bản → xem public → lên lịch → bỏ xuất bản → xóa → 410 → khôi phục; upload/xóa ảnh; trình soạn thảo, slug tự động, toolbar Markdown, preview |
| API | 21 kịch bản: auth, scope, review/auto, idempotency, external_id, sanitize, schedule, rate limit, media, OpenAPI |
| SEO | HTML chứa canonical/OG/JSON-LD; sitemap/RSS/robots trả 200; draft 404, bài xóa 410, đổi slug 301 |
| Backup | Script chạy thành công; `PRAGMA integrity_check = ok`, 70 bài trong file backup |
| Docker | **Chưa chạy** — máy kiểm thử không có Docker CLI |
| Googlebot thật | Chưa kiểm chứng qua DNS công khai (chỉ test nhánh IP private/verify); cần theo dõi Search Console sau deploy |
| HTTPS/CDN/WAF | Chưa kiểm chứng — mới ở mức cấu hình tài liệu |
| Tải cao | Chưa benchmark; giới hạn single-instance SQLite/RAM rate limit đã ghi nhận |
| UI screenshot | Đã kiểm tra thủ công home, article, admin dashboard/posts/editor/preview/mobile |

Các điểm **chưa** đạt mức production đầy đủ: MFA, email giao dịch, pipeline resize ảnh, WAF/CDN thực tế, benchmark tải, và xác thực Googlebot trên môi trường public.
