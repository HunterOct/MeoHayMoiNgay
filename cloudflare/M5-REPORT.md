# M5 — PRODUCTION READINESS, BACKUP, DISASTER RECOVERY & CLOUDFLARE FREE OPERATIONS

**Ngày:** 2026-10-25  
**Ứng dụng Node gốc:** `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — không thay đổi, working tree sạch.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — Worker version cuối `26e1f9ef-c96b-4917-ae73-664a082e3509`.  
**D1 test M5:** source `bd69678d-a102-4f32-8822-b2f8c0014416`, restore `1b87d6c6-c505-4644-845f-bc14558d03b9`.  
**Phạm vi:** chỉ M5/staging; không production, DNS, zone/WAF thật, R2 billing, Workers Paid, không sửa Node app, không xóa staging, không bắt đầu M6.

> **Kết luận điều hành:** M5 đã hoàn thành trong phạm vi staging. Backup/restore và OCC đã được kiểm chứng thật. Tuy nhiên **chưa production-ready**: media upload vẫn BLOCKED, WAF/Access chưa kiểm chứng trên domain thật, CPU P95 vượt mục tiêu 7 ms, 100.000 bài không khả thi trên Free. Quyết định cuối: **NO-GO cho production**, **CONDITIONAL GO cho M6 hardening trên staging**.

---

## A. Production Readiness Assessment

| Khu vực | Trạng thái | Bằng chứng |
|---|---|---|
| Public blog, SEO, redirects, sitemap/RSS | **PASS** | M1 42/42; UI screenshots desktop/mobile; health/SEO probes 200 |
| Admin auth/RBAC/CSRF/session/revisions | **PASS** | M2 74/74; security 17/17; screenshot dashboard/editor |
| Publishing API contract/scopes/idempotency | **PASS** | M3 28/28 |
| OCC API + Admin + bulk + purge | **PASS** | M4 12/12; M5 bulk 26/26 |
| Backup/export/restore/Time Travel | **PASS** | 24/24 verify; counts/bytes/FTS/triggers khớp |
| Monitoring/health/cron heartbeat | **PARTIAL** | Script + heartbeat PASS; alerting tự động chưa có |
| Deployment config dev/staging/prod | **PASS (docs/sample)** | Staging deploy thật; production chỉ file mẫu |
| Rollback code/DB | **PARTIAL** | Quy trình + Time Travel test; chưa diễn tập rollback staging/production |
| Infrastructure rollback về Node | **NOT VERIFIED** | Chưa cutover, chưa test đồng bộ dữ liệu ngược |
| Media upload/storage | **BLOCKED** | R2 chưa được duyệt; endpoint 501 |
| WAF/Access/Bot Fight Mode trên zone thật | **NOT VERIFIED** | Chỉ lập kế hoạch |
| Capacity 100.000 bài | **FAIL** | Vượt 500 MB/database và 5 GB/account |
| Worker CPU P95 ≤7 ms | **FAIL** | 24h P95 15,38 ms; P50 4,83 ms; cold start |

### Lỗi thực tế phát hiện và sửa trong M5

1. **Admin bulk route bị `/:id` che**: `POST /admin/posts/bulk` khớp nhầm `POST /admin/posts/:id` → 404. Đổi endpoint thành `/admin/posts/bulk/apply` (forms + tests).
2. **Form parser làm mất field lặp**: `parseBody` chỉ giữ một `ids`, nên bulk chỉ tác động bài cuối. Sửa parser URL-encoded để giữ mảng.
3. **Bulk không bắt buộc version**: request thiếu `version-<id>` vẫn last-write-wins. Nay thiếu/stale → 409 trước khi ghi; race giữa preflight và ghi dừng batch + audit.
4. **Single delete/restore/purge không bắt buộc version**: nay thiếu version → 409; purge có claim version trước khi xóa.
5. **PATCH chỉ gửi `excerpt` bị 400** vì `title` bị required nhầm trong update schema. Sửa schema để partial update đúng OpenAPI.
6. **Purge 500 do FK**: xóa `posts` trước `post_tags` vi phạm FK. Sửa thứ tự + claim.
7. **Media URL cho phép `http://`**: siết còn `https://` hoặc path nội bộ.
8. **Thiếu cron heartbeat**: thêm `settings.cron_last_run`/`cron_last_error` mỗi 5 phút.
9. **`/api/m0/*` có thể mở nếu production thiếu token**: chặn toàn bộ surface khi `ENVIRONMENT=production`; production sample đặt `REQUIRE_STAGING_TOKEN=1`.
10. **OpenAPI thiếu OCC**: nâng 1.1.0, mô tả `version`, `If-Match`, 412/428.

