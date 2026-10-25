# M2 — AUTHENTICATION & ADMIN CMS MIGRATION (CLOUDFLARE FREE STAGING)

**Ngày:** 2026-10-25  
**Ứng dụng chính:** `D:\Github\MeoHayMoiNgay`, commit `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — **không thay đổi**.  
**Workspace migration:** `D:\Github\MeoHayMoiNgay-m0`  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — Worker version `66ba4f28-0b93-4a61-84ec-400a60b2c63f`  
**Phạm vi:** Authentication, Admin CMS, RBAC, CRUD, revisions, taxonomy, users, API client management, settings, audit, media library (upload vẫn BLOCKED vì R2).

> Kết luận ngắn: Admin CMS đã chạy được trên staging, bảo mật và nghiệp vụ chính PASS. **M2 chưa đạt đầy đủ media parity** vì upload/R2 bị khóa theo đúng phạm vi. **CPU admin chưa đạt mục tiêu P95 ≤ 7 ms** ở dashboard/editor (P95 ~10 ms, không có `exceededCpu`); cần tối ưu trước M3/production. Không bắt đầu M3.

---

## A. Implementation Summary

### Authentication & session

- Login `/admin/login` dùng email + mật khẩu; xác minh scrypt trong `SecureOps` Durable Object, giữ nguyên `N=16384,r=8,p=1`.
- Session D1: token ngẫu nhiên 32 byte, chỉ lưu SHA-256 trong DB; CSRF token riêng trong session.
- Cookie `mh_session`: `HttpOnly`, `Secure` (staging HTTPS), `SameSite=Lax`, `Path=/`, max-age 7 ngày; idle timeout 8 giờ; touch tối đa mỗi 5 phút.
- Login CSRF cookie riêng `mh_login_csrf` (HttpOnly, path `/admin`).
- Login mới hủy token cũ gửi kèm → chống session fixation; logout xóa session; khóa tài khoản/đổi mật khẩu thu hồi toàn bộ session của user.
- Rate limit login 15 lần/15 phút/IP bằng DO; sai liên tiếp 8 lần khóa tài khoản 15 phút; ghi audit.
- CSRF bắt buộc cho mọi POST/PUT/PATCH/DELETE; kiểm tra `Origin` nếu có.
- RBAC backend cho admin/editor/author; không chỉ ẩn nút UI.
- Tài khoản staging đã đổi sang mật khẩu ngẫu nhiên mạnh; credential test nằm trong `fixtures/.m2-passwords.json` (local, gitignored), không đưa lên chat/repo.

### Admin CMS đã port

- Dashboard: counts, recent posts, upcoming, media/users/API clients, audit/security (admin).
- Posts: list/filter/pagination, create, edit, save draft, submit review, publish, schedule, archive, unpublish, preview, soft delete, trash, restore, permanent purge (admin).
- Editor: title/slug/excerpt/lede, Markdown/HTML, toolbar (admin.js), category/tags, author, cover/OG image, SEO fields, featured, read time, validation.
- Revisions: tạo revision mỗi lần create/update, xem 30 bản gần nhất, khôi phục.
- Taxonomy: category/tag list, create, update, delete; category reassign khi còn bài; counts dùng cached counters/triggers.
- Users: list, create, update name/email/role, disable, password reset, revoke sessions, self/last-admin protection.
- API clients: list/create/update scopes/mode/rate; rotate/revoke; key chỉ hiển thị một lần, DB lưu hash.
- Settings: site name/tagline/description, contact/social, default author, copyright, allow AI crawler; có hiệu lực public sau cache 5 giây.
- Audit: login/logout, failed/locked, post create/update/publish/delete/restore/purge, taxonomy, users, API clients, settings; filter + security scope.
- Media: hiển thị 61 ảnh legacy từ Static Assets; upload bị khóa và thông báo rõ vì R2 chưa được phép; không giả lập upload thành công.

### Schema / D1

Migrations mới:
- `0008_admin.sql`: users bio/failed/locked/last_login/updated_at; sessions ip/ua/last_seen; posts origin; media uploaded_by; api_clients revoked/last_used; audit user_agent; bảng `revisions`, `media_usages`, `settings`, `login_attempts`; seed settings.
- `0009_taxonomy_timestamps.sql`: categories created_at/updated_at.
- Counter/cached-count triggers từ M1 được giữ; admin mutations cập nhật counts/tag counts/public ngay.

---

## B. Functional Parity

| Chức năng | Node gốc | Cloudflare staging | Trạng thái |
|---|---|---|---|
| Authentication | Login/session/CSRF/scrypt, khóa sai nhiều lần | Port đầy đủ; scrypt trong DO; cookie secure | **PASS** |
| Dashboard | Counts, recent, upcoming, media/users/clients, audit, security | Cùng markup; dữ liệu D1; media legacy count khác Node | **PASS** (media count data difference) |
| Posts CRUD | Create/edit/status/schedule/unpublish/delete/restore/purge | Port đầy đủ, public cập nhật ngay | **PASS** |
| Editor | Markdown/HTML, sanitize, SEO, slug, tags, cover | Port đầy đủ; sanitize qua DO; UI giống Node | **PASS** |
| Preview | Draft/scheduled/published, noindex | Port; preview bar; noindex; script bị lọc | **PASS** |
| Revisions | Tạo/xem/khôi phục | Port; lưu mỗi lần save | **PASS** |
| Taxonomy | Category/tag CRUD, counts, reassign | Port; cached counts, public pages | **PASS** |
| Trash/Restore | Soft delete/restore/purge | Port; 410 public, purge admin-only | **PASS** |
| User Management | Create/update/role/disable/password/session revoke | Port; self/last-admin guard | **PASS** (một số UI edge chưa test sâu) |
| API Client Management | List/create/update/rotate/revoke, scopes, audit | Port; hash-only storage | **PARTIAL** — create/verify hash đã test; rotate/revoke UI có nhưng chưa test end-to-end |
| Media | Upload/list/alt/delete | Legacy library + upload blocked | **BLOCKED / PARTIAL** — R2 chưa duyệt |
| Audit | Login/security/content/admin events | Port; filter/security scope; UI/log | **PASS** |
| Settings | Site identity/social/default author/AI crawler | Port; public cập nhật sau 5s; UA block vẫn theo config | **PARTIAL** (robots theo setting; UA block chưa nối setting) |

### Public regression

- M1 consistency suite: **42/42 PASS** sau M2 (create/update/slug/unpublish/delete/schedule/sitemap/RSS/counts).
- Public smoke: `/`, article, category, tag, search, sitemap, RSS, robots đều 200; `/admin/login` 200.
- Settings test đổi site name → public title đổi → đã khôi phục `Mẹo Hay Mỗi Ngày`.
- Không có thay đổi public UI/CSS/JS.

---

## C. Security Test Results

Bộ `scripts/m2-test.mjs`: **74/74 PASS**.  
Bộ `scripts/m2-security-test.mjs`: **17/17 PASS**.

| Kiểm thử | Kết quả |
|---|---|
| Login đúng/sai, CSRF login, rate limit 429 | PASS |
| Cookie HttpOnly/Secure/SameSite=Lax | PASS |
| Missing CSRF trên mutation | 403 PASS |
| Cross-origin mutation | 403 PASS |
| Invalid/expired session | redirect login PASS |
| Session fixation (login kèm token cũ) | Token cũ bị xóa PASS |
| Session revoked khi disable/password change | PASS |
| Brute-force 8 lần → lock 15 phút | PASS |
| RBAC editor/author/admin; direct endpoint | PASS |
| IDOR author sửa bài người khác | 403 PASS |
| Stored XSS `<script>` trong admin content | Bị lọc ở public/preview PASS |
| Password hash trong HTML admin users | Không xuất hiện PASS |
| API key plaintext trong DB | Chỉ hash; key hiện một lần PASS |
| Audit login/post/security | PASS |
| Media upload | Bị khóa, redirect `media_blocked`; không ghi DB PASS (đúng phạm vi) |

**Chưa kiểm chứng đầy đủ:** rotate/revoke API client end-to-end; đổi mật khẩu tự thân/last-admin qua UI; MFA (không có trong app gốc); WAF/Access; session cleanup định kỳ (chưa có cron dọn sessions/login_attempts, hiện chỉ xóa lazy/qua thao tác).

---

## D. Performance Metrics

### D.1. Admin routes (Cloudflare GraphQL CPU; mẫu bucket)

| Route | Samples | CPU P50 | CPU P95 | CPU max | Wall P50/P95 |
|---|---:|---:|---:|---:|---:|
| `/admin` dashboard | 15 | 7.00 ms | **12.67 ms** | 12.67 ms | 646 / 845 ms |
| `/admin/posts` list | 15 | 4.33 ms | **14.75 ms** (cold) | 14.75 ms | 472 / 957 ms |
| Editor `/admin/posts/:id/edit` | 15 | 3.96 ms | **16.82 ms** (cold) | 16.82 ms | 474 / 1.024 ms |
| Preview | 15 | 5.41 ms | **18.18 ms** (cold) | 18.18 ms | 638 / 2.938 ms |
| Categories | 14 | 3.76 ms | **28.20 ms** (cold) | 28.20 ms | 306 / 1.220 ms |
| Users | 15 | 1.98 ms | **11.20 ms** (cold) | 11.20 ms | 270 / 766 ms |

- **Không có `exceededCpu`/`exceededMemory`**.
- **Chưa đạt mục tiêu P95 ≤ 7 ms** khi tính cả cold request. Request đầu mỗi phase (isolate/JIT mới) là 11–28 ms; các request sau ổn định:
  - dashboard 5.8–9.1 ms (vẫn có nhiều mẫu >7 ms → **FAIL mục tiêu**).
  - posts 3.2–6.0 ms, editor 2.7–4.7 ms, preview 4.5–6.7 ms, categories 2.7–5.4 ms, users 1.6–2.3 ms (warm đạt ≤7, cold outlier làm P95 tổng vượt).
- Nguyên nhân: dashboard chạy nhiều D1 query (counts, recent/upcoming, users/clients, audit/security) và render bảng lớn; cold start/JIT làm outlier. Các trang còn lại chủ yếu bị cold outlier, không phải steady-state.
- Đã cache status counts 3 giây và tối ưu tag update; cần tối ưu dashboard (cache/aggregate queries, giảm audit payload) nếu muốn đạt P95 ≤7 tuyệt đối.

### D.2. D1 / quota

- D1 size: **1.55 MB**.
- 24h (trong đợt test): **~876k rows read / ~35.6k rows written**, 14.4k read query / 1k write query — test-heavy, vẫn dưới 5M reads/100k writes/ngày.
- Ghi DB phát sinh khi: save post (post + FTS + tags + revision + audit), publish/unpublish (triggers), user/API/settings/audit.
- Revision mỗi lần save: chưa có retention; đề xuất giữ tối đa 30–50 bản/bài hoặc 180 ngày, không tự xóa dữ liệu hiện có.
- Audit retention: chưa purge; đề xuất 180 ngày + dọn sessions/login_attempts bằng cron.

### D.3. Static/public

- 65 file static + admin.css/admin.js; requests static không gọi Worker.
- Public M1 P95 vẫn 4–5 ms (đo lại 42/42 public suite; settings cache thêm một query 5s/isolate).
- Workers Cache vẫn **không bật**; HTML `CDN-Cache-Control: no-store`; cache trước Worker **NOT VERIFIED**.

---

## E. UI Regression

Ảnh trong `screenshots-m2/`:

- Worker admin: login, dashboard, posts, editor (desktop, light + dark), mobile dashboard.
- Node Admin baseline: cùng bộ ảnh (desktop light, mobile) từ bản copy DB, không đụng DB thật.
- Posts/editor có cùng chiều cao/khung layout; editor giống từng khối.
- Dashboard khác do dữ liệu: Worker có 61 ảnh legacy, 3 users, security events/audit từ test; Node có 0 media, 1 user, ít audit. Đây là khác biệt dữ liệu, không phải layout.
- Nav count `Bài viết 70` đã sửa và hiển thị; ảnh dashboard cũ có thể chụp trước bản sửa nhỏ này.
- Dark/light mode đã chụp; mobile 390px không tràn ngang (kiểm tra trước đó).
- Chưa test Safari/Firefox/thiết bị thật.

---

## F. Outstanding Issues

| Mức | Vấn đề |
|---|---|
| **BLOCKED** | Media upload/R2: chưa có subscription/billing; upload bị khóa, chỉ legacy images. M2 **chưa đạt đầy đủ media parity**. |
| **PARTIAL** | Admin CPU P95 dashboard/editor ~10 ms, cold outliers 12–19 ms; chưa đạt mục tiêu 7 ms. |
| **PARTIAL** | API client rotate/revoke UI/logic có nhưng chưa test end-to-end; API contract đầy đủ vẫn M3. |
| **PARTIAL** | Settings `allow_ai_crawlers` đã đổi robots.txt nhưng UA block vẫn theo config tĩnh, chưa đọc setting. |
| **PARTIAL** | Revisions/audit/session cleanup chưa có retention cron; D1 writes tăng theo số lần save. |
| **NOT VERIFIED** | WAF/Access/edge cache; Safari/Firefox; tải 100k bài admin; self-password/last-admin UI edge; session cleanup sau 7 ngày. |
| **NOTE** | `apiBase` UI hiển thị `/api/v1` nhưng M2 chưa port Publishing API; M3. |
| **NOTE** | Staging có endpoint reset rate bảo vệ bằng staging token, chỉ dùng test; không phải production. |
| **NOTE** | Admin login công khai trên workers.dev nhưng yêu cầu xác thực; mật khẩu staging đã xoay vòng, không dùng default. |

---

## G. M3 Readiness

**Chưa sẵn sàng M3 nếu chưa xử lý:**

1. **CPU API create** từ M0.5 vẫn là blocker: 2 KB ~4.4–7.1 ms warm; 8 KB ~7.7–10.4 ms; 84 KB 22–154 ms. Cần cap content (ví dụ 32 KB), sanitize/DO, hoặc Paid/queue.
2. **Admin CPU** dashboard/editor chưa P95 ≤7; cần tối ưu trước khi vận hành thường xuyên, dù traffic admin thấp.
3. **Media/R2** chưa hoạt động; Publishing API media upload sẽ BLOCKED.
4. **Publishing API contract** chưa đầy đủ (list/slug/schedule/unpublish/delete/me/openapi) — M3.
5. **Public/Admin consistency** hiện tốt; giữ nguyên làm baseline khi M3.
6. WAF/Access/edge cache vẫn NOT VERIFIED; chưa dùng cache trong M1/M2.

Đề xuất M3: chỉ bắt đầu sau khi chốt content-size policy/CPU API, hoàn thiện API contract trên staging và có quyết định R2/billing. Không cutover production.

---

## Tài nguyên staging

| Resource | Giá trị |
|---|---|
| Worker | `meohay-m0-stg-230403`, version `66ba4f28-0b93-4a61-84ec-400a60b2c63f` |
| URL | `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` |
| D1 | `meohay-m0-stg-230403` / `df5d54cc-bb44-4f79-90b7-e5c15e182d85`, 1.55 MB |
| DO | `SecureOps` (auth/rate/sanitize) |
| Cron | `*/5 * * * *` |
| Static | 65 file; admin.css/admin.js; 61 ảnh legacy |
| Media/R2 | Không tạo bucket/subscription; upload 501/redirect blocked |
| Admin accounts | 3 test users staging, mật khẩu random local; không đưa secret lên repo |
| Sessions | Đã dọn; không có session test còn lại |

Không xóa tài nguyên staging cho đến khi có phê duyệt cleanup.

---

## Trạng thái kết thúc

Ứng dụng Node gốc vẫn ở `f26d45d`; không deploy production, không DNS, không R2 billing/Workers Paid, không thay thế API production.

**M2 ĐÃ HOÀN THÀNH TRONG PHẠM VI ĐƯỢC PHÉP — ĐANG CHỜ PHÊ DUYỆT M3.**
