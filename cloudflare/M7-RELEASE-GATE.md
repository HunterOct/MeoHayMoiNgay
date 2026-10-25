# M7 — FINAL RELEASE GATE

**Ngày:** 2026-10-25  
**Node app:** `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — không thay đổi.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — version `3d782585-b039-423f-861f-2ec7c7679db9`.  
**Scope:** release gate/staging only. Không production, DNS, zone/WAF thật, R2/billing, Paid, không xóa staging.

> **Release Gate: NO-GO.** Media upload động vẫn BLOCKED và WAF/Access chưa kiểm chứng trên zone thật. Ứng dụng, backup/restore và regression app-level đã đủ mạnh để tiếp tục sau khi có quyết định media/preproduction; chưa đủ để phát hành production.

> **Post-M7 decision (2026-10-25):** người dùng chọn **Static Assets**; media R2/B2 bên dưới chỉ là lịch sử. Xem `STATIC-ASSETS-MEDIA-REPORT.md`.
>
> **Post-M7 remediation:** M3 đã PASS **28/28** trên build hiện tại; migration revisions/author parity đã PASS **29/29** trên D1 cô lập. Xem `FINAL-BLOCKER-REPORT.md`. Release gate vẫn NO-GO vì media/WAF.

---

## A. Executive Summary

M7 đã hoàn tất:

- **Media decision matrix** R2/B2/không upload, cost model 1/3/5 ảnh × 10/30/50/100 bài/ngày; xác định R2 là chính, B2 dự phòng.
- **Media adapter tests**: 14/14 local mock PASS (upload/read/delete/metadata/duplicate/storage fail/DB rollback/disabled); 18/18 test service/policy trước đó. Remote R2 **NOT VERIFIED**.
- **Preproduction/WAF plan**: subdomain, DNS/SSL/routing, Access `/admin/*`, 1 rate-limit rule, no BFM, test matrix, rollback.
- **Production config dry-run**: 197 asset files, 1.741,96 KiB (gzip 331,37 KiB), D1/DO/Assets bindings, không deploy, không secret.
- **Migration preflight**: Node 70 bài khớp D1 staging 70/70 content hash (bỏ author mapping), categories/tags/FTS/counters khớp; revisions staging 0/70 là gap có chủ đích; author ID cần map khi production.
- **Data migration/cutover/rollback** runbook: ID mapping, UTC, unique, FTS rebuild, counters, sessions/API keys/media, freeze/delta/rollback.
- **Security release gate**: app-level PASS; WAF/Access/BFM NOT VERIFIED; BFM không được bật khi chưa test exemption API.
- **Final quality gate**: **215/215 PASS** trên build hiện tại; migration parity **29/29** trên D1 cô lập; media 18+14; restore 24/24.

Chưa thể phát hành vì:
- Dynamic media upload chưa hoạt động (provider/billing chưa duyệt).
- WAF/Access/BFM chưa test trên preproduction zone.
- Production migration/cutover/rollback chưa diễn tập với dữ liệu thật (và không được phép làm trong M7).
- CPU P95 low-traffic chưa chứng minh ≤7 ms; alert/backup automation còn thủ công.

---

## B. Media Decision Matrix

| Tiêu chí | Cloudflare R2 | Backblaze B2 | Không dynamic upload |
|---|---|---|---|
| Free | 10 GB-month, 1M Class A, 10M Class B, egress free | 10 GB storage; egress/ops theo B2 | Legacy static + external HTTPS |
| Billing | **Bắt buộc R2 subscription/billing** | Không cần thẻ để bắt đầu; overage billed | Không |
| Upload AI/Admin | Có (S3 API/Worker binding) | Có (S3 API) | **Không** |
| Backup | Cần mirror/export riêng | Cần mirror/export | Legacy/asset backup |
| Hotlink | App/Worker referer + R2 | App/Worker referer + provider | Khó kiểm soát |
| Rủi ro | Overage billed; **không có hard cap đã xác nhận** | Provider ngoài, egress/terms | Ảnh mất/hotlink/bản quyền |
| Kết luận | **Chính nếu billing được duyệt** | **Dự phòng $0-billing** | Chỉ tạm, không đủ nếu ảnh cốt lõi |

### Cost/capacity (ước tính, chưa có upload thật)

Giả định ảnh tối ưu: 1 ảnh 200 KB, 3 ảnh 500 KB, 5 ảnh 800 KB/bài.

| Bài/ngày | 1 ảnh/năm | 3 ảnh/năm | 5 ảnh/năm |
|---:|---:|---:|---:|
| 10 | 0,72 GB | 1,8 GB | 2,88 GB |
| 30 | 2,16 GB | 5,4 GB | 8,64 GB |
| 50 | 3,6 GB | 9 GB | 14,4 GB |
| 100 | 7,2 GB | 18 GB | 28,8 GB |

- 100 bài/ngày × 5 ảnh vượt R2 Free 10 GB sau ~4–5 tháng; 3 ảnh sau ~6–7 tháng.
- Upload operations 3.000–15.000/tháng ở 100 bài/ngày; dưới 1M Class A.
- Reads 100k pageview/tháng, 3 ảnh, cache hit 90% ≈ 90k Class B/tháng; cache hit chưa đo.
- R2 vượt Free: storage ~$0,015/GB-month, Class A/B theo bảng giá; **budget alert chỉ thông báo, không ngăn phí**. Không được coi alert là hard cap.
- B2: 10 GB free, sau đó billed; cần kiểm tra egress/terms hiện hành trước khi chọn.
- Không upload động: legacy 7,26 MB gốc + 3,41 MB WebP variants hiện có; AI/Admin không thể upload thumbnail/OG; external URL có thể mất/hotlink/bản quyền.

Chi tiết: `docs/MEDIA-COST-MODEL.md`, `docs/MEDIA-STORAGE.md`.

**Media adapter readiness:** local mock PASS 14/14; remote R2 **NOT VERIFIED / BLOCKED billing**. Không tuyên bố R2 PASS.

---

## C. Security Readiness

| Hạng mục | Trạng thái |
|---|---|
| Auth/session/cookie/RBAC/IDOR/CSRF | **PASS** (M2 74/74, security 17/17) |
| API scopes/key revocation/review mode | **PASS** (M3 28/28 final remediation) |
| OCC/If-Match/bulk/purge | **PASS** (M4 12/12, M5 26/26) |
| Idempotency/external_id | **PASS** |
| Sanitization/XSS/content image policy | **PASS** (HTTP images stripped) |
| Rate limit/login/search/anti-scraping | **PASS app-level** |
| Verified crawler | PASS staging UA tests; zone verified bot **NOT VERIFIED** |
| Backup/restore | **PASS** 24/24 |
| WAF custom/rate | **NOT VERIFIED** (no zone) |
| Cloudflare Access | **NOT VERIFIED** (not enabled) |
| Bot Fight Mode | **NOT VERIFIED / DO NOT ENABLE** (cannot skip API) |
| Incident response/on-call | **PARTIAL** (runbook only) |
| Secret recovery | **PARTIAL** (procedure only) |

Chi tiết: `docs/SECURITY-RELEASE-GATE.md`, `docs/PREPRODUCTION-WAF-PLAN.md`.

**Quan trọng:** WAF/Access/BFM chưa chạy trên domain thật; mọi tuyên bố bảo vệ tầng Cloudflare chỉ là kế hoạch. BFM áp dụng toàn domain, không skip Publishing API.

---

## D. Production Configuration

`wrangler.production.example.jsonc` đã được rà soát/dry-run:
- `workers_dev:false`, `ENVIRONMENT=production`, `REQUIRE_IF_MATCH=1`, `REQUIRE_STAGING_TOKEN=1`, `MEDIA_PROVIDER=none`.
- D1 binding placeholder, DO `SecureOps`, Static Assets, cron `*/5`, observability bật.
- Không R2; không secret/token/password trong file.
- Dry-run bundling: **197 asset files**, 1.741,96 KiB (gzip 331,37 KiB); D1/DO/ASSETS bindings; **không deploy**.
- `/api/m0/*` bị chặn khi `ENVIRONMENT=production`.

Còn thiếu trước production: domain/zone thật, D1 production ID, route/custom domain, secret names (nếu dùng), media provider nếu duyệt, alert/backup automation, production smoke checklist.

---

## E. Migration & Rollback

Nguồn Node (`data/blog.db`) và D1 staging:
- 70 posts / 70 published / 7 categories / 26 tags / 106 post_tags / FTS 70.
- **Content hash 70/70 khớp khi bỏ author_id**; byte sums 178.073/178.073; slug/title/category/tag/status khớp.
- Author staging synthetic `user-m0-admin` vs Node UUID `1fb54864-…` → production phải giữ/map ID.
- **Revisions: Node 70, staging 0** → staging fixture không đại diện; production phải import revisions.
- Staging có test users/API clients; production không copy các bản ghi test.
- `version`/`change_id` 70/70 có trên staging.

Cutover plan: freeze write → backup Node + integrity + checksum → export cuối → D1 production migrations → import theo thứ tự → FTS/counters rebuild → preflight → Worker deploy → smoke → DNS chỉ sau phê duyệt → monitor → rollback.
- Không migrate sessions/login_attempts/idempotency/rate limits.
- API key: chỉ hash; hiện Node 0 client.
- Media binary copy tách khỏi D1; chưa thực hiện.
- Rollback DNS không đồng bộ dữ liệu; phải freeze + export delta hai chiều.

Chi tiết: `docs/DATA-MIGRATION-CUTOVER.md`, `scripts/m7-migration-preflight.mjs`, `fixtures/m7-migration-preflight.json`.

---

## F. Functional/SEO Regression

| Bộ test | M7 kết quả |
|---|---|
| M1 public consistency | **42/42 PASS** |
| M2 Admin functional | **74/74 PASS** |
| M2.5 API client/settings/retention | **16/16 PASS** |
| M3 Publishing API | **28/28 PASS** (final remediation; timeout 30s, không bỏ case) |
| M4 OCC | **12/12 PASS** |
| M5 bulk/OCC | **26/26 PASS** |
| M2 security | **17/17 PASS** |
| M7 media adapter (mock) | **14/14 PASS** |
| M6 media service/policy | **18/18 PASS** |
| Backup/restore verify | **24/24 PASS** |
| SEO | M1 + Lighthouse SEO 100 |
| UI/accessibility | M6 final: home 96/100/100/100; a11y 100; article LCP 1,7s; admin login a11y 100; M7 không đổi UI code/không rerun |
| Cron/health/monitoring | heartbeat OK; health/SEO probes 200 |

**Final remediation: 215/215 PASS** trên build hiện tại (M1 42 + M2 74 + M2.5 16 + M3 28 + M4 12 + M5 26 + security 17).

---

## G. Free Tier Risk Assessment

| Dịch vụ | Giới hạn | Rủi ro |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU, 128 MB | Error 1027 khi hết ngày; CPU cold >10ms |
| D1 | 500 MB/DB, 5 GB/account, 10 DB, 5M read/100k write/day | 100k bài không khả thi; quota reset UTC, lỗi query khi hết |
| DO | 100k req/day, 13k GB-s/day, 5 GB | Content DO CPU ~90–150ms; chưa load test |
| R2 | 10 GB, 1M A, 10M B; billing required | Overage billed; **không có hard cap đã xác nhận** |
| WAF/Access | Free rule/user limits | Không kiểm chứng; BFM có thể chặn API |
| Backup | Local/AES; Time Travel 7d | Phụ thuộc máy ngoài; chưa tự động |
| Monitoring | Manual/script | Không phải hard enforcement; alert chỉ thông báo |

- Capacity an toàn: ≤10k bài, ≤30 bài AI/ngày, ≤1M pageview/tháng; 50 bài/ngày cần theo dõi; 100 bài/ngày cần retention/DB split; 100k bài NO-GO Free.
- **Không** khẳng định budget alert ngăn phí. R2/B2 overage vẫn có thể phát sinh nếu vượt free.
- Cloudflare quota khi hết là lỗi/giới hạn, không tự chuyển paid; app không có quota reservation.

---

## H. Production Blockers

### P0 — Không thể production
1. **Dynamic media upload chưa hoạt động**. Nếu AI cần tự đăng ảnh (thumbnail/OG/inline), đây là blocker tuyệt đối.
2. **100.000 bài không khả thi** trên Free nếu là yêu cầu cứng (500 MB/DB, 5 GB/account, 10 DB).

### P1 — Cần xử lý/phê duyệt trước phát hành
1. WAF/Access/BFM chưa kiểm chứng trên preproduction zone; BFM có thể chặn Publishing API.
2. CPU P95 low-traffic >7 ms; chưa có bằng chứng tải đại diện.
3. Backup/alert automation thủ công; chưa diễn tập restore production.
4. Production migration/cutover/rollback chưa diễn tập; revisions staging 0/70.
5. Media backup/restore chưa có.
7. External image URL (nếu không dynamic upload) vẫn có rủi ro mất ảnh/hotlink/bản quyền.

### P2 — Sau production
1. Revision/audit retention; DO queue/hibernation metrics; cache public.
2. Admin mobile table UX; screen-reader audit đầy đủ; dark contrast toàn bộ.
3. Load test theo colo, fuzz HTML/Markdown, AVIF.
4. Media lifecycle/archive, cost dashboard.

---

## I. Decisions Required

1. **Media provider**: R2 (khuyến nghị) / Backblaze B2 / không dynamic upload?
2. **Billing**: có cho phép bật R2 subscription/budget alert không? (Alert không phải hard cap.)
3. **Preproduction**: có cho phép tạo subdomain/zone test và WAF/Access chỉ trên đó không?
4. **Production resources**: có cho phép tạo D1/Worker production sau khi điều kiện đạt không?
5. **Production cutover**: có phê duyệt deploy/DNS/cutover riêng không?

Không có thay đổi production, DNS, WAF, R2/billing, Node app hoặc xóa staging nào trong M7.

---

## Release Gate

# **NO-GO**

Không phát hành production khi media upload cốt lõi chưa hoạt động và WAF/Access chưa kiểm chứng. Có thể chuyển sang **CONDITIONAL GO** sau khi:
1. Media provider + billing/no-upload decision được phê duyệt và implement/test;
2. Preproduction WAF/Access test PASS, API/SEO không bị chặn;
3. Migration/cutover/rollback được diễn tập trên bản copy;
4. Backup/alert automation hoàn tất.

**M7 RELEASE GATE ĐÃ HOÀN THÀNH — ĐANG CHỜ PHÊ DUYỆT MEDIA, PREPRODUCTION VÀ PRODUCTION.**