---

## B. Backup & Restore Results

### Thiết kế đã kiểm chứng
- Export data-only các bảng thường; **không export FTS5 virtual tables** (D1 từ chối).
- Schema/trigger tạo từ migrations `0001…0010`.
- Sau restore: rebuild `posts_fts` từ `posts`; rebuild cached counters.
- Mã hóa AES-256-GCM + SHA-256; khóa `.m5-backup.key` local, gitignored.

### Kết quả restore
Nguồn/target khớp **24/24**:
| Chỉ số | Source | Restore |
|---|---:|---:|
| Posts | 83 | 83 |
| Published | 80 | 80 |
| Revisions | 166 | 166 |
| Categories / tags / post_tags | 7 / 26 / 106 | 7 / 26 / 106 |
| Users / sessions / audit | 1 / 2 / 100 | 1 / 2 / 100 |
| FTS rows | 83 | 83 |
| HTML/source bytes | 410.163 | 410.163 |
| Counter published | 80 | 80 |

- FTS search `"wifi"*` sau rebuild: **12 hits**.
- Orphan rows: 0; cached category/tag counts: 0 sai; triggers: 9; migrations: 10.
- Trigger test: published 80→81→80; category 10→11→10.
- Time Travel: xóa 1 bài 73→72, restore bookmark → 73; bookmark test `00000000-000000a9-0000510f-91f529d13ea4d9e50df5edfca89fdd05`.
- Bookmark current của DB test sau export: `00000002-00000000-0000510f-7864d54bdc8f149889c84a5a7a93f7bb`.

### Thời gian thực tế
| Bước | Thời gian |
|---|---:|
| Export 3,2 MB / 83 bài | 9,8 s |
| Clear target | 3,8 s |
| Import | 13,8 s |
| Rebuild FTS/counters | 3,8 s |
| **Tổng** | **~31 s** |

Encrypted backup mới: 3.339.291 byte → 3.339.324 byte `.enc`; SHA-256 `2120ee6e…b47002`; decrypt verify PASS.

### Đã/Chưa khôi phục
- **Đã**: posts, revisions, taxonomy, quan hệ tag, users + password hash, sessions, API client hash, settings, counters, audit, idempotency, media metadata.
- **Chưa**: FTS trực tiếp (rebuild), DO SQLite (rate limit/auth scratch), media binary, secret Cloudflare, log Workers.
- Sessions restore có thể làm sống lại session còn hạn; khuyến nghị **invalidate toàn bộ session sau restore production**.

### RPO/RTO đề xuất
- Xóa nhầm: RPO 0–5 phút (Time Travel), RTO 5–15 phút.
- Hỏng DB: RPO 24h (backup ngày), RTO 10–20 phút.
- Backup automation chưa bật: phụ thuộc máy chạy ngoài Cloudflare; máy tắt → chỉ còn Time Travel 7 ngày.

---

## C. Cloudflare Free Limits (revalidated 2026-10-25)

