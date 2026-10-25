# M0 — Feasibility Spike Report (Cloudflare Free)

**Ngày:** 2026-10-24  
**Phạm vi:** Chỉ prototype local trong `D:\Github\MeoHayMoiNgay-m0`, tách khỏi app chính.  
**Không thực hiện:** deploy, tạo tài khoản Cloudflare, billing, DNS, migration DB thật, sửa app chính.  
**App chính:** vẫn ở commit `f26d45d`, `git status` sạch.

## 1. Kết luận điều hành

- Runtime Workers/Hono tương thích với template/CSS hiện tại; bundle 1.330,63 KiB (254,83 KiB gzip).
- SSR ấm đo local: render **0,4–3 ms**; D1 local article **4–15 ms**; trang động article **17,7–22,8 ms p50**.
- D1 FTS5, batch atomic, migration, idempotency hoạt động local với **100.086 bài**.
- DO Free chạy được scrypt/PBKDF2/sanitize/rate-limit; scrypt ~100 ms, PBKDF2 600k ~327 ms → **bắt buộc offload khỏi Worker 10 ms**.
- Auth/session/CSRF/RBAC/API key/sanitize XSS/rate-limit đều chạy local.
- Cron + D1 batch publish đúng, chống race; 20 bài/lần ~17–22 ms.
- Static Assets phục vụ file `.html` clean URL **không redirect**, không gọi Worker; `.html` file được ưu tiên hơn thư mục `index.html`.
- **Chưa thể PASS toàn phần** vì chưa có quyền Cloudflare account/staging: CPU 10 ms, quota D1/DO/R2, static assets production, WAF/Bot/Access, R2 billing đều **NOT VERIFIED**.
- Khuyến nghị: chạy **M0.5 remote staging** trước M1; nếu không, chỉ triển khai M1 dưới điều kiện chấp nhận rủi ro CPU/quota và kiểm chứng sau.

## 2. Môi trường prototype

| Thành phần | Giá trị |
|---|---|
| Thư mục | `D:\Github\MeoHayMoiNgay-m0` (ngoài repo chính) |
| Runtime local | `wrangler dev --local` 4.152.0, workerd, port 8787 |
| Bundle | 1.330,63 KiB; gzip 254,83 KiB; memory limit lý thuyết 128 MB |
| D1 local | 100.086 posts (70 thật + 3 scheduled + test + 100k synthetic), 100.076 FTS rows |
| R2 local | ảnh PNG/JPEG upload, serve, hotlink |
| DO | 1 class `SecureOps` (SQLite) cho auth, sanitize, rate-limit |
| Static assets | 135 file: 61 ảnh legacy + 70 HTML `.html` + CSS/JS |
| DB thật | Chỉ đọc, export fixture; không ghi |

## 3. Giới hạn Cloudflare đã xác minh bằng tài liệu

| Dịch vụ | Free | Trạng thái |
|---|---|---|
| Workers | 100k request/ngày; 10 ms CPU/request; 128 MB; 100 MB body; 6 kết nối; 5 cron | Verified docs |
| Workers Static Assets | 20.000 file/version; 25 MiB/file; **request miễn phí, không giới hạn** | Verified docs + local |
| D1 | 5M row read/ngày; 100k row write/ngày; 5 GB tổng; 10 DB; 10 GB/DB; 6 kết nối; query 30 s; FTS5 | Verified docs; FTS5/batch local |
| Durable Objects | 100k request/ngày; 13k GB-s/ngày; 5 GB/account; 1 GB/object; chỉ SQLite; CPU 30 s/invocation; 5M read/100k write/ngày | Verified docs; local runtime |
| R2 | 10 GB-month; 1M Class A; 10M Class B; egress free; **cần billing/subscription**; vượt bị tính tiền | Verified docs; local only |
| Workers Cache | Cache hit không chạy Worker/CPU nhưng **vẫn tính request**; bật cache có thể làm static asset bị tính | Docs; không bật |
| WAF | 1 rate rule IP + 5 custom rule; Bot Fight Mode | Docs only |
| Access | Free 50 user; cần Zero Trust + payment details | Docs only |
| Queues | 10k operation/ngày | Docs only; không dùng |
| Workers Builds | 3.000 phút/tháng; 1 concurrent; build tối đa 20 phút | Docs |
| Pages | 500 build/tháng; 20k file | Docs; không dùng |
| Images | 5k transformation/tháng; storage/delivery trả phí | Docs; tránh |
| D1 Time Travel | 7 ngày Free | Docs |
| Workers Logs | 200k event/ngày; giữ 3 ngày | Docs |

