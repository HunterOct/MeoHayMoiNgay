# WAF / Access / Anti-Scraping Plan (No Changes Applied)

**Trạng thái:** chỉ kế hoạch. Không có zone/custom domain, không đổi WAF/Access/DNS trong M5.  
**Lưu ý:** WAF zone rules **không áp dụng** cho `*.workers.dev`; cần custom domain/zone khi được duyệt.

## 1. Thứ tự ưu tiên bảo vệ

1. Admin CMS + login (không khóa người vận hành).
2. Publishing API (không chặn AI client hợp lệ).
3. Database (giới hạn query/search nặng).
4. Public content (giữ SEO, chặn scraping hàng loạt).

## 2. Lớp đã có trong ứng dụng

- Bearer API key + scopes + review mode.
- Rate limit API theo IP (300/phút) và theo key (mặc định 60/phút) bằng DO.
- Login rate limit + lockout; CSRF; session/RBAC.
- Search DO rate 30/phút/IP; public limiter in-memory (best-effort).
- robots.txt + UA guard cho AI crawler; Googlebot/Bingbot được phép.
- CSP/security headers; sanitize nội dung; media upload 501.

## 3. Kế hoạch Cloudflare (chờ duyệt)

| # | Mục tiêu | Điều kiện dự kiến | Action | Free? | Rủi ro / rollback |
|---|---|---|---|---|---|
| 1 | Bảo vệ Admin | hostname/path `/admin/*`, `/admin/login` | Cloudflare Access (self-hosted app) | Có (Zero Trust Free, giới hạn user) | Chặn nhầm automation; rollback = tắt Access policy |
| 2 | Chặn brute-force login | `POST /admin/login` theo IP | Rate limit 10/phút → block 10s | Free: 1 rate-limit rule | Có thể khóa nhầm văn phòng NAT; theo dõi Security Events |
| 3 | Chặn path rác | path mẫu `/wp-admin`, `/.env`, `/phpmyadmin` | Block | Có (custom rules) | Thấp; rollback xóa rule |
| 4 | Bảo vệ API | `/api/v1/*` | **Không** challenge; ưu tiên app auth | — | Bật Bot Fight Mode có thể chặn API; xem mục 4 |
| 5 | Search scraping | `/tim-kiem` tần suất cao | App 429; WAF rate limit nếu còn quota rule | Hạn chế | Ảnh hưởng người dùng thật; dùng 429 + Retry-After |
| 6 | Hotlink ảnh | `/media/*`, `/images/*` referer ngoài | App referer check (R2) / WAF rule | Một phần | Ảnh Google/Bing cần allowlist; test kỹ |
| 7 | AI crawler | UA/bot AI | robots + app UA guard, không BFM | Có | Không chặn nhầm Googlebot; kiểm tra `cf.client.bot` |
| 8 | DDoS | toàn zone | Automatic | Có | Không cần cấu hình |

## 4. Bot Fight Mode

- Free, bật/tắt toàn domain, **không thể skip bằng custom rule**, có thể challenge API/mobile hợp lệ.
- **Không bật** cho đến khi:
  - Publishing API được kiểm chứng không bị challenge; hoặc
  - API tách hostname/zone riêng và có Access service token; hoặc
  - Chấp nhận dùng Super Bot Fight Mode (trả phí, ngoài ngân sách).
- Nếu bật nhầm: tắt BFM, kiểm tra 403/challenge trong Security Events, liên hệ client bị ảnh hưởng.

## 5. Cloudflare Access

- Có thể bảo vệ Worker qua hostname/path hoặc toàn Worker; hộp `workers.dev` cũng bảo vệ được.
- Kế hoạch: chỉ bảo vệ `/admin/*` và preview; public blog/API vẫn công khai.
- AI API không dùng Access trừ khi client hỗ trợ service token (`CF-Access-Client-Id/Secret`).
- Cần xác minh giới hạn user Free và luồng login trước khi bật.

## 6. WAF rule tối giản (khi có zone)

1. **Admin Access** (ưu tiên 1).
2. **Login rate limit** 10/phút/IP, block 10s.
3. **Block path rác** (wp-admin, .env, phpmyadmin, xmlrpc).
4. **Không challenge** `/api/v1/*`, `/sitemap.xml`, `/rss.xml`, `/robots.txt`.
5. **Search rate** nếu còn rule; nếu không, dựa vào app 429.
6. **Hotlink** chỉ sau khi test Google/Bing image proxy.