| Dịch vụ | Giới hạn Free | Áp dụng |
|---|---|---|
| D1 database size | **500 MB/database** | Còn hiệu lực |
| D1 account storage | **5 GB/account** | Còn hiệu lực |
| D1 databases | **10/account** (không phải 50) | Quan trọng cho sharding |
| D1 rows | 5M read/day; 100k written/day | Reset 00:00 UTC |
| D1 Time Travel | 7 ngày; 10 restore/10 phút/DB | Đã test |
| D1 row/string | 2 MB | Nội dung 200k ký tự OK |
| Workers requests | 100.000/day; vượt → Error 1027 | Fail-open/closed theo route |
| Workers CPU | 10 ms/request; 128 MB; 50 subrequests | Cold outlier >10 ms |
| Static Assets | 20.000 file/version; 25 MiB/file | Ảnh legacy tĩnh |
| Cron | 5 trigger/account; CPU 10 ms | 1 trigger `*/5` |
| Durable Objects | 100k req/day; 13.000 GB-s/day; SQLite only | 0 exceeded |
| R2 | 10 GB-month; 1M Class A; 10M Class B; egress free | **Cần bật subscription/billing** |
| WAF Free | Custom rules + **1 rate limiting rule** | Chưa áp dụng zone |
| Bot Fight Mode | Free, toàn domain, **không skip được** | Không bật |
| Access | Cần Zero Trust; bảo vệ được workers.dev/hostname/path | Chưa bật; giới hạn user chưa xác minh |

Nguồn: Cloudflare Docs D1 Limits, Workers Limits/Pricing, Durable Objects Pricing, R2 Pricing, WAF/Bot docs (truy cập 2026-10-25).

---

## D. Deployment & Rollback

- **Dev/staging/prod tách biệt**: `wrangler.jsonc`, `wrangler.remote.jsonc`, `wrangler.production.example.jsonc`.
- Staging deploy thật; production chỉ file mẫu, `workers_dev:false`, D1 ID/domain placeholder, không R2, `REQUIRE_STAGING_TOKEN=0`.
- Secrets: `STAGING_TOKEN` qua Wrangler; không commit token/mật khẩu/khóa.
- Migration forward-only; trước migration phải bookmark + backup + test trên copy.
- CI/CD mẫu: `ci/github-actions-staging.example.yml` (chưa kích hoạt), deploy thủ công có xác nhận.
- Rollback: code qua `wrangler rollback`; DB qua Time Travel/restore; hạ tầng về Node **NOT VERIFIED**.
- Release checklist đầy đủ tại `docs/RELEASE-CHECKLIST.md`.

**Điểm cần nhớ:** rollback code không rollback DB; rollback DB không tự đổi binding; migration không có down tự động.

---

## E. Monitoring & Alerts

Công cụ: `scripts/m5-monitor.mjs` (Workers/DO/D1 GraphQL + D1 REST + HTTP probes + backup age). JSON: `fixtures/m5-monitor-latest.json`; exit 2 khi HIGH/CRIT.

### Snapshot 24h (2026-10-25T09:05Z)
| Metric | Giá trị |
|---|---:|
| Workers requests | 6.313 (0 lỗi) |
| CPU P50 / P95 / P99 | **4,83 / 15,38 / 27,10 ms** |
| HTTP 401/403/429/5xx | 0 / 0 / 0 / 0 |
| D1 rows read/written | 1.291.929 / 48.824 (do test, không phải traffic thật) |
| D1 staging size | 3,85 MB / 500 MB |
| D1 account | 12,28 MB / 5 GB (3 DB) |
| DO requests | 2.678 / 100k |
| DO CPU total | 33,04 s; P50 90,2 ms; P95 145,7 ms |
| DO memory P95 | 41,3 MiB |
| DO exceeded CPU/memory | 0 / 0 |
| Cron heartbeat | mới 0,3 phút, `ok=true` |
| Backup | 1,76 MB (snapshot cũ), age 1,4h |
| Health/SEO probes | tất cả 200 |