## 4. M0 Test Results

| Hạng mục | Kết quả | Bằng chứng | Rủi ro |
|---|---|---|---|
| Workers runtime + SSR | **PASS (local)** | Bundle build; `/dyn/bai-viet/...` 200; HTML 18–19 KB; render 0,4–3 ms ấm; cold 22–40 ms wall | CPU production chưa đo |
| CPU limit 10 ms | **NOT VERIFIED (remote)** | Render local thấp; sanitize Worker 63 KB p95 8 ms; hash scrypt 100 ms | Cold/JIT, route admin/API, production isolate |
| Memory/bundle | **PARTIAL** | Bundle 1,33 MB / 255 KB gzip; memory limit 128 MB | Chưa đo RAM runtime production |
| D1/FTS5 | **PASS (local + docs)** | 100k posts; `MATCH "wifi"*`; schema migration; FTS query 5 ms local | Remote D1 version/quota |
| D1 batch/transactions | **PASS (local)** | Batch 2 insert, duplicate slug → rollback; first row absent | Không có interactive transaction; cần batch |
| D1 concurrency | **PASS (local)** | 50 concurrent reads, 50/50 OK, 205 ms | 6 kết nối production; tải thật chưa test |
| D1 quota/storage | **NOT VERIFIED (remote)** | 5M read/100k write/5 GB docs; local 100k synthetic 217 MB; real ~2,8 GB ước tính | 100k bài + revisions gần 5 GB |
| Authentication | **PASS (local)** | Scrypt hash hiện tại verify được; DO 91–114 ms; PBKDF2 327 ms; WebCrypto scrypt unsupported | DO CPU/quota remote |
| Session/CSRF/RBAC | **PASS (local)** | Cookie HttpOnly/SameSite; CSRF 403/200; author/editor RBAC đúng | Production cần Secure cookie, lockout |
| API key | **PASS (local)** | Hash SHA-256; invalid 401; scopes; 11th request 429 | Remote DO/limit |
| Sanitization | **PASS (local)** | 10 XSS vector; script/onerror/javascript/iframe/svg/data URI bị loại | Worker p95 8 ms; offload DO |
| Publishing API | **PASS (local)** | Create/update/publish/review/idempotency/external_id/schedule/validation | Remote quota + idempotency race |
| Media/R2 | **PARTIAL** | R2 local upload/serve; PNG 1×1; JPEG 980×735; hotlink 403 | Remote R2 + billing NOT VERIFIED |
| Static Assets | **PASS (local)** | `.html` clean URL 200, no redirect, no Worker header; 71 pages | 20k file cap; remote caching |
| Scheduling | **PASS (local)** | Cron trigger; 20/run batch; 100 backlog; race second run selected 0; 17–22 ms | Remote cron 10 ms CPU; delay 1 phút |
| SEO/UI | **PASS (local)** | Canonical/OG/JSON-LD; screenshot CSS; static/dynamic 200 | M1 cần port đầy đủ nav/sidebar |
| Free Tier | **NOT VERIFIED (remote)** | Chưa có account/staging; docs + local | Không thể tuyên bố production-ready |
| WAF/Bot/Access | **NOT VERIFIED (remote)** | Docs only; no zone | Chưa kiểm chứng chặn bot/SEO |
| Workers Cache | **NOT VERIFIED** | Không bật; docs nói request vẫn tính | Không dùng để tiết kiệm quota |
| Queues | **NOT USED** | Cron+D1 đủ; Queues 10k ops/day | Không cần |

## 5. Chi tiết thực nghiệm

### 5.1 SSR benchmark (local workerd, 100k posts DB)

