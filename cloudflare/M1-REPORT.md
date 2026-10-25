# M1 — PUBLIC BLOG MIGRATION TRÊN CLOUDFLARE FREE

**Ngày:** 2026-10-24/25  
**Ứng dụng chính:** `D:\Github\MeoHayMoiNgay`, commit `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — **không thay đổi**.  
**Workspace migration:** `D:\Github\MeoHayMoiNgay-m0`  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — Worker version `7a730999-89b2-4970-8785-17f475979286`  
**Phạm vi:** Public blog + D1 + Static Assets + Cron + SEO/feeds. Không port Admin CMS, không deploy production, không DNS, không R2 billing, không Workers Paid.

> Kết luận ngắn: public blog đã chạy ổn định trên staging, UI/HTML/SEO gần như trùng khớp Node, nội dung cập nhật tức thời, CPU P95 của các route đo được **≤ 7 ms** trong mẫu cuối. Một số cold-start outlier và các phần Admin/R2/WAF vẫn ngoài phạm vi hoặc chưa kiểm chứng. Không bắt đầu M2.

---

## A. Implementation Summary

### Kiến trúc đã chọn: SSR-first cho HTML, Static Assets cho tài nguyên bất biến

Sau khi phân tích, M1 chọn **SSR-first** thay vì static-first cho HTML:

- Toàn bộ HTML public (`/`, bài viết, category/group/tag, search, sitemap, RSS) render từ D1 mỗi request.
- Static Assets chỉ phục vụ CSS/JS/ảnh legacy/favicon — không còn file HTML tĩnh.
- 71 file HTML SSG cũ được chuyển khỏi `public/` sang `ssg-legacy/`, nên **không còn nguy cơ phục vụ bài cũ/xóa/nháp**.
- Nội dung mới/sửa/unpublish/delete/đổi slug/scheduled hiện ngay, không phụ thuộc rebuild/deploy.
- Không bật Workers Cache/edge cache; `CDN-Cache-Control: no-store` cho HTML để tránh stale chưa kiểm soát.
- Static Assets vẫn giữ 65 file (7.2 MB), dưới giới hạn 20k file/25 MiB.

### Chức năng public đã port

- Trang chủ đầy đủ: ticker, hero slider, “Xem thêm”, thumb strip, grid bài mới, sidebar (giới thiệu, đọc nhiều, chuyên mục, checklist), tips band, footer.
- Bài viết: breadcrumb, category chip, tiêu đề/lede/meta, ảnh hero, prose, tags, author box, prev/next, bài liên quan, JSON-LD `BlogPosting` + `BreadcrumbList`.
- Danh sách: `/bai-viet`, phân trang, canonical từng trang.
- Category `/chuyen-muc/:slug` + phân trang; group `/nhom/:group` + phân trang; tag `/the/:slug` + phân trang.
- Search `/tim-kiem` dùng FTS5 + `bm25`, giữ relevance, `noindex`.
- Sitemap XML, RSS, robots.txt, redirect `/feed`/`/feed.xml` → `/rss.xml`.
- Redirect 301: `.html` → clean URL, trailing slash, `/trang/1` → trang gốc, slug cũ qua `slug_history`.
- Article không tồn tại → 404 HTML; bài đã xóa mềm → 410 HTML; cả hai `noindex`, `Cache-Control: no-store`.
- Không ghi view counter trên mỗi pageview.
- Security headers: CSP nonce, HSTS, `X-Content-Type-Options`, `Referrer-Policy`; chặn UA AI/scraper theo danh sách (không xác minh DNS như Node).
- Media: ảnh legacy qua Static Assets; `/media/*` và upload trả 501 vì R2 chưa được phép. Đã thêm `src/media.js` làm abstraction cho R2 tương lai.

### Tối ưu D1/CPU

- `listLatest`/`listPublished` chỉ SELECT các cột cần render, không lấy `content_html/content_source` cho card.
- `getPublishedBySlug` chỉ SELECT cột chi tiết cần thiết.
- Cache `Intl.DateTimeFormat` result theo ngày và cache HTML-escape trong isolate.
- Cached category counts (trigger từ M0.5) + cached tag counts + `published_posts` counter để tránh COUNT scan.
- Thêm index:
  - `0005_public_indexes.sql`: `idx_posts_status_views`.
  - `0006_cached_totals.sql`: tag counts, counters, trigger đồng bộ.
  - `0007_category_index.sql`: `idx_posts_cat_status_pub_id` cho category page.
- Related posts: query cùng category + fallback list giới hạn, không full scan.
- Search: FTS5 + `MATCH`, `rank`, index; count exact; chưa cap candidates cho trang search (xem Outstanding).
- Không gọi DO cho pageview public; DO chỉ dùng API/auth.

---

## B. Functional Parity

| Thành phần | Node gốc | Cloudflare M1 | Kết quả |
|---|---|---|---|
| Homepage | Đầy đủ module, 16 bài, popular, sidebar, tips, footer | Cùng template/markup, 16 bài, popular, sidebar, tips, footer | **PASS** — screenshot/DOM khớp |
| Article | Breadcrumb, meta, hero, prose, tags, author, prev/next, related, JSON-LD | Cùng cấu trúc; dữ liệu D1; 2 JSON-LD; canonical/OG | **PASS** |
| Category | List + sidebar + pagination + CollectionPage/Breadcrumb | Cùng; cached count; index category | **PASS** |
| Group | `/nhom/doi-song`, `/nhom/cong-nghe` + pagination | Cùng; filter theo category ids | **PASS** |
| Tag | `/the/:slug` + pagination | Cùng; cached tag count | **PASS** |
| Search | FTS5, `rank`, noindex, pagination | Cùng; kết quả `wifi` = 11 bài ở cả hai | **PASS** |
| SEO | Canonical, title/description, OG/Twitter, JSON-LD, breadcrumb, RSS link | Khớp từng trường; chỉ khác `siteUrl` | **PASS** |
| Redirects | `.html`, trailing slash, page 1, feed, slug history | Đã kiểm chứng 301 tương ứng | **PASS** |
| Static Assets | CSS/JS/ảnh | 65 file, không HTML; request asset không có `X-M0-Worker` | **PASS** |
| Sitemap/RSS | 105 URL / 30 item | 105 URL / 30 item, XML hợp lệ | **PASS** |
| 404/410 | Trang lỗi HTML, noindex | 404/410 HTML, noindex, no-store | **PASS** |
| Admin CMS | Đầy đủ login/dashboard/editor/media/users/audit | Chưa port; `/admin` trả 404 | **NOT PORTED (M2)** |
| Media upload | R2/local upload | `/media/*` 501, upload 501 | **NOT AVAILABLE (R2 chưa duyệt)** |

### UI regression / screenshot

Đã chụp và đối chiếu Node baseline (DB copy, không đụng DB thật) với Worker:

- Desktop 1440px: home, article, category.
- Mobile 390px: home, article (CDP device emulation).
- Tablet 768px: home.
- Light mode và dark mode.
- DOM kiểm tra: `innerWidth=390`, `scrollWidth=390` (không tràn ngang), hero 5 slide/1 active, 11 nav link, 3 sidebar widget, 29 ảnh, 0 ảnh lỗi, không console error/network 4xx.
- Structure/HTML khớp Node; khác biệt dữ liệu staging (trước khi đồng bộ tên tác giả) đã được xử lý; author staging hiện là `Bé Dâu` giống baseline.

Ảnh: `screenshots-m1/` (worker/node home, article, category, mobile, tablet).

### HTML/SEO diff

`fixtures/m1-seo-parity.json` và `fixtures/parity-node/*`, `fixtures/parity-worker/*`:

- Home: title/description/robots/canonical/OG/Twitter/JSON-LD WebSite+Organization khớp.
- List/category/group: CollectionPage + BreadcrumbList khớp.
- Article: BlogPosting + BreadcrumbList, article published/modified, section, h1=1 khớp.
- Search: noindex, canonical, 11 kết quả khớp.
- Tag: Node baseline dùng `/the/wifi-cham`; Worker cùng nội dung.
- Khác duy nhất: hostname staging trong URL tuyệt đối; asset query `?v=m1` thay vì hash build của Node.

---

## C. Performance Results

### C.1. CPU (Cloudflare GraphQL, mẫu theo bucket phút)

> GraphQL trả mẫu, không phải toàn bộ request. Wall time không dùng thay CPU. Các mẫu cuối lấy sau khi tối ưu query + escape/date cache.

| Route | Request đo | CPU P50 | CPU P95 | CPU max (cold) | Wall P50 / P95 | D1 rows read/lượt (xấp xỉ) |
|---|---:|---:|---:|---:|---:|---:|
| `/` home | 30 | 3.94 ms | **5.16 ms** | 27.12 ms | 207 / 267 ms | ~14 |
| Article | 55 | 3.45 ms | **5.12 ms** | 12.96 ms | 479 / 614 ms | ~65 |
| `/bai-viet` list | 100 | 3.11 ms | **4.16 ms** | 5.68 ms | 366 / 519 ms | ~18 |
| Category | 30 | 3.46 ms | **4.11 ms** | 5.71 ms | 380 / 541 ms | ~18 |
| Tag | 100 | 3.35 ms | **4.86 ms** | 6.28 ms | 452 / 796 ms | ~20 |
| Search | 30 | 3.33 ms | **4.97 ms** | 7.04 ms | 391 / 501 ms | ~95 |
| Sitemap | — | — | — | — | — | 105 URL (70 bài) |

- **Tất cả P95 mẫu cuối ≤ 7 ms.** Không có `exceededCpu`/`exceededMemory`, error rate Worker = 0.
- Cold-start outlier lớn hơn P95 (home 27 ms, article 13 ms, các phase trước category 15–16 ms, list 11–21 ms, tag 13–15 ms). Nguyên nhân: request đầu sau khoảng nghỉ/isolate mới, JIT/khởi tạo module; các request sau ổn định 2–6 ms. Không được coi outlier là mức thường xuyên.
- Các tối ưu có tác động rõ:
  - Bỏ `content_html/content_source` khỏi list: article từ ~10–13 ms xuống ~3–5 ms.
  - Cached counters/tag counts: category/tag/list giảm rows và CPU.
  - Date/escape cache: giảm CPU render.
  - Index category composite: category page 1k từ scan status index sang `idx_posts_cat_status_pub_id`.

### C.2. D1

| Hạng mục | Kết quả |
|---|---|
| Tổng bài / FTS / tag | 70 / 70 / 26 (đã dọn synthetic/test) |
| D1 size | 1.54 MB |
| 24h test usage | 621.053 rows read / 33.082 rows written — do benchmark/import test, không phải traffic thật |
| Giới hạn Free | 5M reads/ngày, 100k writes/ngày |
| Ghi DB mỗi pageview | **0** — không tăng view counter |
| Counter `published_posts` | 70, khớp thực tế |
| Tag count mismatch | 0/26 |
| Batch atomicity | PASS (M0.5, giữ nguyên) |
| Concurrent reads | PASS 20/20 (M0.5) |

Query plan đã kiểm tra:
- List: `SEARCH p USING INDEX idx_posts_status_pub_id (status=?)`.
- Category: `SEARCH p USING INDEX idx_posts_cat_status_pub_id (category_id=? AND status=?)`.
- FTS search: `SCAN posts_fts VIRTUAL TABLE INDEX 0:M4` + join PK + temp B-tree cho `rank` (đúng cho relevance).

### C.3. Scale 1k (giả lập, đã dọn)

- Import 1.000 bài synthetic (`staging-scale-*`) + FTS: 12.000 rows written.
- List trang 50: CPU 2.7–4.2 ms warm.
- Category trang 50 (sau index 0007): 2.7–3.7 ms warm.
- Search `staging` với 1k kết quả: 3–5.2 ms warm.
- Không lỗi Worker. Sau test đã xóa toàn bộ, quay về 70 bài thật; counters/counts trả đúng 70/10.

### C.4. Static vs Worker

- HTML public: Worker (`X-M0-Worker: 1`), không có `cf-cache-status` vì Workers Cache không bật.
- CSS/ảnh/favicon: không có `X-M0-Worker`, `cf-cache-status: HIT` sau warm.
- 65 file static, 7.2 MB, 0 file HTML.
- Static asset requests miễn phí/không giới hạn theo Cloudflare; không bật Workers Cache để tránh biến asset request thành request tính phí.

### C.5. Quota estimate (SSR-first, không view write)

| Pageview/tháng | Worker/ngày | D1 reads/ngày (ước tính ~30/page) | D1 writes/ngày | Static assets/tháng |
|---:|---:|---:|---:|---:|
| 10.000 | 333 | ~10.000 | API/Cron only | ~100.000 |
| 100.000 | 3.333 | ~100.000 | < 5.000 | ~1.000.000 |
| 1.000.000 | 33.333 | ~1.000.000 | < 10.000 | ~10.000.000 |

- Worker giới hạn 100k request/ngày → tối đa ~3M pageview/tháng nếu **toàn bộ** là SSR.
- D1 5M reads/ngày: ở 1M pageview/tháng còn dư; nếu toàn bộ là search (~95 rows) ở 3M pageview/tháng sẽ vượt 5M/ngày.
- Static assets không tiêu hao Worker quota; D1 writes chỉ phát sinh khi publish/Cron/API.
- DO requests gần như 0 cho public; chỉ login/API.

### C.6. Edge cache / Workers Cache

- **Chưa bật**, nên chưa có `cf-cache-status` trên HTML và chưa thể kiểm chứng cache trước Worker trên traffic thật.
- Theo tài liệu Cloudflare hiện hành:
  - Workers Cache **hoạt động trên `workers.dev`**; cache thuộc Worker, không phụ thuộc zone.
  - Cache HIT **không chạy Worker, không tính CPU**, nhưng **vẫn tính là request**; khi bật, static asset requests cũng bị tính request.
  - Có thể purge/invalidate bằng `ctx.cache.purge()` / `invalidate()`.
- Vì vậy M1 **không dựa vào cache**; HTML dùng `Cache-Control: public, max-age=0, must-revalidate` + `CDN-Cache-Control: no-store`.
- Nếu bật ở M2/M3: cần test hit ratio thực tế, purge khi publish/unpublish/delete/đổi slug, TTL/stale, và tính lại quota. Hiện **NOT VERIFIED**.

---

## D. Content Consistency

Bộ test `scripts/m1-consistency.mjs` chạy trên staging: **42/42 PASS**.

| Tình huống | Kết quả |
|---|---|
| Tạo draft | Không xuất hiện home/list/category/tag/search/sitemap/RSS; article 404 |
| Publish | Article 200; xuất hiện ngay home/list/category/tag/search/sitemap/RSS; category count +1 |
| Sửa tiêu đề | Article cập nhật ngay; search FTS cập nhật theo |
| Đổi slug | URL mới 200; URL cũ **301** sang slug mới; sitemap chỉ có slug mới |
| Unpublish | Article 404; biến mất khỏi home/list/category/sitemap/RSS; category count −1 |
| Xóa mềm | Article **410**; biến mất khỏi home/sitemap; category count −1; tag count cập nhật |
| Scheduled | Ẩn trước giờ; cron publish đúng; hiện ngay sau publish |
| Homepage/sitemap/RSS | Render từ D1 mỗi request, cập nhật ngay; không rebuild |
| Static cũ | 71 file SSG đã rời `public/`; `.html` cũ 301 về SSR; không phục vụ bản cũ |
| Counts | Category/tag/counter trigger khớp 0 mismatch |

Cơ chế:
- Không có HTML tĩnh để stale.
- `slug_history` xử lý redirect slug cũ; bài đã xóa trả 410.
- `posts_fts` được cập nhật khi create/update; status/deleted được filter trong mọi query public.
- Không tăng view counter; không ghi DB trên pageview.
- Sitemap/RSS tạo từ dữ liệu hiện tại (không cache).

---

## E. Code Changes (workspace `MeoHayMoiNgay-m0`)

### Thêm mới / port

- `src/views/constants.js`, `helpers.js`, `components.js`, `layout.js`, `home.js`, `list.js`, `article.js`, `error.js` — port từ Node, giữ markup/UI.
- `src/lib/seo.js`, `time.js` — SEO/date; `time.js` thêm cache ngày.
- `src/lib/assets.js`, `image-meta.js`, `image-dimensions.js` — asset version và dimension map cho 61 ảnh legacy.
- `src/public-data.js` — repository D1 public, query tối ưu, cached totals, related/adjacent.
- `src/public-routes.js` — toàn bộ route public + redirect + 404/410 + feeds wiring.
- `src/feeds.js` — robots/sitemap/RSS + settings mặc định.
- `src/security.js` — CSP nonce, headers, UA blocklist.
- `src/media.js` — abstraction media (R2 tương lai).
- `src/config.js` — SITE/config cho views/SEO, setSiteUrl theo request.

### Sửa

- `src/index.js` — gắn public routes, canonical redirect, 404 HTML, media abstraction; giữ API/DO/Cron M0.5.
- `src/public-data.js` — list/detail columns, counters, tag/group filters.
- `src/index.js` media route dùng `mediaStorage`.
- `src/views/helpers.js` — cache escape.
- `src/lib/time.js` — cache formatDate.

### Migrations

- `0005_public_indexes.sql` — index popular.
- `0006_cached_totals.sql` — tag counts, `counters`, trigger đồng bộ.
- `0007_category_index.sql` — composite category index.

### Static assets

- Chuyển 71 file HTML khỏi `public/` sang `ssg-legacy/` (không deploy).
- Thêm `public/favicon.svg`.
- Giữ CSS/JS/61 ảnh legacy; 65 file, 7.2 MB.
- Không sửa app chính.

### Test/tooling

- `scripts/m1-consistency.mjs` — 42 test tình huống nội dung.
- `scripts/cdp-shot.mjs`, `cdp-audit.mjs` — screenshot/mobile/console/overflow audit.
- `fixtures/m1-*`, `fixtures/parity-*`, `fixtures/cdp-audit-*`, `fixtures/m1-route-cost.json`.

---

## F. Outstanding Issues

### Chưa port / chưa khả dụng

- **Admin CMS** (login/dashboard/editor/media/users/audit/revisions/trash/preview) — M2. Footer vẫn có link `/admin`; hiện trả **404**. Đây là internal link duy nhất không 200 trong crawl.
- **Media upload/R2** — 501; chỉ ảnh legacy static. R2 cần billing/approval; chưa có remote verification.
- **Settings** — đang dùng hằng số giống Node defaults; chưa có bảng settings/động.
- **API contract đầy đủ** — M1 chỉ giữ API M0.5 hiện có; list/slug/schedule/unpublish/delete/me/openapi vẫn thiếu.

### Chưa kiểm chứng / rủi ro

- **Workers Cache / edge cache**: chưa bật, chưa có số hit ratio/purge thực tế. Cache hit vẫn tính request; bật cache sẽ làm static asset requests bị tính.
- **WAF/Access/Bot Fight Mode**: không có zone/DNS nên chưa test. UA blocklist hiện tại không xác minh DNS như Node.
- **CPU cold-start outlier**: home từng 27 ms, article 13 ms, category/list/tag 13–21 ms ở request đầu; P95 mẫu cuối ≤7 ms nhưng cold không đảm bảo. Không có `exceededCpu` trong test.
- **Scale 100k**: mới test 1k. Sitemap 100k sẽ rất lớn (~17 MB), search count/rank và sitemap CPU cần chiến lược static/cap.
- **Search page**: dùng full FTS + `rank`, count exact; chưa cap candidates cho pagination sâu.
- **Sitemap/RSS**: render mỗi request; ở 100k nên pre-generate/cache có kiểm soát.
- **Browser**: chỉ Chrome headless; chưa Safari/Firefox/thiết bị thật. Dark/light/mobile/tablet/không tràn ngang/không console error đã kiểm tra.
- **Static asset Cache-Control** đang `max-age=0, must-revalidate` từ asset server; có thể thêm `_headers` để cache lâu hơn, chưa làm vì không cần cho M1.
- **Public rate limiting** chưa có; cần WAF/Worker limiter có kiểm soát quota.
- **Node baseline** chạy bằng bản copy DB; không đụng DB thật.

### Publishing API CPU (chặn M3, không chặn public M1)

- 2 KB HTML: 4.4–7.1 ms warm; 8 KB markdown + DO: 7.7–10.4 ms warm; 84 KB: 22–154 ms.
- Đề xuất M3: cap nội dung (ví dụ 32 KB), trả 413; tiếp tục sanitize trong DO; không hạ scrypt; nếu cần nội dung lớn phải xem xét Paid hoặc xử lý queue/DO có kiểm soát.

---

## G. M2 Readiness

**Public read path:** sẵn sàng cho M2 ở mức giao diện/SEO/D1. Các điều kiện cần giải quyết trước khi port Admin:

1. **Schema**: thêm settings, revisions, media, audit, user fields/bio… để parity với Node; migration idempotent, backfill.
2. **Auth/Admin**: login page, session/CSRF/RBAC, dashboard, editor, preview, revisions/trash, media admin, users/API clients, audit, settings.
3. **Media**: quyết định R2 (billing/guard) hoặc giữ upload disabled; abstraction đã có.
4. **Settings**: chuyển từ hằng số sang bảng settings có cache/invalidation.
5. **API**: hoàn thiện contract trước M3; content-size limit và CPU budget.
6. **Cache/WAF**: nếu dùng edge cache, test purge/invalidations; WAF/Access cần zone và phê duyệt riêng.
7. **Scale**: test 10k/100k cho sitemap/search/list; chiến lược static/pagination.

**Kết luận M2:** public site đã đủ ổn định để làm nền Admin migration, nhưng **chưa nên cutover production** cho đến khi xử lý Admin/R2/WAF và scale 100k.

---

## Trạng thái kết thúc

Các thay đổi chỉ nằm trong workspace migration và staging. Không deploy production, không đổi DNS, không bật R2 billing/Workers Paid, không thay thế app Node.

**M1 HOÀN THÀNH TRONG PHẠM VI STAGING — ĐANG CHỜ PHÊ DUYỆT M2.**