- GraphQL `workersInvocationsScheduled` trả 0 bản ghi dù cron chạy → **NOT VERIFIED** cho dataset này; heartbeat D1 là nguồn tin cậy.
- Thiếu: alert email/webhook tự động, WAF/Access analytics, DO queue/hibernation, log retention dài, đo CPU theo route.
- Ngưỡng 50/70/85/95% đã cài; quota ngày chỉ đánh giá khi cửa sổ ≥6h (tránh false CRIT do test burst).
- Free không hỗ trợ reservation/priority theo route; bảo vệ Admin/API chỉ ở tầng ứng dụng + rate limit.

---

## F. Database Capacity

Đo thực tế:
- Staging hiện tại: 3,85 MB / 70 bài (còn page free sau cleanup).
- Test M5: 4,06 MB / 83 bài (gồm 10 bài 26 KB + 2 revisions) → ~49 KB/bài trung bình.
- Thử 10 bài 26.132 byte + 2 revisions: tăng ~1,59 MB → **~159 KB/bài**.

| Số bài | 30–50 KB/bài | 120–180 KB/bài (thực tế AI) |
|---:|---:|---:|
| 1.000 | 30–50 MB | 120–180 MB |
| 10.000 | 0,3–0,5 GB | 1,2–1,8 GB |
| 50.000 | 1,5–2,5 GB | 6–9 GB |
| 100.000 | 3–5 GB | 12–18 GB |

**Kết luận:**
- 1.000 bài: thoải mái.
- 10.000 bài: vượt 500 MB/database → phải chia DB; Free tối đa 10 DB.
- **100.000 bài: FAIL trên Free** với nội dung/revisions/FTS thực tế. Trần account ~35.000 bài ở 150 KB/bài; ~100.000 chỉ khi nội dung rất nhỏ, ít revision.
- Mỗi DB ~3.300 bài lớn hoặc ~11.300 bài ở mức staging hiện tại.
- Phương án (chưa thiết kế/triển khai): giảm retention revision, archive, tách DB theo năm/chuyên mục, chuyển nội dung dài sang storage, hoặc nâng Paid.
- Pageview: 100k–1M/tháng khả thi; ~3M/tháng sát trần 100k req/day; 10M/tháng không khả thi Free.

---

## G. Security & Media

- App-level: auth/RBAC/CSRF/session, API scopes, rate limit, sanitize, strict OCC, version cho Admin/bulk/purge — PASS.
- Stale version: 412 `version_conflict` + `current_version`; thiếu header: 428.
- Media URL: chỉ `https://` hoặc path nội bộ; không fetch server-side → không SSRF trực tiếp.
- WAF/Access/BFM: **NOT VERIFIED**, chưa thay đổi zone. BFM không skip được nên **không bật** đến khi kiểm chứng API; nếu bật có thể chặn AI publishing.
- Hotlink media: app referer check chỉ áp dụng khi R2 bật; static assets chưa có kiểm soát.
- Media: **BLOCKED**. R2 là lựa chọn chính nhưng cần bật subscription/billing; external HTTPS URL chỉ là dự phòng, rủi ro mất ảnh/bản quyền/hotlink. Với blog AI đăng ảnh, đây là blocker production.
- Quy mô ảnh: 3 ảnh × 200 KB × 100 bài/ngày ≈ **1,8 GB/tháng**, ~21,6 GB/năm → vượt R2 Free 10 GB sau ~5–6 tháng nếu không dọn.
- Không có plaintext secret trong repository/log/audit.

---

## H. Regression Results

| Bộ test | Kết quả |
|---|---|
| M1 public consistency | **42/42 PASS** |
| M2 Admin/functional/security | **74/74 PASS** |
| M2 security riêng | **17/17 PASS** |
| M2.5 API client/settings/retention | **16/16 PASS** |
| M3 Publishing API | **28/28 PASS** |
| M4 OCC | **12/12 PASS** |
| M5 bulk/delete/restore/purge/idempotency/cron race | **26/26 PASS** |
| Backup/restore verify | **24/24 PASS** |
| Strict If-Match / partial PATCH / https-only | PASS (428/412/200/400) |
| UI screenshots | 9 ảnh: home/article desktop+mobile, login/dashboard/posts/editor/mobile |