| Route | p50 | p95 | Worker | Ghi chú |
|---|---:|---:|---|---|
| Static article | 10,8 ms | 16,9 ms | Không | `.html` asset |
| Static home | 10,2 ms | 12,8 ms | Không | `.html` asset |
| Dynamic article (70 bài) | 22,8 ms | 35,1 ms | Có | DB 9 ms, render 2 ms |
| Dynamic home (70 bài) | 22,2 ms | 32,1 ms | Có | DB 11 ms, render 2 ms |
| Dynamic article (100k) | 17,7 ms | 19,6 ms | Có | DB 8 ms, render 1 ms |
| Search FTS có rank (100k, “scale”) | 315,5 ms | 370,3 ms | Có | 100k matches; không dùng |
| Search FTS không rank, LIMIT 8 | 14,3 ms | 16,5 ms | Có | Nhanh nhưng mất relevance |
| Search FTS candidate 200 + bm25 | 25,5 ms | 29,9 ms | Có | Cân bằng |
| Search specific | 37,6 ms | 49,3 ms | Có | FTS + join |
| Category count cached | 11,8 ms | 13,7 ms | Có | Không scan 100k |
| Home cached counts | 13,5 ms | 17,6 ms | Có | 16 posts + 7 categories |
| Home uncached counts | 250–495 ms | — | Có | Scan 100k rows; **không dùng** |

**Kết luận:** render CPU không phải nút thắt; D1 query/row scan là nút thắt. Phải precompute category counts, cap FTS candidates, thêm index, và tránh query related dạng `CASE` toàn bảng. Cold request có thể 40 ms wall; production CPU chưa đo.

### 5.2 D1 và dữ liệu

- Migration 0001 + 0002 + 0003 áp dụng local thành công; FTS5 hoạt động.
- Seed 70 bài thật + 3 scheduled + test; sau đó 100k synthetic.
- Batch atomic: insert hợp lệ + insert trùng slug → toàn bộ rollback (`atomic: true`).
- 50 request đọc đồng thời: 50/50 thành công, 205 ms local.
- Query plans:
  - Home dùng `idx_posts_status_pub`; nên thêm `(status,published_at,id)`.
  - Category dùng `idx_posts_category`; nên thêm `(category_id,status,published_at)`.
  - Related query cũ dùng `idx_posts_scheduled` + temp B-tree, quét 100k; đổi sang 2 query (same category + fill) giảm article DB từ 123 ms cold xuống 8–15 ms.
- Storage: DB 70 bài = 1,998,848 bytes; content HTML/source mỗi loại 178.073 ký tự (~2.544/post). Nếu 100k bài với revision/FTS/index, ước tính **2,5–3 GB**; nếu giữ nhiều revision có thể vượt 5 GB. Cần prune revision/audit.
- Local 100k synthetic (nội dung nhỏ) = 217 MB, không đại diện nội dung thật.

### 5.3 Auth/security

- Scrypt hash hiện tại (N=16384,r=8,p=1) verify đúng bằng `@noble/hashes` trong DO.
- WebCrypto: PBKDF2 được hỗ trợ; **scrypt không được hỗ trợ**.
- Thời gian local:
  - scrypt hash/verify: ~100–114 ms (Worker và DO).
  - PBKDF2 600k: ~327–334 ms.
  - Sanitize warm: 1 ms (nhỏ), 5 ms (63 KB), p95 6–8 ms; DO tương đương.
- Kết luận: scrypt/PBKDF2 **không thể chạy trong Worker 10 ms**; DO 30 s là bắt buộc nếu giữ mật khẩu hiện tại. Access là phương án thay thế nếu không muốn DO.
- Session D1, CSRF token, RBAC author/editor/admin đều pass local. Cookie local: HttpOnly, SameSite=Lax, Max-Age; production phải Secure.
- Login rate 15/15 phút bằng DO; API rate 10/phút client thấp → request 11 trả 429 và Retry-After 60.
- 10 XSS vector (script, onerror, javascript:, iframe, svg, math, data image, style, form, protocol-relative) đều bị loại.

### 5.4 API

