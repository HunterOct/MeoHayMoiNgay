# MIGRATION CHECKLIST — Cloudflare Free ($0)

**Cập nhật:** 2026-10-25  
**Baseline app chính:** `f26d45d`, `git status` sạch  
**Prototype:** `D:\Github\MeoHayMoiNgay-m0` (ngoài repo chính, không được commit vào app chính)  
**Trạng thái remote:** Static Assets operations gate hoàn thành; runner/queue/audit/code hash/publish gate tested staging. Production **CONDITIONAL GO** cho local-runner model, chưa deploy. Xem [`STATIC-ASSETS-OPERATIONS-GATE.md`](./STATIC-ASSETS-OPERATIONS-GATE.md).

> Cập nhật Final Blocker: migration full revisions/author PASS 29/29 trên D1 cô lập; ECONNRESET do đường truyền (tail/analytics evidence), M3 28/28 với timeout gốc; regression 215/215; media adapter 18+14; restore 24/24. Media upload vẫn BLOCKED; WAF/Access/BFM NOT VERIFIED. Production: **NO-GO**. Xem [`FINAL-BLOCKER-REPORT.md`](./FINAL-BLOCKER-REPORT.md).

> Quy tắc: checklist này không cho phép sửa app chính, deploy production, DNS, R2 billing, Workers Paid. Chỉ dùng tài khoản Free và tài nguyên staging độc lập sau khi đăng nhập.

## 0. Preflight bắt buộc

- [ ] Xác nhận app chính không thay đổi: `git -C D:\Github\MeoHayMoiNgay status --short` phải rỗng.
- [ ] Xác nhận commit baseline: `git -C D:\Github\MeoHayMoiNgay log --oneline -1` = `f26d45d`.
- [ ] Không copy `.env`, DB thật, media thật, API key thật lên staging.
- [ ] Chỉ dùng dữ liệu test trong `fixtures/`; test credentials chỉ tồn tại trong prototype.
- [ ] Không chạy `wrangler deploy` với config mặc định (`wrangler.jsonc`) nếu chưa đổi tên tài nguyên staging.
- [ ] Xác nhận tài khoản Cloudflare là **Free plan** và không có R2 billing/subscription.
- [ ] Tạo nhánh/backup app chính trước M1 (chưa làm bây giờ).

## 1. Cloudflare access & quyền tối thiểu

### Cách khuyến nghị

Chạy trong terminal tương tác, không gửi token/mật khẩu vào chat:

```bash
cd D:\Github\MeoHayMoiNgay-m0
npx wrangler login
npx wrangler whoami
```

Nếu `whoami` trả về account và token còn hạn, tiếp tục mục 2. Nếu không, dừng remote.

**Lỗi `Invalid access token [9109]`:**
- Giá trị phải là **Cloudflare API Token** (thường 40 ký tự), không phải Global API Key (37 hex), R2 access key, OAuth refresh token hay service token.
- Kiểm tra token còn Active, chưa hết hạn, đúng account và có quyền Workers Scripts:Edit + D1:Edit.
- Tạo token mới tại https://dash.cloudflare.com/profile/api-tokens và nhập lại bằng script local; không dán token vào chat.
- Hoặc dùng OAuth: `npx wrangler login` (không cần token).

### Nhập token an toàn trên máy (không dán vào chat)

Chạy script PowerShell đã chuẩn bị; script đọc token bằng `Read-Host -AsSecureString`, không echo, ghi `.env.wrangler` và giới hạn ACL:

```powershell
cd D:\Github\MeoHayMoiNgay-m0
scripts\set-cloudflare-auth.cmd   # hoặc: powershell -ExecutionPolicy Bypass -File .\scripts\set-cloudflare-auth.ps1
```

Sau đó kiểm tra (không in token):

```bash
npx wrangler whoami --env-file .env.wrangler
```

Nếu không dùng script, có thể tự tạo `.env.wrangler` bằng editor với:

