# M4 — SECURITY HARDENING, ANTI-SCRAPING & DATA INTEGRITY

**Ngày:** 2026-10-25  
**App chính:** `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — không thay đổi.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — Worker version `4d29d83c-68ea-415f-b5b3-9797bd0f453b`.  
**Phạm vi:** M4 only; không M5–M6, không production/DNS/WAF zone/R2 billing/Workers Paid.

> Kết luận: đã bổ sung optimistic concurrency thật ở D1 (`version` + conditional update + change token), kết nối `If-Match`/ETag cho API và version cho Admin. Security/regression chính PASS. Media upload vẫn BLOCKED; DO memory/storage, WAF/Access và production cutover chưa kiểm chứng. Không tuyên bố production-ready.

---

## A. Security Audit

| Nhóm | Kết quả | Bằng chứng / ghi chú |
|---|---|---|
| Password hashing scrypt, không plaintext | **PASS** | Scrypt trong DO, N=16384,r=8,p=1; hash chỉ trong D1 |
| Login sai/đúng, dummy hash timing | **PASS** | Bad password test; dummy scrypt cho email không tồn tại |
| Session fixation | **PASS** | Login mới hủy token cũ; test 17/17 |
| Session expiry/revocation/logout | **PASS** | Expired session, disabled user, logout tests |
| Cookie flags | **PASS** | HttpOnly, Secure, SameSite=Lax, path=/ |
| Brute force/lockout | **PASS** | 8 lần sai khóa 15 phút; rate limit login 15/15m → 429 |
| Backend RBAC | **PASS** | Admin/editor/author; direct endpoint; 74/74 |
| IDOR/horizontal escalation | **PASS** | Author sửa bài người khác → 403 |
| API scope escalation/review bypass | **PASS** | Read-only create 403; review publish 403; auto mode |
| API key rotation/revocation | **PASS** | Old key 401 sau rotate; revoked key 401 ngay |
| Stored/reflected XSS | **PASS** | Sanitizer DO; script trong content bị lọc public/preview |
| SQL injection | **PASS (code audit)** | Toàn bộ query dùng prepared bindings; FTS terms làm sạch |
| SSRF | **MITIGATED** | Không fetch cover/media URL server-side; media upload 501 |
| Unsafe redirect | **MITIGATED** | `safeNext` chỉ `/admin`; redirect public cố định |
| Path traversal | **MITIGATED** | Không filesystem runtime; media qua binding |
| Malformed JSON / oversized body | **PASS** | JSON lỗi → 400; API body cap 1 MB; content contract 200k |
| HTML nesting/resource exhaustion | **PARTIAL** | Sanitizer + content cap; chưa fuzz sâu 200k/HTML lồng cực đại |
| CSRF | **PASS** | Missing/cross-origin 403; admin + login |
| CSP/HSTS/security headers | **PASS** | CSP nonce, HSTS staging, nosniff, referrer |
| Error information leakage | **MITIGATED** | 500 public generic; API generic; admin messages kiểm soát |
| Secrets in source/log/audit | **PASS** | Secrets local gitignored; audit không chứa API key/hash |
| Dependency vulnerabilities | **PASS** | `npm audit --omit=dev`: 0 vulnerabilities (prototype và Node app) |
| Session/login/idempotency cleanup | **PASS** | Cron cleanup batch 50; test fake rows |
| Audit/revision retention | **PARTIAL** | Preview policy; chưa xóa audit/revision staging khi chưa duyệt |
| CORS | **PASS (default)** | Không mở CORS; API dùng server-to-server Bearer |
| Admin dashboard cache | **PASS** | Cache key session id + role; no-store; không chia sẻ user |
| WAF/Access/Bot Fight Mode | **NOT VERIFIED / PLANNED** | Không có zone/custom domain; chưa cấu hình |

**Không có lỗ hổng CONFIRMED nghiêm trọng trong phạm vi đã kiểm thử.** Các mục WAF/zone và media vẫn ngoài bằng chứng.

---

## B. Data Integrity — Optimistic Concurrency

### Thiết kế

- Migration `0010_occ_version.sql`:
  - `posts.version INTEGER NOT NULL DEFAULT 1`
  - `posts.change_id TEXT NOT NULL DEFAULT ''` + backfill random.
- `updateAdminPost`:
  - Kiểm tra version hiện tại;
  - `UPDATE ... SET version=version+1, change_id=? WHERE id=? AND version=?`;
  - Mọi ghi phụ (FTS, post_tags, slug_history, revisions) có guard `EXISTS (post.id = ? AND change_id = ? AND version = ?)` trong cùng D1 batch.
  - Nếu conditional update 0 changes → `VERSION_CONFLICT`; guard token đảm bảo không ghi FTS/revision/tag.
- `softDelete`, `restore`, `publishDue` (Cron) đều bump version/change_id.
- API:
  - Trả `version` trong Post và `ETag: "vN"`.
  - Hỗ trợ `If-Match: "vN"` / `vN` / `*` cho PATCH, publish, schedule, unpublish, delete.
  - Stale → **412 `version_conflict`**, kèm `current_version` và hướng dẫn reload.
  - Không có `If-Match` → tương thích client cũ (legacy LWW); đây là chính sách chuyển tiếp, client mới nên gửi.
- Admin:
  - Editor form mang hidden `version`; lưu stale → trang cảnh báo “đã được thay đổi bởi phiên khác”, tải bản mới.
  - Delete/restore form mang version; bulk chưa mang version (xem Outstanding).
  - Revision restore xử lý conflict.

### Kiểm thử (`scripts/m4-occ-test.mjs`): **12/12 PASS**

- Admin + AI sửa cùng bài: AI thắng, Admin stale bị chặn, nội dung AI không bị ghi đè.
- Hai API request cùng version: một 200, một 412.
- Stale update/publish/delete bị 412.
- Idempotent PATCH replay không tạo revision thừa.
- Cron publish bump version; cập nhật sau đó dùng version mới.
- Revision restore conflict được xử lý.

**Giới hạn:** If-Match là opt-in cho API cũ; bulk Admin chưa gửi version; purge không cần version. Không dùng `updated_at` làm khóa.

---

## C. API / Admin Security

- API auth chỉ chấp nhận Bearer; không nhận key trong query; revoked/inactive 401.
- Scopes kiểm tra server-side; review mode demote; auto mode bắt buộc publish/schedule.
- Content sanitize trong DO; body cap 1 MB; contract content max 200k; rate client/IP.
- Worker → content DO theo `content:<client_id>`; DO không có endpoint public; client ID lấy từ API key đã xác thực, không từ body.
- DO không lưu plaintext credentials; audit không chứa key/hash.
- Idempotency/external_id unique; duplicate publish bị chặn bởi version/CAS.
- Admin login/CSRF/RBAC/session/IDOR tests PASS; dashboard cache không rò giữa user.
- Admin pages `no-store`, noindex; error 500 generic.
- Dependency audit 0.

---

## D. Anti-Scraping Strategy

### Application-level đã triển khai

- API key + scopes + per-client/IP rate (DO).
- Login rate + lockout; CSRF.
- Search endpoint rate **30/phút/IP** qua DO:
  - Test: request 31 → **429**, `Retry-After`; Googlebot UA → 200.
- Public HTML rate 120/phút/IP và feed 60/phút/IP bằng limiter in-isolate (best effort, không global).
- AI crawler block theo setting `allow_ai_crawlers`; robots.txt đồng bộ.
- Không chặn Googlebot/Bingbot; không challenge sitemap/RSS/robots.
- Không dùng UA làm xác thực duy nhất; UA spoof vẫn có thể qua limiter — cần WAF verified bot.
- Không dùng chuột phải/DevTools/copy; không cloaking.

### Cloudflare layer — chỉ kế hoạch, chưa áp dụng

| Rule dự kiến | Điều kiện | Action | Free? | False-positive/SEO |
|---|---|---|---|---|
| Login rate | `/admin/login` IP >15/15m | Block/Managed Challenge | Rate rule Free (1) | Có thể ảnh hưởng NAT văn phòng; rollback tắt rule |
| API rate | `/api/v1/*` IP >300/min | Block | Rate rule Free | Không dùng nếu nhiều client chung IP; ưu tiên rate API/DO hiện có |
| Search burst | `/tim-kiem` IP >30/min | Block | Rate rule Free | Search noindex; không ảnh hưởng sitemap/RSS |
| Suspicious paths | `/wp-admin`, `/.env`, `/.git` | Block | Custom rule Free | Rủi ro thấp; kiểm tra 404 thật |
| Media hotlink | `/media/*` referer ngoài | Block | Custom rule Free | Chỉ khi R2 bật; có thể chặn chia sẻ hợp lệ |

- **Không áp dụng rule nào** vì chưa có zone/custom domain; `workers.dev` không dùng WAF zone.
- **Bot Fight Mode**: Free không cho Skip rule; có thể challenge Publishing API/client hợp lệ; không khuyến nghị bật toàn domain. Nếu dùng, tách API custom domain hoặc kiểm thử kỹ.
- **Access Free**: cần Zero Trust/payment details dù Free; chưa bật; chỉ lập kế hoạch bảo vệ `/admin` bằng Access khi có custom domain.
- **Turnstile**: không cần cho public read; có thể cân nhắc login nếu abuse, cần phê duyệt/tích hợp riêng.
- DDoS: Cloudflare automatic; chưa test trên workers.dev.
- Verified Bot: cần WAF/zone; UA-only hiện tại là xấp xỉ.

---

## E. Media Security

- Media upload vẫn **501/BLOCKED**; không R2/provider mới.
- `cover_image`/`og_image` qua schema URL: chỉ `/` nội bộ hoặc http(s); chặn `javascript:`, `data:`; không fetch server-side → không SSRF từ URL.
- Ảnh trong content được sanitizer giữ `src` http(s)/`/`, thêm `referrerpolicy=no-referrer`, `loading=lazy`.
- Không có media metadata endpoint hoạt động; `cover_media_id` trả 501.
- Legacy ảnh trong Static Assets.
- Khi bật R2/external sau này: cần host allowlist, size/MIME sniff, rate upload, quota, hotlink policy, lifecycle.

---

## F. Cloudflare Free Compatibility

### DO metrics thực tế (GraphQL `durableObjectsInvocationsAdaptiveGroups` + `durableObjectsPeriodicGroups`)

Namespace `8cae45d07268482fb139461ca231d96c`; `cpuTime` theo đơn vị microsecond của GraphQL:

| Object | Requests | CPU total (µs) | CPU/request |
|---|---:|---:|---:|
| `f69081…` (content candidate) | 106 | 8.925.376 | **84.2 ms** |
| `4548…` | 79 | 854.289 | 10.8 ms |
| `30db…` | 88 | 350.839 | 4.0 ms |
| `aa55…` (rate) | 880 | 545.999 | 0.62 ms |
| `0e1b…` | 4 | 60.193 | 15.0 ms |

- Content DO CPU ~84 ms/request vẫn **rất xa 30 s/invocation**, nhưng cần theo dõi khi payload lớn/concurrency.
- DO requests 1.157 trong ngày test; giới hạn Free 100k/ngày.
- DO memory, storage ops, hibernation, queueing: **NOT VERIFIED** (không có số liệu trong scope).
- DO Free 13k GB-s/day; 500 bài/ngày với nội dung lớn vẫn dưới ngưỡng lý thuyết, nhưng cần monitoring.

### Worker / D1

- Worker API create warm 4–5 ms; list P50 4.83 ms; cold outliers 9–22 ms.
- Admin dashboard warm 2.3–4.9 ms; cold 11–14 ms.
- D1: 1.62 MB; 24h test: ~1.01M reads / 39.6k writes — dưới 5M/100k nhưng do test.
- Không có `exceededCpu`/`exceededMemory` trong các phase.

### Capacity ước tính

- 10/50/100/500 bài AI/ngày: Worker ~1, DO ~3–4, D1 writes ~10–20/bài; 500 bài/ngày ~2k DO requests, ~10k writes — an toàn quota.
- Public traffic 1M pageview/tháng ~33k Worker/day + D1 reads; vẫn dưới 100k/5M.
- Rủi ro chính: cold-start P95, DO CPU/memory khi 500 bài/ngày đồng thời, WAF chưa có.

---

## G. Regression Results

| Bộ test | Kết quả |
|---|---|
| M1 public consistency | **42/42 PASS** |
| M2 functional | **74/74 PASS** |
| M2 security (M2.5) | **17/17 PASS** |
| M2.5 API client/settings/cleanup | **16/16 PASS** |
| M4 OCC | **12/12 PASS** |
| M3 Publishing API | **28/28 PASS** |
| Search rate test | 31st request 429; Googlebot 200 |
| Dependency audit | 0 vulnerabilities |
| Public UI/SEO | Không thay đổi; ảnh/screenshot cũ còn hiệu lực |

---

## H. Outstanding

| Mức | Hạng mục |
|---|---|
| **BLOCKED** | Media upload/R2; media parity. |
| **PARTIAL** | If-Match opt-in; API client cũ vẫn LWW; bulk Admin không gửi version; purge không OCC. |
| **PARTIAL** | Public HTML rate limiter in-isolate, không global; UA spoof có thể qua; WAF/zone chưa áp dụng. |
| **PARTIAL** | Cold-start P95 >7 ms (API list 21.56 ms, admin dashboard 11.94 ms) dù warm ổn định. |
| **NOT VERIFIED** | DO memory/storage/hibernation/concurrency; WAF/Access/Bot Fight Mode; Turnstile; external storage; 100k scale; backup/restore. |
| **PASS** | OCC versioning, auth/RBAC/CSRF/session, XSS/SQLi/SSRF mitigations, API client lifecycle, public/admin/API regression. |

---

## I. M5 Readiness

**Chưa production-ready.** M5 có thể bắt đầu sau khi:

1. Chốt media storage (R2 có billing + guard hoặc provider được duyệt) — hiện BLOCKED.
2. Có custom domain/zone để kiểm chứng WAF, rate rules, Bot Fight Mode, Access, DDoS.
3. Có quyết định cold-start policy/cache và DO memory monitoring.
4. Bổ sung version precondition cho bulk Admin và yêu cầu If-Match ở client AI mới.
5. Backup/restore, monitoring, rollback, cutover plan.

Các blocker phải nêu rõ: **media upload/R2, DO memory metrics, cold-start CPU, WAF/Access chưa áp dụng, edge cache, quota traffic cao.**

---

## Trạng thái kết thúc

**M4 ĐÃ HOÀN THÀNH TRONG PHẠM VI ĐƯỢC PHÉP — ĐANG CHỜ PHÊ DUYỆT M5.**

Các mục chưa đạt/chưa kiểm chứng được ghi rõ; không tuyên bố production-ready.