- Create auto published: 201, status published, sanitize DO 7 ms, total 43 ms.
- External ID replay: 200, cùng ID, `external_id_replayed`.
- Idempotency: replay 201 cùng body + `Idempotent-Replayed`; payload khác → 409 `idempotency_conflict`.
- Review mode: published → review, `publish_demoted`; gọi publish endpoint → 403 `publish_mode_review`.
- Schedule: 201 scheduled; past date → 400; cron publish → published.
- Validation: 400 `validation_error`; invalid image 400; missing/invalid key 401.
- Rate: low client 10 → 11th 429.
- New post URL fallback: static chưa có → Worker SSR 200; static home vẫn stale (không chứa bài mới). **Đây là tradeoff SSG cần giải quyết.**

### 5.5 Media / Static Assets

- R2 local: PNG 1×1 (68 B) và JPEG 980×735 (112 KB) upload thành công; serve 200, `Cache-Control: public, max-age=2592000, immutable`, `nosniff`.
- Hotlink: no referer 200; referer evil 403; same-site 200; Google 200.
- R2 remote/billing: **NOT VERIFIED**; tài liệu nói cần subscription/billing profile, vượt free bị tính tiền. Không tự kích hoạt.
- Static Assets: 61 ảnh + CSS/JS + 70 HTML = 135 file; `/assets/...` không có header `X-M0-Worker`; `CF-Cache-Status: HIT`.
- SSG `.html` clean URL: `/bai-viet/<slug>` 200, không redirect, không Worker. Nếu dùng `<slug>/index.html` thì bị 307 → phải dùng file `.html`.
- 10k SSG local: 13,0 giây, 173,8 MB, 1,3 ms/trang (chỉ render+write; chưa upload/deploy). 100k trang vượt giới hạn **20k file** của Free.
- Static assets requests free/unlimited (docs); không bật Workers Cache vì có thể làm static asset bị tính request.

### 5.6 Scheduling

- Cron trigger local: 3 bài scheduled → published; 20 bài/lần ~17–22 ms; 100 bài cần 5 lần cron (20/lần).
- Race: hai lần chạy đồng thời, lần 1 publish 10, lần 2 selected 0; không double.
- Delay: cron tối thiểu 1 phút; backlog 100 bài ~5 phút.
- Cron Free CPU 10 ms: local wall thấp nhưng CPU production **NOT VERIFIED**; nên giữ batch 20–50 và đo remote.
- Retry: conditional `UPDATE ... WHERE status='scheduled'` cho phép chạy lại an toàn; lỗi giữa batch cần audit/retry (M1).

## 6. So sánh Rendering A/B/C

| Tiêu chí | A. SSR + cache | B. SSG + dynamic admin/API | C. Hybrid |
|---|---|---|---|
| Worker request | Mỗi pageview (cache hit vẫn tính request) | Public static free/unlimited | Chỉ dynamic (home/search/admin/API/new pages) |
| CPU | Render 0,4–3 ms ấm; cold 22–40 ms wall | ~0 | Thấp |
| D1 query | Mỗi pageview (cần query tối ưu) | 0 cho bài static | Thấp |
| Cập nhật tức thì | Có | Không (build/deploy) | Có cho new URL; home/static có thể trễ |
| Build/deploy | Không | Mỗi publish/batch; Workers Builds 3k phút/tháng, Pages 500 build | Ít hơn B; vẫn cần rebuild top pages |
| SEO | Tốt | Tốt | Tốt |
| UI | Giữ | Giữ | Giữ |
| File limit | Không bị (chỉ assets) | 20k file Free → tối đa ~10–20k bài | Static top ≤20k; phần còn lại SSR |
| 1k bài/10k PV | Rất thoải mái | Tốt | Tốt |
| 10k bài/100k PV | Thoải mái | Tốt (10k HTML <20k file) | Tốt |
| 100k bài/1M PV | **Khả thi** nếu query tối ưu; ~33k request/ngày | **Không khả thi** do 20k file | Khả thi nếu chỉ static top; phức tạp |
| $0 | Trong quota nếu <100k req/ngày | Trong quota; build hạn chế | Trong quota; vận hành phức tạp |
| Rủi ro | Worker request cap, D1 reads, CPU production | Build limit, file cap, stale content | Complexity, build + fallback |
| Kết luận | **Chọn cho launch** | Tốt cho ≤10k bài, traffic cao | P2 nếu traffic >100k/ngày |