```dotenv
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

Không commit `.env.wrangler`; file này đã nằm trong `.gitignore` của prototype. Không dùng `echo` token vào command.

### Nếu dùng API token scoped

Đặt biến môi trường cục bộ (không dán vào chat):

```bash
export CLOUDFLARE_API_TOKEN="..."   # không echo, không commit
export CLOUDFLARE_ACCOUNT_ID="..."  # nếu account có nhiều workspace
```

Quyền tối thiểu cho M0.5:

| Phạm vi | Quyền | Dùng cho |
|---|---|---|
| Account | Workers Scripts:Edit | deploy Worker/DO/Cron |
| Account | D1:Edit | tạo/migrate D1 staging |
| Account | Workers Tail:Read (nếu có) | logs/CPU tail |
| Account | Account Analytics:Read (tùy chọn) | metrics CPU/D1 |
| Zone | Không cấp | Không dùng domain/WAF ở M0.5 |
| R2 | **Không cấp** | R2 không được kích hoạt |

Không cấp quyền Billing, DNS, Zone WAF, Workers Paid, R2.

## 2. M0.5 — Remote staging setup

### 2.1. Tạo tài nguyên staging

- [ ] Đổi tên trong `wrangler.remote.jsonc` nếu `meohay-m0-staging` đã tồn tại; dùng hậu tố riêng.
- [ ] Tạo D1 staging:
  ```bash
  npx wrangler d1 create meohay-m0-staging
  ```
  Ghi lại `database_id`.
- [ ] Thay `REPLACE_WITH_STAGING_D1_ID` trong `wrangler.remote.jsonc` bằng ID vừa tạo.
- [ ] Không thêm `r2_buckets` vào config remote.
- [ ] Tạo staging token (local only):
  ```bash
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  printf '%s' "$TOKEN" | npx wrangler secret put STAGING_TOKEN -c wrangler.remote.jsonc
  printf 'STAGING_TOKEN=%s\n' "$TOKEN" > .staging-token
  ```
  Không in token, không commit `.staging-token`.
- [ ] Deploy staging:
  ```bash
  npx wrangler deploy -c wrangler.remote.jsonc
  ```
  Ghi URL `https://<worker>.<account>.workers.dev`.
- [ ] Cập nhật `SITE_URL` trong `wrangler.remote.jsonc` thành URL thật.
- [ ] Regenerate static HTML với URL staging để canonical/OG đúng:
  ```bash
  SITE_URL="https://<worker>.<account>.workers.dev" node scripts/generate-ssg.mjs
  ```
- [ ] Deploy lại sau khi regenerate static assets.
- [ ] Xác nhận route:
  ```bash
  curl -s https://<worker>.workers.dev/api/m0/health
  ```
  Health được phép public nhưng chỉ trả count/uptime, không trả secret.

### 2.2. Migrate & seed dữ liệu giả lập

- [ ] Áp migration remote:
  ```bash
  npx wrangler d1 migrations apply DB --remote -c wrangler.remote.jsonc
  ```
- [ ] Chia nhỏ seed 70 bài để tránh giới hạn file/statement:
  ```bash
  node scripts/split-sql.mjs fixtures/seed.sql fixtures/split 100
  for f in fixtures/split/*.sql; do
    npx wrangler d1 execute DB --remote -c wrangler.remote.jsonc --file="$f"
  done
  npx wrangler d1 execute DB --remote -c wrangler.remote.jsonc --file=fixtures/extra-users.sql
  ```
- [ ] Seed thêm **1.000 bài synthetic** để test index/count; không seed 100k remote:
  ```bash
  npx wrangler d1 execute DB --remote -c wrangler.remote.jsonc --file=fixtures/scale-1k.sql
  ```
- [ ] Kiểm tra counts/FTS:
  ```bash
  npx wrangler d1 execute DB --remote -c wrangler.remote.jsonc --command="SELECT COUNT(*) FROM posts; SELECT COUNT(*) FROM posts_fts;"
  ```
