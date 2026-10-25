# M7 — Data Migration, Cutover & Rollback Plan

**Chỉ kế hoạch. Không export dữ liệu thật lên staging, không tạo production D1, không cutover.**

## 1. Nguồn và đích

| Hạng mục | Nguồn Node | Đích Cloudflare |
|---|---|---|
| App | `D:\Github\MeoHayMoiNgay` @ `f26d45d` | Worker `meohay-production` (kế hoạch) |
| DB | `data/blog.db` SQLite (read-only preflight) | D1 production, migrations 0001–0010 |
| Media | `uploads/` / legacy static | R2/B2 (chưa duyệt) |
| Auth | scrypt hash `scrypt$N$r$p$salt$hash` | DO verifyScrypt tương thích |
| API clients | bảng `api_clients` (hiện 0) | giữ `key_hash`/scopes/mode |

## 2. Số liệu nguồn đã kiểm tra (read-only)

| Bảng | Node |
|---|---:|
| posts | 70 (70 published) |
| revisions | 70 |
| categories | 7 |
| tags | 26 |
| post_tags | 106 |
| users | 1 admin |
| api_clients | 0 |
| settings | 1 (`default_author_id`) |
| media / media_usages | 0 / 0 |
| slug_history | 0 |
| scheduled | 0 |
| FTS | 70 |

`content_html`/`source` byte sums khớp D1 staging: **178.073 / 178.073**; slug/title/category/tag/status khớp 70/70.  
Khác biệt staging có chủ đích: `author_id` synthetic `user-m0-admin` (Node UUID `1fb54864-…`), revisions 0 (staging fixture), test users/API clients. Production phải giữ ID Node hoặc map rõ.

## 3. Thứ tự import

1. `users` (giữ UUID; password_hash; role/is_active).
2. `categories` (giữ UUID; slug unique).
3. `tags` (giữ UUID; slug unique).
4. `posts` (giữ UUID; `author_id` map; `version=1`, `change_id` random; timestamps UTC ISO).
5. `post_tags`.
6. `revisions`.
7. `slug_history`.
8. `media`, `media_usages` (nếu có; binary copy riêng).
9. `settings` — merge: giữ default target, upsert key Node (`default_author_id`).
10. `api_clients` (nếu có) — key_hash/scopes/publish_mode/rate_limit.
11. `audit_log` (nếu cần; ID autoincrement; actor mapping).
12. `scheduled` posts — giữ `scheduled_at` UTC; Cron sẽ publish sau cutover.
13. Rebuild FTS từ `posts`; rebuild counters; verify triggers.

Không import `sessions` (bắt buộc đăng nhập lại), `login_attempts`, `idempotency_keys`, `rate_limits` (operational, tránh dữ liệu cũ/khóa nhầm).

## 4. Quy tắc dữ liệu

- **ID mapping:** giữ nguyên UUID nếu không trùng; nếu map user, cập nhật `posts.author_id`, `revisions.edited_by_id`, `audit.actor_id`, `api_clients` creator. Không tự tạo ID mới cho post/category/tag.
- **UTC/timezone:** tất cả timestamp ISO 8601 UTC; không dùng local time; so sánh `scheduled_at` bằng UTC.
- **Unique:** posts.slug, posts.external_id per client, categories.slug, tags.slug, users.email, media.filename, slug_history.slug.
- **FTS:** export SQLite không mang FTS5 ảo; rebuild `posts_fts` từ `posts` sau import.
- **Counters:** rebuild `published_posts`, category/tag cached counts sau import.
- **Revisions:** phải import đủ; staging hiện 0 nên không dùng staging làm bằng chứng revision parity.
- **API key:** nếu tạo key sau migration, dùng API mới; không chuyển plaintext key (chỉ hash). Với bảng hiện 0, không có key cũ.
- **Audit:** có thể import; nếu không, ghi nhận mất lịch sử trước cutover.
- **Sessions:** không migrate; user đăng nhập lại.

## 5. Preflight / verify

Công cụ: `scripts/m7-migration-preflight.mjs` (đọc Node read-only, so sánh D1 target, chỉ xuất counts/checksum; không xuất nội dung).

Kết quả staging hiện tại:
- Counts: PASS (posts/published/categories/tags/post_tags/FTS/counters).
- Content hashes **70/70 PASS khi bỏ author_id**; full hash fail chỉ vì author mapping staging.
- `version`/`change_id`: 70/70 present.
- Revisions staging 0/70 — **staging gap**; đã remediate trên DB cô lập bên dưới.
- Category/tag slugs: PASS.
- Không missing/extra posts.

### Kết quả migration đầy đủ trên D1 cô lập (2026-10-25)