**Quyết định dựa trên số liệu:** chọn **A — SSR + tối ưu query + static assets cho CSS/JS/ảnh**, không dựa vào cache để tiết kiệm quota. Lý do:
- Render ấm 0,4–3 ms; 1M pageview/tháng = ~33k request/ngày, dưới 100k.
- Hỗ trợ 100k bài; B không thể vì 20k file; C chỉ static một phần.
- Cập nhật AI tức thì, không build/deploy.
- Có thể bổ sung C (static top 10k trang) ở P2 nếu traffic tăng; new post vẫn fallback Worker.

## 7. Đánh giá Durable Objects (chống overengineering)

| DO đề xuất | Cần? | Thay thế đơn giản | Chi phí/rủi ro | Quyết định |
|---|---|---|---|---|
| AuthDO | **Có** | Access (đổi UX, 50 user) hoặc PBKDF2/ scrypt trong Worker (vượt 10 ms) | 100 ms/verify; 1 DO request; CPU 30 s | Giữ, gộp vào `SecureOps` |
| SanitizeDO | **Có (khuyến nghị)** | Worker sanitize warm 1–5 ms; có thể vừa 10 ms nếu route nhẹ, nhưng API+JSON+DB dễ vượt | 1 DO request/lần ghi; ~5 ms | Gộp cùng `SecureOps` |
| RateLimitDO | **Có nếu cần per-key** | WAF 1 rule IP + D1 minute buckets (tốn writes) | 1 DO request/API call; SQL row write | Gộp `SecureOps`, dùng cho API/login |
| SchedulerDO | **Không** | Cron Worker + D1 batch đã pass, race-safe | Không cần thêm DO | **Bỏ** |
| ViewCounterDO | **Không** | Bỏ view chính xác hoặc Web Analytics/batch; tránh 1 DO request/view | 100k DO req + writes | **Bỏ** |
| Tổng | **1 class, 1–3 instance** | — | Ít thành phần | **Không dùng 5 DO** |

## 8. Kiến trúc khuyến nghị cuối cùng

```
Cloudflare DNS/SSL/WAF/Bot Fight
        │
        ├── /assets/*, ảnh legacy ──► Workers Static Assets (free/unlimited)
        ├── /media/* ──► R2 custom domain + WAF hotlink
        └── Worker (Hono)
              ├── SSR public: home/article/category/tag/search (D1, query tối ưu)
              ├── Admin CMS
              ├── /api/v1 (bearer key, scopes, idempotency)
              ├── Cron 1 phút ──► D1 batch publish
              └── SecureOps DO (scrypt, sanitize, rate-limit)
```

- **Rendering:** SSR A; no Workers Cache; static assets only for CSS/JS/legacy images.
- **DB:** D1; precomputed category counts; composite indexes; capped FTS; two-query related; no per-view writes (drop/batch).
- **Auth:** giữ email/password UI; scrypt in DO; D1 sessions; CSRF; RBAC. Access optional, not required.
- **API:** Hono; DO rate; Cron+D1 scheduler; OpenAPI unchanged.
- **Media:** R2; app/WAF hotlink; static legacy images; no Cloudflare Images.
- **SEO:** same URLs/meta/JSON-LD; sitemap/RSS dynamic with cache; 301/410.
- **Anti-scraping:** robots + WAF 1 rate rule + 5 custom + Bot Fight + IP-range verified bots; no reverse DNS on Workers.
- **Ops:** D1 Time Travel 7d + R2 export; Workers Logs 3d; Web Analytics; budget alerts; backups.
- **Deploy:** Wrangler/CI; no Docker; no Pages; no Workers Paid.

### Khi nào chuyển sang Hybrid/Paid
- Nếu traffic >100k Worker request/ngày (~3M pageview/tháng) → static top 10k trang hoặc Workers Paid $5.
- Nếu CPU production vượt 10 ms thường xuyên → Workers Paid $5 hoặc Hybrid Node+CDN.
- Nếu R2 media >10 GB/10M Class B → nén ảnh, static hóa ảnh legacy, hoặc Paid.
- Nếu cần 100k bài static → không dùng Static Assets; SSR hoặc R2 HTML+Worker.