- [ ] Không import dữ liệu thật, không copy user/admin hash thật, không dùng API key thật.

### 2.3. Bảo vệ staging

- [ ] `REQUIRE_STAGING_TOKEN=1` trong config remote.
- [ ] Mọi `/api/m0/*` (trừ health) yêu cầu header `x-staging-token`.
- [ ] API publishing vẫn yêu cầu bearer key.
- [ ] Không port Admin UI ở M0.5; không public endpoint quản trị.
- [ ] Static HTML/asset staging là nội dung test; nếu cần ẩn, dùng Access/Cloudflare Zero Trust (cần zone; chưa làm).
- [ ] Không log token/API key.

## 3. M0.5 — Thu thập bằng chứng remote

### 3.1. Chạy probe

Terminal A (tail):

```bash
cd D:\Github\MeoHayMoiNgay-m0
npx wrangler tail meohay-m0-staging -c wrangler.remote.jsonc --format json > fixtures/tail.jsonl
```

Terminal B (probe; không echo token):

```bash
cd D:\Github\MeoHayMoiNgay-m0
export STAGING_BASE="https://<worker>.<account>.workers.dev"
export STAGING_TOKEN="$(cut -d= -f2- .staging-token)"
export STAGING_API_KEY="$(node -p "require('./fixtures/seed-meta.json').apiKey")"
node scripts/remote-probe.mjs
```

- [ ] Lưu `fixtures/remote-results.json`.
- [ ] Parse tail: `node scripts/parse-tail.mjs fixtures/tail.jsonl`.
- [ ] Nếu tail không có `cpuTime`, dùng Workers dashboard Metrics (Requests, CPU P50/P95, errors) và chụp/lưu số liệu; **không thay bằng wall time**.

### 3.2. CPU / errors

- [ ] Đo cold: request đầu tiên sau khi Worker idle ≥10 phút (ghi rõ là cold).
- [ ] Đo warm: 50–100 request mỗi route chính (article/home/search/category), low volume, dưới quota.
- [ ] Ghi CPU P50/P95/max, wall P50/P95, `exceededCpu`, `exceededMemory`, exceptions.
- [ ] Mục tiêu an toàn: **CPU P95 ≤ 7 ms** và không có `exceededCpu`; nếu P95 7–10 ms: PARTIAL, cần tối ưu; >10 ms: FAIL.
- [ ] Kiểm tra cold start riêng; cold wall không thay CPU.
- [ ] Route cần đo: `/dyn/home`, `/dyn/bai-viet/:slug`, `/api/m0/bench/search-capped`, `/api/m0/bench/categories`, API create/update, login/sanitize DO.

### 3.3. D1 remote

- [ ] `d1-meta` trả `rows_read`, `rows_written` (nếu remote D1 meta có).
- [ ] `d1-write` trả rows_written cho insert/delete.
- [ ] Đo query latency remote P50/P95 cho: article, home, category count, search capped, related.
- [ ] Kiểm tra composite indexes và `cached_post_count`; chạy `EXPLAIN QUERY PLAN` remote nếu có.
- [ ] Xác nhận batch atomicity: endpoint `/api/m0/db/batch-atomicity`.
- [ ] Xác nhận concurrency: `/api/m0/bench/concurrent?n=20` (không chạy 50–100 remote nếu quota chưa rõ).
- [ ] Idempotency/external_id/concurrent duplicate.
- [ ] Ghi rows read/write thực tế; dự phóng daily quota.
- [ ] Không seed 100k remote; scale lớn dùng suy luận từ 1k + local; ghi NOT VERIFIED.

### 3.4. SecureOps DO

