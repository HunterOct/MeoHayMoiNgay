# FINAL BLOCKER REMEDIATION — REPORT

**Ngày:** 2026-10-25  
**Node app:** `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — không thay đổi.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — version `3d782585-b039-423f-861f-2ec7c7679db9`.  
**D1 migration test độc lập:** `meohay-m7-migration-1792944499` / `448322ca-8b5f-4adc-9cb1-a24690a75fad` (APAC, Free).  
**Cập nhật sau báo cáo:** người dùng đã chọn **Cloudflare Workers Static Assets**; xem `STATIC-ASSETS-MEDIA-REPORT.md`. Các so sánh R2/B2 bên dưới là lịch sử/quyết định trước đó.  
**Không thực hiện:** production deploy, DNS, WAF zone thật, R2/billing, Workers Paid, sửa Node app, xóa staging.

> **Kết quả:** migration parity và Publishing API đã được đóng. **Release decision vẫn NO-GO** vì dynamic media upload chưa hoạt động và WAF/Access chưa kiểm chứng trên zone thật.

---

## A. Blockers đã giải quyết

### A.1 Migration parity — PASS

Trước M7: staging có 0 revisions, author ID synthetic, chưa chứng minh import lặp lại an toàn.

Đã làm:
- Đối chiếu schema Node SQLite với D1 migrations 0001–0010.
- Tạo generator `scripts/m7-generate-import.py` đọc Node DB read-only, sinh SQL import:
  - Users giữ UUID; categories/tags/posts/post_tags/revisions/slug_history/audit/settings/API clients.
  - Posts thêm `version=1`, `change_id` random.
  - Revisions đầy đủ nội dung/timestamps/edited_by.
  - Settings upsert, giữ defaults của D1.
  - `INSERT OR IGNORE` để re-import không tạo trùng; rebuild FTS/counters.
- Tạo D1 cô lập, áp 10 migrations, import, rebuild, verify `scripts/m7-verify-isolated-migration.mjs`.
- Phát hiện lỗi thật: Python ghi SQL bằng Windows CRLF làm `\n` trong content thành `\r\n`, khiến hash lệch. Sửa generator ghi `newline="\n"`, re-import.
- Author mapping: import user UUID Node và giữ `posts.author_id`; 70/70 posts trỏ đúng user. Staging cũ dùng `user-m0-admin` chỉ là fixture gap, không phải lỗi schema.
- Password hash: DB cô lập dùng hash test (không đưa credential nguồn vào test); generator có `M7_PRESERVE_PASSWORD_HASH=1` cho production, không chạy trên staging.
- Idempotent re-import: chạy import lần 2, counts/hashes không đổi, không duplicate.
- Trigger test: insert published → counter 70→71, category 10→11; delete → 70/10.

Kết quả: **29/29 checks PASS** (`fixtures/m7-isolated-migration-verify.json`).

### A.2 ECONNRESET / M3 — PASS

Đã điều tra, không mặc định là lỗi mạng:
- Tail Worker trong lúc POST lớn: request 200.038 byte **đến Worker**, trả **400 validation_error**, `outcome=ok`, `exceptions=[]`; request bị reset **không xuất hiện** trong tail.
- Worker analytics 1 giờ: 57 request, **0 errors**, status success.
- External control: POST 180 KB tới httpbin 200; lỗi chỉ intermittent trên đường tới workers.dev.
- Retry cùng request: 2 lần 400, 1 lần ECONNRESET; sau đó M3 full PASS.
- M3 chạy lại **28/28 PASS** trên build hiện tại với **timeout gốc 30s**; không bỏ case nào, không đổi assertion. Retry transport được thêm để chịu mạng chập chờn; timeout không dùng để che lỗi.
- OCC/If-Match, stale 412, idempotency/external_id, media 501, content-over-limit 400 đều PASS.

Bằng chứng: `fixtures/m7-econnreset-evidence.json`.

### A.3 Media adapter — PASS local, remote BLOCKED

- 18/18 media policy/service tests.
- 14/14 adapter mock tests: read, upload, duplicate, storage failure, DB rollback, metadata, delete unused/used, disabled 501.
- Remote R2 **NOT VERIFIED** vì chưa bật billing/provider.

### A.4 Production config / migration runbook

- Production sample dry-run: 197 assets, 1.741,96 KiB (gzip 331,37 KiB), D1/DO/ASSETS bindings, no secrets, no R2, no deploy.
- Cutover/rollback/data mapping documented: `docs/DATA-MIGRATION-CUTOVER.md`.

---

## B. Migration Parity

| Dữ liệu | Node | D1 thử nghiệm | Kết quả |
|---|---:|---:|---|
| Posts | 70 | 70 | **PASS** (full content hash 70/70) |
| Published | 70 | 70 | **PASS** |
| Revisions | 70 | 70 | **PASS** (hash 70/70) |
| Authors | 1 | 1 | **PASS** (UUID giữ nguyên; 70/70 author_id) |
| Categories | 7 | 7 | **PASS** |
| Tags | 26 | 26 | **PASS** |
| Post_tags | 106 | 106 | **PASS** |
| Slug history | 0 | 0 | **PASS** |
| Settings | 1 key (`default_author_id`) | 9 (defaults + key) | **PASS** |
| API clients | 0 | 0 | **PASS** |
| Audit log | 2 | 2 | **PASS** |
| Media | 0 | 0 | **PASS** |
| Scheduled | 0 | 0 | **PASS** |
| FTS | 70 | 70 | **PASS** + search hit |
| Counters | 70 | 70 | **PASS** |
| version/change_id | n/a | 70/70 | **PASS** |
| Orphans | 0 | 0 | **PASS** |
| Triggers/migrations | n/a | 9 / 10 | **PASS** |

**Lưu ý:** đây là D1 **cô lập**, không phải staging chính; không import dữ liệu Node vào staging. Production migration phải chạy lại với D1 production và giữ password hash nguồn (`M7_PRESERVE_PASSWORD_HASH=1`), sau đó rotate/verify auth.

---

## C. Publishing API

- **M3: 28/28 PASS** trên build hiện tại, timeout 30s.
- OCC: stale 412, correct 200, parallel same-version one wins; M4 12/12, M5 26/26.
- Idempotency/external_id: replay 200, conflict 409, no duplicate revision; concurrent race cron/API PASS.
- Content >200.000 chars: 400 `validation_error`; media disabled: 501; no fake success.
- ECONNRESET: client/transport intermittent; Worker tail/analytics chứng minh request thành công và 0 Worker errors khi đến nơi. Không có duplicate do retry (idempotency test).
- CPU/memory: 0 `exceededCpu/Memory` ghi nhận trong test; CPU P95 low-traffic/cold vẫn >7ms (xem M6/M7 performance), chưa phải blocker API correctness nhưng là P1 capacity.
- D1 writes: migration import 530 changes/1.758 rows; không vượt quota.

### Final acceptance suite (build hiện tại)

| Bộ test | Kết quả |
|---|---|
| M1 public consistency | **42/42 PASS** |
| M2 Admin functional | **74/74 PASS** |
| M2.5 API client/settings/retention | **16/16 PASS** |
| M3 Publishing API | **28/28 PASS** (30s timeout) |
| M4 OCC | **12/12 PASS** |
| M5 bulk/OCC | **26/26 PASS** |
| Security | **17/17 PASS** |
| **Tổng chạy mới** | **215/215 PASS** |
| Media policy/service + adapter mock | **18/18 + 14/14 PASS** |
| Migration isolated | **29/29 PASS** |
| Backup/restore | **24/24 PASS** |
| SEO/UI/Lighthouse | M6 final (home 96/100/100/100, a11y 100); không rerun vì final remediation không đổi UI/SEO code |
| Cron/key rotation/media fallback | Cron trong M1/M3 PASS; key rotation trong M2/security PASS; media fallback PASS |

---

## D. Media Decision

### So sánh

| Phương án | Free | Billing | Public delivery | Rủi ro |
|---|---|---|---|---|
| **R2** | 10 GB, 1M A, 10M B, egress free | **Cần R2 subscription/billing** | R2.dev hoặc custom domain (zone) | Overage billed; **không có hard cap đã xác nhận**; budget alert chỉ thông báo |
| **B2** | 10 GB storage | Không cần thẻ để bắt đầu; overage/egress theo B2 | Public bucket hoặc private + Worker proxy | Cần adapter/secret; egress/terms; private proxy tốn Worker quota |
| **Không upload** | 0 | Không | Legacy/static + external HTTPS | AI/Admin không upload thumbnail/OG; external URL mất/hotlink/bản quyền |

### Capacity (ước tính, ảnh tối ưu 200 KB/ảnh)

| Bài/ngày | 1 ảnh: tháng tới 10GB | 3 ảnh: tháng tới 10GB |
|---:|---:|---:|
| 10 | ~166 tháng | ~66 tháng |
| 20 | ~83 tháng | ~33 tháng |
| 30 | ~55 tháng | ~22 tháng |
| 50 | ~33 tháng | ~13 tháng |

- 10 GB là **tổng lưu trữ**, không reset hàng tháng. 100 bài/ngày × 5 ảnh ≈ 28,8 GB/năm.
- R2 vượt 10 GB: storage **$0,015/GB-month**, Class A/B theo bảng giá; **không có hard spending cap xác nhận**.
- B2 public/private: tạo tài khoản free không cần thẻ **không đồng nghĩa** mọi chức năng public/egress miễn phí lâu dài; cần đọc pricing/terms hiện hành.
- Private bucket + Worker proxy làm tăng Worker requests/CPU/subrequests; không khuyến nghị nếu traffic ảnh lớn chưa có cache/quota test.

### Đề xuất

- **Chính:** R2 nếu được duyệt billing; public/custom domain; lifecycle/archive; giới hạn upload.
- **Dự phòng:** B2 nếu không muốn R2 billing; cần adapter + test public/private/egress.
- **Không upload:** chỉ chấp nhận nếu ảnh không phải yêu cầu cốt lõi. Với blog AI có ảnh, đây là **không đủ**.
- **Hoãn production** nếu chưa có provider: phương án an toàn nhất.

---

## E. Security & Infrastructure

| Hạng mục | Trạng thái |
|---|---|
| Auth/session/RBAC/IDOR/CSRF | **PASS** (M2 74/74, security 17/17) |
| API scopes/revocation/OCC/idempotency | **PASS** (M3 28/28, M4 12/12, M5 26/26) |
| Content sanitization/image URL | **PASS** (HTTP ảnh bị loại; HTTPS/internal) |
| Rate limit/login/search | **PASS app-level** |
| Backup/restore | **PASS 24/24** |
| WAF/Access/BFM | **NOT VERIFIED** (không zone) |
| Preproduction subdomain/WAF plan | **PLANNED** |
| Media remote R2/B2 | **BLOCKED / NOT VERIFIED** |
| Production migration/cutover | **NOT EXECUTED** (chỉ isolated test) |
| Alert/backup automation | **PARTIAL** (script/manual) |

**Monitoring 24h cuối:** 9.051 Worker requests, 0 errors; CPU P50 5,07 / P95 18,76 ms (cold/tests); D1 1,73M reads / 49,4k writes, 3,67 MB/DB; DO 4.960 requests, 0 exceeded, memory P95 40,3 MiB; cron heartbeat OK; health/SEO 200.

---

## F. Production Release Decision

# **NO-GO**

Lý do:
1. **Media upload động vẫn BLOCKED**; nếu AI/Admin cần ảnh, đây là P0.
2. **WAF/Access/BFM chưa kiểm chứng** trên zone thật; BFM có thể chặn Publishing API.
3. Backup/alert automation và migration/cutover/rollback production chưa diễn tập.
4. CPU P95 low-traffic chưa chứng minh ≤7 ms.

Đã giải quyết nên không còn là blocker:
- Migration revisions/author parity (29/29 isolated).
- M3 28/28 trên build hiện tại.
- Media adapter local 14/14 + policy 18/18.
- Backup/restore 24/24.

Có thể chuyển **CONDITIONAL GO** sau khi: media provider/billing hoặc quyết định không upload được phê duyệt; preproduction WAF/Access PASS; migration/cutover diễn tập; alert/backup tự động.

---

## G. Decisions Required

1. **Media provider**: R2 (khuyến nghị) / Backblaze B2 / không dynamic upload?
2. **Billing**: có cho phép bật R2 subscription + budget alert không? (alert không phải hard cap.)
3. **Limited release**: có chấp nhận bản không upload động không? (Nếu ảnh cốt lõi → không.)
4. **Preproduction**: có cho phép tạo subdomain/zone test và WAF/Access chỉ trên đó không?
5. **Production resources/cutover**: có cho phép tạo D1/Worker production và deploy/cutover sau khi điều kiện đạt không?

Không có thay đổi production, DNS, WAF, R2/billing, Node app hoặc xóa staging. D1 migration test cô lập được giữ lại để đối chiếu.

---

**FINAL BLOCKER REMEDIATION ĐÃ HOÀN THÀNH — ĐANG CHỜ QUYẾT ĐỊNH MEDIA VÀ PHÊ DUYỆT PRODUCTION.**