## 9. Thay đổi so với kế hoạch cũ

1. **Bỏ SchedulerDO**: Cron+D1 pass, race-safe.
2. **Bỏ ViewCounterDO**: tránh 1 DO request/write mỗi pageview; dùng Web Analytics hoặc bỏ view.
3. **Gộp 3 DO thành 1 class `SecureOps`** (auth/sanitize/rate), giảm overengineering.
4. **Không bật Workers Cache**: cache hit vẫn tính request; có thể làm static assets bị tính; không giúp quota.
5. **Không chọn SSG toàn bộ**: 20k file cap Free; 100k bài không thể. SSR A cho launch; static top trang là P2.
6. **Search phải cap candidate** (200) hoặc bỏ rank; rank toàn bộ 100k match ~315 ms local và 100k row reads.
7. **Category counts phải precompute**: correlated COUNT quét 100k row/home; 250–495 ms local.
8. **Related query phải tách 2 query**: query CASE cũ quét 100k; article cold 123 ms.
9. **Static clean URL dùng `.html`**, không dùng `slug/index.html` (307 redirect).
10. **Auth giữ scrypt trong DO**, không hạ tham số; Access là fallback tùy chọn.
11. **R2 cần billing profile**, không mặc định $0 tuyệt đối; cần budget alert/giới hạn.
12. **Không dùng Pages 500 build/tháng**; nếu static dùng Workers Builds 3k phút/tháng hoặc CI.
13. **Bot verification**: bỏ reverse DNS; dùng WAF/Bot Fight + IP ranges; chưa test remote.

## 10. Code & thử nghiệm

Prototype (ngoài repo chính): `D:\Github\MeoHayMoiNgay-m0`

| File | Vai trò |
|---|---|
| `src/index.js` | Hono Worker: SSR, auth, API, media, cron, benchmarks |
| `src/render.js` | Template article/home dùng CSS hiện tại |
| `src/db.js` | D1 queries, FTS, batch, idempotency, sessions |
| `src/auth.js` | scrypt/pbkdf2/sha256/session helpers |
| `src/sanitize.js` | sanitize-html + marked |
| `src/do.js` | SecureOps DO (SQLite rate, scrypt, sanitize, pbkdf2) |
| `src/image-size.js` | đọc dimension ảnh bằng DataView |
| `migrations/*.sql` | schema, cached counts, indexes |
| `scripts/*` | export fixture, seed SQL, extra users, SSG, benchmark |
| `fixtures/bench-results-optimized.json` | kết quả benchmark |
| `screenshots/*` | ảnh chụp static home/article |

Lệnh chính đã chạy:
```bash
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --file=fixtures/seed.sql
npx wrangler d1 execute DB --local --file=fixtures/scale-10k.sql
npx wrangler d1 execute DB --local --file=fixtures/scale-100k.sql
npx wrangler dev --local --port 8787
node scripts/bench-client.mjs
node scripts/generate-ssg.mjs
node scripts/bench-ssg-10k.mjs
```

Xác nhận:
- App chính không bị sửa; `git status` sạch; commit `f26d45d`.
- Không login/deploy/Cloudflare account/billing/DNS.
- DB thật chỉ đọc; fixture copy.
- Test credentials chỉ nằm trong spike, không nằm trong repo chính.

## 11. M1–M6 cập nhật