- [ ] `hash-scrypt-do`: latency + verify; xác nhận không hạ tham số.
- [ ] `sanitize-do`: HTML/Markdown + XSS vector.
- [ ] `rate_limit`: 11 request cùng key → 10 allowed + 1 429.
- [ ] Login + CSRF + RBAC.
- [ ] Đo 10–20 request đồng thời tới cùng DO; kiểm tra bottleneck/queue.
- [ ] Ghi DO requests/duration/rows nếu dashboard cung cấp; nếu không: PARTIAL/NOT VERIFIED.
- [ ] Xác nhận một class `SecureOps` không gây tranh chấp; nếu có, tách instance theo mục đích (auth/sanitize/rate), không tách class nếu không cần.

### 3.5. Publishing API

- [ ] API key auth: missing/invalid 401; scope 403.
- [ ] Create/update/publish/review.
- [ ] Idempotency replay; conflict 409.
- [ ] External ID replay.
- [ ] HTML/Markdown sanitize XSS.
- [ ] Validation 400; error format.
- [ ] Rate limit 429 + Retry-After.
- [ ] Concurrent duplicate create.
- [ ] API contract giữ nguyên endpoint/fields/status codes; ghi khác biệt nếu có.

### 3.6. Cron & scheduled publishing

- [ ] Config cron `*/5 * * * *` (đã đặt); không dùng mỗi phút trừ khi cần.
- [ ] Seed 3 scheduled; chờ Cron thật; xác nhận published.
- [ ] Ghi CPU Cron, D1 reads/writes, request count.
- [ ] Race: gọi endpoint cron thủ công 2 lần đồng thời; không double publish.
- [ ] Retry: lần chạy lỗi/gián đoạn; lần sau vẫn xử lý bài còn scheduled.
- [ ] Đo backlog 20/batch; nếu 100 bài cần 5 phút → chấp nhận hay tăng batch (có đo CPU).
- [ ] Xác nhận Cron không đốt quota bất thường.

### 3.7. Static Assets remote

- [ ] `/assets/css/style.css` 200; không có header `x-m0-worker`; kiểm tra Workers metrics requests không tăng.
- [ ] `/bai-viet/<slug>` static `.html` 200, **không 307**, không Worker.
- [ ] `/bai-viet/<new-slug>` không có asset → Worker SSR 200 (fallback).
- [ ] Kiểm tra `CF-Cache-Status`, asset routing, `run_worker_first` (nếu cấu hình).
- [ ] Đếm file: 61 ảnh + 70 HTML + CSS/JS <20k.
- [ ] Không bật Workers Cache; xác nhận static assets vẫn free/unlimited.

### 3.8. R2 (NOT VERIFIED)

- [ ] Không tạo bucket/subscription/billing.
- [ ] `/media/...` trả 501 `media_not_configured` trên staging.
- [ ] Ghi docs: R2 cần billing profile/subscription; free 10 GB, 1M Class A, 10M Class B, egress free; overage billed.
- [ ] Lập guard: max 8 MB/upload, magic bytes, nén ảnh trước upload, quota alert, lifecycle.
- [ ] Đánh dấu **R2 remote NOT VERIFIED**.

### 3.9. WAF/Bot/Access (NOT VERIFIED)

- [ ] Không đổi zone/DNS/WAF.
- [ ] Ghi nhận WAF Free: 1 rate rule IP + 5 custom + Bot Fight; Access 50 user; cần zone/Zero Trust + payment details.
- [ ] Đánh dấu **NOT VERIFIED** cho tới khi có zone/staging domain riêng và được phép.
- [ ] Không dùng reverse DNS trên Workers; phương án IP ranges/WAF.

## 4. Functional parity với Node app

Prototype hiện chỉ port một phần; **không tuyên bố parity đầy đủ**.