- DB: `meohay-m7-migration-1792944499` / `448322ca-8b5f-4adc-9cb1-a24690a75fad` (APAC, Free).
- Source: `data/blog.db` read-only; import SQL local; không đưa dữ liệu lên staging chính.
- Kết quả **29/29 checks PASS**:
  - Posts 70/70, published 70, revisions 70/70, users 1/1, categories 7, tags 26, post_tags 106, audit 2, slug_history 0, media 0, API clients 0, scheduled 0.
  - Full post content hash **70/70**, revision hash **70/70**, author mapping **70/70** (Node user UUID giữ nguyên).
  - FTS 70 + search hit; counters 70; orphan 0; triggers 9; migrations 10.
  - Idempotent re-import: counts/hashes unchanged, no duplicates.
- **Lỗi đã phát hiện:** SQL generator ghi file bằng Windows CRLF làm `
` trong content thành `

`, khiến hash lệch. Đã sửa generator ghi `newline="
"`; re-import PASS.
- Password hash trong DB cô lập dùng hash test (không dùng credential nguồn); production migration có cờ `M7_PRESERVE_PASSWORD_HASH=1` để giữ hash nguồn. Không chạy cờ này trên staging.
- Verification: `scripts/m7-verify-isolated-migration.mjs`; generator: `scripts/m7-generate-import.py`.

**Kết luận:** revisions/author parity đã được chứng minh trên DB cô lập; staging chính vẫn giữ fixture cũ (không import dữ liệu Node vào staging).

Production preflight phải chạy lại với D1 production và yêu cầu:
- 70/70 full content hash (bao gồm author_id) sau mapping.
- revisions 70/70, users 1/1, API clients đúng, settings merge.
- FTS search smoke, counters/trigger test.
- Backup source + D1 bookmark trước/sau.

## 6. Cutover (chưa thực hiện)

1. Thông báo/freeze write Node (maintenance) — cần phê duyệt.
2. Backup Node DB + WAL; `PRAGMA integrity_check`; SHA-256; lưu ngoài máy.
3. Export snapshot cuối; ghi thời điểm cutoff UTC.
4. Tạo D1 production; áp migrations; import theo thứ tự.
5. Rebuild FTS/counters; chạy preflight/verify; smoke test DB copy.
6. Deploy Worker production (workers.dev/preview trước), chưa đổi DNS.
7. Smoke: public/article/category/tag/search; Admin login/RBAC; API create/update/OCC/idempotency; sitemap/RSS/robots/canonical/redirects; cron.
8. Chỉ sau phê duyệt riêng mới chuyển DNS/custom domain.
9. Theo dõi 24–48h: 5xx, CPU, D1 reads/writes/storage, DO, cron, SEO.
10. Giữ Node + backup + D1 bookmark để rollback.

## 7. Dữ liệu phát sinh trong cutover

- Freeze write trước export cuối; nếu không freeze được, export delta theo `created_at/updated_at > cutoff`, nhưng timestamp không đủ an toàn cho concurrent writes.
- Sau cutover, mọi write vào D1. Nếu rollback về Node, phải freeze D1, export delta (posts/revisions/media metadata/API clients/audit) và import vào Node với mapping; **đổi DNS ngược không đồng bộ dữ liệu**.
- Không tự động merge hai chiều; cần người vận hành và cửa sổ freeze.

## 8. Rollback

- **Code:** Worker rollback version trước; DB không tự rollback.
- **DB:** Time Travel/bookmark hoặc restore backup độc lập; verify FTS/counters.
- **Infra:** giữ Node làm fallback; DNS rollback chỉ sau khi xử lý delta.
- **Media:** nếu R2/B2, cần backup/mirror; metadata D1 và object phải đi cùng.
- **RTO mục tiêu:** code 5 phút; DB 15–30 phút; infra/DNS 30–60 phút (chưa diễn tập production).

## 9. Production config dry-run

`wrangler.production.example.jsonc`:
- `workers_dev:false`, `ENVIRONMENT=production`, `REQUIRE_IF_MATCH=1`, `REQUIRE_STAGING_TOKEN=1`, `MEDIA_PROVIDER=static`.
- Không có R2 binding; D1/DO/Assets/Cron đúng.
- **Dry-run** với D1 ID giả + domain example: đọc **197 asset files**, bundle 1.741,96 KiB (gzip 331,37 KiB), bindings D1/DO/ASSETS, không deploy.
- Không có secret/token/password trong file mẫu.
- Còn thiếu trước production: D1 ID/domain thật, secret names (nếu dùng), route/custom domain, R2 nếu duyệt, alert/backup automation.

## 10. Điều kiện dừng

Không tạo D1/Worker production, không đổi DNS, không import dữ liệu thật, không cutover trong M7.