**Tổng test chức năng: 215/215 PASS.**

Chưa kiểm chứng: load test lớn, hết quota ngày, D1 mất kết nối kéo dài, WAF/Access thật, BFM với API, media upload, rollback staging/production, restore xuyên schema, production cutover.

---

## I. Production Blockers

### P0 — Không thể production nếu chưa xử lý
1. **Media upload BLOCKED**: blog AI có ảnh không thể vận hành đầy đủ. Cần quyết định R2/billing hoặc chấp nhận external URL có kiểm soát.
2. **100.000 bài không khả thi trên Free** nếu đây là yêu cầu cứng. Cần chốt mục tiêu thực tế (~35k bài) hoặc kiến trúc/nâng gói.

### P1 — Xử lý trước/ngay khi phát hành
1. WAF/Access/BFM chưa kiểm chứng trên domain thật; BFM có thể chặn Publishing API.
2. CPU P95 15,38 ms > mục tiêu 7 ms; cold start/outlier chưa được chứng minh an toàn dưới tải.
3. Chưa có alert tự động (email/webhook); monitor đang chạy thủ công.
4. Backup automation phụ thuộc máy ngoài; chưa diễn tập restore production/cutover.
5. Rollback hạ tầng về Node chưa kiểm chứng; dữ liệu D1 phát sinh chưa có quy trình đồng bộ ngược.
6. Session restore có thể resurrect session cũ; cần invalidate sau restore.
7. Bulk nhiều bài không phải transaction all-or-nothing; race hiếm có thể để lại một phần thay đổi (có cảnh báo/audit).

### P2 — Tối ưu sau
1. Fuzz sâu HTML/Markdown 200k, CPU payload lớn.
2. DO memory/queue/hibernation metrics chi tiết.
3. Audit/revision retention policy production.
4. UI/accessibility, image optimization (WebP/AVIF/srcset), Lighthouse.
5. Cache public page/edge để giảm CPU/request (chưa bật).
6. Log retention/analytics chi tiết hơn.

---

## J. M6 Roadmap đề xuất

1. **Performance & cold start**: đo CPU theo route/warm pool; giảm bundle/import; cache public; mục tiêu P95 ≤7 ms và có số liệu tải thật.
2. **Image optimization**: WebP/AVIF, srcset, lazy-load, kích thước cover; đo LCP/CLS.
3. **UI/accessibility**: WCAG contrast/keyboard/ARIA, dark mode, mobile regression.
4. **Media completion**: quyết định R2 (billing/guard/backup) hoặc external URL policy; upload validation, lifecycle, media backup, hotlink.
5. **Production hardening**: triển khai WAF/Access trên custom domain; kiểm chứng BFM/API; alert tự động; backup scheduled; release dry-run; rollback drill.
6. **Capacity**: chốt mục tiêu 10k/35k/100k bài; thiết kế multi-DB/retention nếu cần; test quota/graceful degradation.
7. **Data**: invalidate session sau restore; purge/revision retention; bulk transaction semantics; monitoring D1 storage guard.

---

## GO / NO-GO

# **NO-GO cho production.**

Lý do: media upload vẫn BLOCKED (yêu cầu ảnh cho blog AI), WAF/Access chưa kiểm chứng, CPU P95 vượt mục tiêu, 100k bài không khả thi trên Free, alert/backup automation và rollback hạ tầng chưa hoàn tất.

# **CONDITIONAL GO cho M6 hardening trên staging.**

Điều kiện: giữ nguyên staging, không production/DNS/R2/billing; xử lý P0/P1 trong M6; media phải được quyết định trước khi coi là production-ready.

**Không bắt đầu M6, không deploy production, không đổi DNS, không bật R2/billing/Paid, không sửa Node app, không xóa tài nguyên staging.**

---

**M5 ĐÃ HOÀN THÀNH TRONG PHẠM VI STAGING — ĐANG CHỜ PHÊ DUYỆT M6 / PRODUCTION DECISION.**