- [ ] So sánh HTML structure/CSS/responsive home + article.
- [ ] URL/slug, canonical, OG/Twitter, JSON-LD, title.
- [ ] Sitemap/RSS/robots (prototype chưa port đầy đủ → ghi missing).
- [ ] 301 slug history, 410 deleted, 404.
- [ ] API contract: endpoints/fields/status/error format.
- [ ] RBAC/CSRF/session.
- [ ] Publish/review/schedule behavior.
- [ ] Admin CMS UI (prototype chưa có → NOT PORTED).
- [ ] Media admin/picker (prototype chưa có).
- [ ] Search filters/pagination.
- [ ] Ghi rõ mọi chức năng chưa hỗ trợ; không tuyên bố parity.

## 5. M1–M6 migration checklist

### M1 — Public SSR (P0)

- [ ] Tạo Worker/D1/DO staging riêng; cấu hình `wrangler` theo env.
- [ ] Port public routes sang Hono: `/`, `/bai-viet`, `/bai-viet/:slug`, `/chuyen-muc`, `/the`, `/nhom`, `/tim-kiem`, `/sitemap.xml`, `/rss.xml`, `/robots.txt`, `/media`.
- [ ] Giữ nguyên HTML/CSS/JS; template functions thuần; asset version; static assets.
- [ ] D1 migrations: cached counts, indexes, FTS, related 2-query, no view write, capped search.
- [ ] Import 70 bài; validate canonical/JSON-LD/sitemap/RSS; 301/410.
- [ ] Security headers/CSP; staging token; no admin/API exposed.
- [ ] Port test cases: 47 scenario; golden HTML/SEO diff Node↔Worker.
- [ ] Desktop/mobile screenshot; no console/CSP errors.
- **Nghiệm thu:** route/SEO parity; CPU remote P95 ≤7 ms; D1 rows modeled dưới quota; static no Worker; 70 bài.

### M2 — Auth/Admin (P0)

- [ ] `SecureOps` DO: scrypt verify/hash, sanitize, rate; không hạ tham số.
- [ ] D1 sessions/CSRF/RBAC; cookie Secure/SameSite/HttpOnly; lockout/rate login.
- [ ] Port Admin CMS UI/editor/preview/revisions/trash/audit; giữ giao diện.
- [ ] R2 media chỉ sau khi được duyệt billing; nếu chưa, media NOT VERIFIED và admin media chưa bật.
- [ ] Test login, CSRF, RBAC author/editor/admin, media, revision, trash, preview noindex.
- **Nghiệm thu:** tất cả luồng admin pass; không secret trong client/log; DO latency ổn.

### M3 — Publishing API/Scheduler (P0)

- [ ] Port API contract: create/update/get/list/publish/schedule/unpublish/delete/media.
- [ ] API key hash/scopes; idempotency/external_id; validation; sanitize; errors.
- [ ] Rate limit DO/WAF; concurrent duplicate.
- [ ] Cron 5 phút hoặc 1 phút đã đo; batch; race/retry.
- [ ] OpenAPI cập nhật (giữ contract).
- **Nghiệm thu:** 21 API scenario; retries; schedule; quota; no duplicate.

### M4 — Security/Anti-scraping (P1)

- [ ] CSP/headers; sanitize allow-list; CSRF; RBAC; API key; upload guard.
- [ ] WAF 1 rate rule + 5 custom; Bot Fight; robots; IP ranges; hotlink.
- [ ] Audit throttling; login lockout.
- [ ] Access optional (50 user) — chỉ khi có nhu cầu/zone.
- **Nghiệm thu:** Googlebot/Bingbot không bị chặn; scraper/AI bị chặn; hotlink 403; audit.

### M5 — Deployment/Ops (P1)

- [ ] Tạo production resources sau khi được duyệt; DNS/SSL/custom domain cần phê duyệt riêng.
- [ ] D1 Time Travel 7 ngày + export R2; backup/restore drill.
- [ ] Workers Logs 200k/day/3 ngày; Web Analytics; alerts; budget.
- [ ] Rollback Node app + DB; smoke test; Search Console.
- [ ] Không đổi DNS production nếu chưa duyệt.
- **Nghiệm thu:** staging/preprod smoke; restore; alert; rollback.