Mỗi rule phải có: mục tiêu, điều kiện, action, false-positive, SEO impact, API impact, rollback (disable rule), và thời gian quan sát 24–48h.

## 7. Không làm

- Không chặn Googlebot/Bingbot chỉ vì không có JS/cookie.
- Không captcha sitemap/RSS/robots.
- Không tắt chuột phải/DevTools như biện pháp bảo vệ.
- Không dùng User-Agent làm bằng chứng xác thực duy nhất.
- Không bật BFM khi chưa kiểm chứng API.
- Không thay đổi zone/WAF thật trong M5.

## 8. Chưa kiểm chứng

- Hành vi WAF/Access trên domain thật.
- Tương tác BFM với Publishing API.
- Giới hạn Access Free và service token.
- Hiệu quả chống scraping ở quy mô thật.

---

# M6 — FINAL WAF / BOT / ACCESS READINESS

## 9. Điều kiện kiểm chứng

- `workers.dev` **không có zone WAF**. Mọi kết luận WAF trên staging hiện tại là **NOT VERIFIED**.
- Muốn kiểm chứng cần **preproduction domain/zone** (subdomain của domain thật hoặc domain test) và quyền Zone WAF/Access.
- Không thay đổi DNS/zone/WAF thật trong M6.

## 10. Bộ rule tối giản đề xuất (áp dụng sau khi có zone)

| Ưu tiên | Rule | Biểu thức dự kiến | Action | Ghi chú |
|---:|---|---|---|---|
| 1 | Admin Access | hostname/path `/admin/*` | Access self-hosted app | Không bảo vệ `/api/v1/*` |
| 2 | Login rate | `POST /admin/login` theo IP | Rate limit 10/phút, block 10s | Free chỉ 1 rate-limit rule |
| 3 | Path rác | `/wp-admin`, `/.env`, `/phpmyadmin`, `/xmlrpc.php` | Block | False-positive thấp |
| 4 | Không challenge API/SEO | `/api/v1/*`, `/sitemap.xml`, `/rss.xml`, `/robots.txt` | Skip (nếu dùng SBFM) / không rule | BFM **không skip được** |
| 5 | Search abuse | `/tim-kiem` theo IP | App 429; WAF nếu còn quota | Không chặn người đọc |
| 6 | Hotlink ảnh | `/media/*`, `/assets/img/*` referer ngoài site/Google/Bing | Block | Test Google Images trước |
| 7 | AI crawler | UA/bot AI | robots + app UA guard | Không dùng BFM |

**Không bật Bot Fight Mode** trên zone có Publishing API cho đến khi chứng minh API client hợp lệ không bị challenge. BFM áp dụng toàn domain và không thể skip bằng custom rule.

## 11. Ma trận kiểm thử trên preproduction (chưa chạy)

| Test | Kỳ vọng | Cách đo |
|---|---|---|
| Googlebot/Bingbot | 200, không challenge | Request thật/verify log; không spoof UA |
| Người đọc thường | 200, không captcha | Browser ẩn danh |
| `/sitemap.xml`, `/rss.xml`, `/robots.txt` | 200 | curl/browser |
| Publishing API có Bearer hợp lệ | 200/201, không 403/1020 | API client thật |
| API thiếu/sai key | 401 | curl |
| Login sai 11 lần/phút | 429/block 10s | script nhỏ, không stress |
| Search 31 lần/phút | 429 | script nhỏ |
| Hotlink ảnh từ domain khác | 403 | trang test |
| Ảnh trong bài/site | 200 | browser |
| Access `/admin/*` | Chặn người ngoài, cho phép admin | browser + service token |
| Rollback rule | Tắt rule, traffic trở lại bình thường | toggle + 24h monitor |

## 12. Điều kiện cần phê duyệt

1. Cho phép tạo **preproduction domain/zone** để test WAF/Access (không phải production).
2. Cho phép cấu hình WAF/Access **chỉ trên preproduction**, không đụng zone thật.
3. Xác nhận có giữ BFM tắt cho đến khi API test PASS.
4. Nếu dùng Access cho automation: cấp service token và cách lưu secret.

**Hiện trạng:** app-level security PASS; Cloudflare WAF/Access/BFM **NOT VERIFIED**.
