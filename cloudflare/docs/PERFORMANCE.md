# M6 — Performance Analysis (Staging)

**Phương pháp:** Cloudflare GraphQL `workersInvocationsAdaptive` theo từng phút; wall time đo riêng từ client. CPU không phải wall time. Không có load test lớn.

## 1. Baseline M5 (20 request/nhóm, build đã chạy ổn định)

| Nhóm route | CPU avg | CPU P50 | CPU P95 | CPU P99 | Wall P50 |
|---|---:|---:|---:|---:|---:|
| Home | 3,14 | 2,81 | 4,39 | 12,02 | 212 ms |
| Article | 5,33 | 4,58 | 7,88 | 16,11 | 424 ms |
| Search | 4,68 | 4,69 | 6,28 | 7,24 | 444 ms |
| Category | 4,53 | 3,32 | 6,03 | 18,58 | 378 ms |
| Tag | 4,10 | 3,44 | 6,14 | 14,09 | 388 ms |
| Admin dashboard | 4,31 | 3,51 | 5,49 | 18,67 | 284 ms |
| Admin editor | 4,73 | 3,89 | 7,54 | 14,62 | 506 ms |
| API list | 5,72 | 5,76 | 6,90 | 7,27 | 446 ms |
| API get | 3,50 | 2,98 | 11,73 | 11,73 | 417 ms |
| API create | 6,51 | 4,95 | 32,69 | 32,69 | n/a |
| Cron | 2,57 | 1,82 | 6,73 | 8,66 | 190 ms |

Nguồn: `fixtures/m6-route-bench-baseline.json`.

## 2. Tối ưu đã thực hiện

- Tách `plainText` khỏi `sanitize.js` → public/API không kéo `sanitize-html` + `marked` khi khởi động.
- Lazy-load `sanitize.js` trong Durable Object; lazy-load `zod`/schema cho API và staging endpoints.
- Tách token/crypto khỏi scrypt; lazy-load scrypt trong DO/staging.
- Self-host 20 file WOFF2 (Be Vietnam Pro + Playfair Display), bỏ Google Fonts.
- 100 biến thể WebP responsive (480/960/1600) + `<picture>`/`srcset`/`sizes`; preload hero theo `imagesrcset`.
- `width`/`height` thật cho ảnh legacy; `decoding=async`; fallback ảnh lỗi.
- Giảm CSS/JS blocking từ Google Fonts; font local có preload.

**Worker startup time:** M5 ~37 ms → M6 trung gian 26 ms → build cuối **12–19 ms** (Wrangler deploy report).

## 3. Cold start (10 request đầu sau deploy)

Đo ngay sau deploy build cuối, không warm:

| Metric | Giá trị |
|---|---:|
| Requests | 10 |
| CPU trung bình | 9,32 ms |
| CPU P50 | 4,63 ms |
| CPU P95/P99 | **27,75 ms** |
| Errors | 0 |

Nguồn: `fixtures/m6-cold-probe.json`. Đây là aggregate 10 request đầu (home/article/search/login/API/cron), không phải từng route. Cold vẫn vượt 10 ms ở outlier; không có `exceededCpu`.

## 4. Sau tối ưu (key routes, low traffic)

| Nhóm route | CPU avg | CPU P50 | CPU P95 | CPU P99 | Requests |
|---|---:|---:|---:|---:|---:|
| Home | 5,60 | 3,93 | 13,61 | 13,61 | 8 |
| Article | 19,96 | 17,75 | 41,51 | 41,51 | 7 |
| Admin dashboard | 11,47 | 7,02 | 35,10 | 35,10 | 8 |
| API list | 8,84 | 4,12 | 31,67 | 31,67 | 9 |
| API create | 17,89 | 4,38 | 48,52 | 48,52 | 8 |
| Cron | 15,99 | 10,53 | 33,95 | 33,95 | 5 |

**Diễn giải:** 5 request/nhóm, warmup 3 request trước đó, nhưng traffic từ Việt Nam phân tán nhiều colo/isolate; request đầu ở mỗi colo vẫn cold. Vì vậy bảng này **không đại diện warm ổn định**. P50 thấp ở home/API list/create (3,9–4,4 ms) cho thấy warm path ổn; P95 bị cold outlier chi phối. Không đủ bằng chứng để tuyên bố P95 ≤7 ms trên toàn bộ route ở low traffic. Baseline M5 đo trong cửa sổ đã ấm sau nhiều test, nên không so sánh trực tiếp công bằng.

**Bằng chứng tối ưu rõ ràng:**
- Startup time 37 → 26 → **12 ms**.
- Cold probe 10 request: avg **15,67 → 9,32 ms**, P95 **39 → 27,75 ms** sau khi lazy-load zod/scrypt/sanitize.
- Lighthouse image savings **2.091 KiB → 139 KiB**; LCP home 3,4 → 2,7 s.
- P50 warm home ~4 ms; mục tiêu P95 ≤7 ms vẫn **chưa chứng minh** dưới low traffic.


## 5. Core Web Vitals / Lighthouse (lab, 1 run)

| Trang | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |
|---|---:|---:|---:|---:|---:|---:|---:|
| Home trước M6 | 0,88 | 0,88 | 1,00 | 1,00 | 3,4 s | 0,021 | 0 ms |
| Home sau M6 (final) | **0,96** | **1,00** | 1,00 | 1,00 | **2,0 s** | 0,017 | 0 ms |
| Article sau M6 | 0,86–0,98 | **1,00** | 1,00 | 1,00 | **1,7 s** | 0,012 | 20–240 ms |
| Admin login sau sửa | — | **1,00** | 1,00 | n/a (noindex) | — | — | — |

- Image delivery savings: **2.091 KiB → 139 KiB** (Lighthouse insight).
- Accessibility home: 0,88 → **1,00** sau khi sửa heading/list/label/target-size.
- Server response time trong Lighthouse 390–790 ms; đây là wall/network, không phải CPU.
- Chưa có dữ liệu field/CrUX (staging ít traffic).

## 6. Giới hạn

- GraphQL không có dimension theo path; số liệu route là xấp xỉ theo cửa sổ phút + traffic cô lập.
- Mạng staging từ Việt Nam rất biến động (wall P95 có lúc >20 s); không dùng wall để suy CPU.
- Cold/warm chỉ đo được gián tiếp; không có quyền force cold isolate.
- Chưa load test 100k request/ngày hoặc đồng thời nhiều AI client.