### M6 — Performance/UI (P2)

- [ ] Static top 10k–20k pages nếu traffic >100k request/ngày; home dynamic/new-post fallback.
- [ ] Ảnh srcset/pre-optimize; self-host font; TOC; mobile density; admin UX.
- [ ] CWV/accessibility; no file cap; no quota breach.
- **Nghiệm thu:** CWV, UI regression, quota margin.

## 6. Cutover & rollback

- [ ] Giữ Node app và DB hiện tại trong suốt M1–M5.
- [ ] Export D1/dữ liệu; kiểm tra counts/SEO trước cutover.
- [ ] Cutover DNS chỉ sau phê duyệt riêng; không đổi zone trong M0.5.
- [ ] Smoke test URL/SEO/API/admin sau cutover.
- [ ] Rollback: trỏ DNS về Node, restore D1 export nếu cần; không xóa Node/DB.
- [ ] Không chạy migration phá hủy; không xóa production data.

## 7. Staging resources & cleanup

Hiện tại: **chưa tạo tài nguyên remote nào** do chưa đăng nhập.

Sau khi remote chạy, ghi inventory:

| Resource | Name | ID | Giữ/Xóa |
|---|---|---|---|
| Worker | meohay-m0-staging | — | Giữ đến khi duyệt, sau đó xóa |
| D1 | meohay-m0-staging | — | Giữ để đối chiếu, sau đó xóa |
| DO | SecureOps | — | Xóa cùng Worker |
| Cron | */5 | — | Xóa cùng Worker |
| R2 | Không tạo | — | Không áp dụng |

Cleanup commands (chỉ sau khi duyệt):

```bash
npx wrangler delete meohay-m0-staging -c wrangler.remote.jsonc
npx wrangler d1 delete meohay-m0-staging -c wrangler.remote.jsonc
rm -f .staging-token
```

Không xóa tài nguyên ngoài tên staging; không xóa app chính/DB.

## 8. Acceptance M0.5

- [ ] CPU P95 ≤7 ms với safety margin; không exceededCpu/memory.
- [ ] D1 rows read/write thực tế; dự phóng dưới quota; batch/transaction/idempotency.
- [ ] SecureOps DO CPU/latency/rate; không bottleneck; scrypt giữ tham số.
- [ ] API contract/scopes/idempotency/rate.
- [ ] Cron thật + race + retry + quota.
- [ ] Static Assets: không Worker invocation, clean URL, <20k file.
- [ ] R2 NOT VERIFIED (không billing).
- [ ] WAF/Bot/Access NOT VERIFIED (không zone).
- [ ] Functional parity: ghi rõ phần đã/ chưa port; không tuyên bố full parity.
- [ ] Không phát sinh phí; không billing.
- [ ] App chính vẫn `f26d45d`.

## 9. Current status / next action

- **Local M0:** PASS có điều kiện; báo cáo `M0-REPORT.md`.
- **Remote M0.5:** **BLOCKED** do `wrangler whoami` chưa đăng nhập.
- **R2:** NOT VERIFIED; không được kích hoạt billing.
- **WAF/Bot/Access:** NOT VERIFIED; không đổi zone.
- **Main app:** unchanged, clean.
- **Đã chuẩn bị:** `wrangler.remote.jsonc`, staging token guard, R2 guard, seed split, scale-1k, remote probe, tail parser.

**Việc cần bạn làm để tiếp tục M0.5:** chạy `npx wrangler login` trong terminal tương tác và xác nhận account Free; sau đó tôi có thể tiếp tục các bước remote theo checklist. Không gửi token/mật khẩu vào chat.

**M0.5 CHƯA HOÀN THÀNH PHẦN REMOTE — ĐANG CHỜ ĐĂNG NHẬP CLOUDFLARE FREE ĐỂ TIẾP TỤC.**