| Milestone | Nội dung | Điều kiện nghiệm thu | Free |
|---|---|---|---|
| **M0.5 (mới, P0)** Remote staging | Xin quyền account/token; deploy prototype tối thiểu lên workers.dev; đo CPU 10 ms, D1 quota, DO, static assets, cron; R2 chỉ khi được duyệt billing | Metrics CPU/quota thật; không deploy production/DNS | Có điều kiện |
| **M1 (P0)** Public SSR | Hono routes; D1 schema/migrations; import 70; template/CSS hiện tại; precomputed counts; composite indexes; capped search; two-query related; static assets CSS/JS/ảnh; SEO/feeds | Tất cả URL 200/301/404/410; SEO parity; 70 bài; test port; Lighthouse; CPU remote <10 ms nếu M0.5 pass | Có |
| **M2 (P0)** Auth/Admin | SecureOps DO scrypt; D1 session/CSRF/RBAC; CMS posts/media/revisions/trash/audit; R2 upload; preview; giữ UI | Login/RBAC/CSRF/media/revision/trash pass; không plaintext secret | Có; R2 billing |
| **M3 (P0)** API/Scheduler | Port API; scopes; idempotency/external_id; DO rate; Cron+D1; OpenAPI | 21 API scenario; race; schedule; 429; replay | Có |
| **M4 (P1)** Security/edge | WAF 1 rate + 5 custom; Bot Fight; IP ranges; hotlink; headers; audit throttle; Access optional | Googlebot/Bingbot OK; scraper/AI blocked; hotlink; audit | Có; remote test |
| **M5 (P1)** Ops/deploy | Wrangler env; D1/R2/DO; DNS/SSL; backup Time Travel/export R2; Logs/Web Analytics; alerts; rollback Node | Staging/prod; smoke; restore drill; budget alert; rollback | Có trong quota |
| **M6 (P2)** Perf/UI | Static top pages nếu traffic cao; image srcset/pre-optimize; self-host font; TOC/mobile; admin UX | CWV/accessibility/UI regression; no quota breach | Có; ảnh có thể trả phí |

**Thứ tự:** M0.5 → M1 → M2/M3 → M4 → M5 → M6.  
**Giữ:** UI/CSS/JS, URL, OpenAPI, schema nghiệp vụ, RBAC/SEO/security.  
**Thay:** Express, better-sqlite3, fs/multer, scrypt Worker, RAM rate, setInterval, reverse DNS.  
**Bỏ:** SchedulerDO, ViewCounterDO, Workers Cache, SSG toàn bộ, Cloudflare Images, Pages build.

## 12. Rủi ro & quyết định cần duyệt

### Rủi ro cao
- CPU production 10 ms chưa đo; SSR cold/JIT có thể vượt.
- D1 storage 100k bài + revisions gần 5 GB.
- R2 10 GB/10M Class B với 100k cover ảnh; vượt bị tính tiền.
- 100k Worker request/ngày nếu traffic/viral/bot vượt.
- WAF/Bot/Access chưa test thực tế.
- R2 bắt buộc billing profile dù free; không thể cam kết $0 nếu user không muốn nhập payment method.

### Cần bạn xác nhận
1. Cho phép **M0.5 remote staging** không? Cần Cloudflare account/API token, deploy workers.dev, không DNS/production.
2. Có cho phép tạo **R2 subscription/billing profile** (free tier) để test remote media không? Nếu không, R2 remote NOT VERIFIED.
3. Chọn **SSR A** (khuyến nghị) hay **Hybrid C static top pages**.
4. Giữ **email/password + DO** hay chuyển **Cloudflare Access** (50 user, đổi UX).
5. Chấp nhận **R2 overage**/budget alert hay cần $0 tuyệt đối (giới hạn ảnh/không R2)?
6. Xác nhận scale thực: số bài dự kiến, pageview/tháng, số API call/ngày, số admin.
7. Có giữ Node app làm fallback trong M1–M5 không?
8. Có cần view count chính xác không? Nếu không, bỏ ViewCounterDO.
9. Domain/zone đã có trên Cloudflare chưa; có sẵn payment method không?
10. Nếu M0.5 CPU fail, chọn Workers Paid $5 hay Hybrid Node+Cloudflare?

## 13. Trạng thái

**M0 LOCAL: PASS có điều kiện.**  
**M0 REMOTE: NOT VERIFIED** — chưa có quyền Cloudflare account/staging; không thể tuyên bố CPU/quota/R2/WAF production đã đạt.  
**Chưa triển khai M1**, chưa sửa app chính, chưa deploy, chưa DNS/billing.

**M0 ĐÃ HOÀN THÀNH PHẦN LOCAL — CÁC HẠNG MỤC REMOTE ĐANG NOT VERIFIED — ĐANG CHỜ PHÊ DUYỆT M0.5 REMOTE HOẶC M1.**
