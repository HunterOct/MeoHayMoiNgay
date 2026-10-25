# M7 — Preproduction Domain & WAF Plan

**Chỉ kế hoạch. Không đổi DNS/zone/WAF trong M7.**  
Domain thật chưa được xác nhận; `staging.<domain>` chỉ là placeholder.

## 1. Mục tiêu

Kiểm chứng trên một **preproduction subdomain thuộc Cloudflare zone**:
- Worker routing + SSL.
- WAF custom/rate rules.
- Cloudflare Access cho Admin.
- Publishing API không bị bot/WAF chặn.
- Googlebot/Bingbot + sitemap/RSS không bị ảnh hưởng.
- Rollback rule/domain nhanh.

`workers.dev` **không có zone WAF**; mọi kết luận WAF trên workers.dev là NOT VERIFIED.

## 2. Kiến trúc minh họa (chưa triển khai)

```text
staging.<domain>  (placeholder)
  → Cloudflare zone (DNS proxied)
  → Worker route / custom domain: meohay-staging
  → D1 staging riêng
  → DO SecureOps staging
  → Static Assets
```

Không dùng `staging.<domain>` thật cho đến khi bạn xác nhận domain/zone và phê duyệt.

## 3. DNS / SSL / routing

| Hạng mục | Kế hoạch | Rollback |
|---|---|---|
| DNS | Custom domain của Worker, proxied; không sửa A/CNAME thủ công nếu Cloudflare tự tạo | Xóa custom domain/route |
| SSL edge | Universal SSL; Full (strict) nếu có origin hợp lệ; Worker không cần origin cert | Giữ workers.dev trong thời gian test |
| TLS | Min TLS 1.2; Always Use HTTPS; HSTS chỉ sau khi test | Tắt HSTS/redirect nếu lỗi |
| Worker routing | `routes` custom_domain hoặc dashboard custom domain; tắt workers.dev nếu không cần | Giữ workers.dev làm fallback |
| Access | Chỉ `/admin/*`; không bảo vệ public/API | Xóa Access app/policy |
| Logs | Workers Logs + Security Events; không log Authorization/cookie | — |

## 4. WAF Free rule plan

Free: **1 rate-limiting rule** + custom rules; BFM toàn domain, **không skip được**.

| # | Rule | Điều kiện | Action | False positive | Rollback |
|---:|---|---|---|---|---|
| 1 | Admin Access | hostname preprod + path `/admin/*` | Access self-hosted | Automation admin | Xóa Access app |
| 2 | Login rate | `POST /admin/login` theo IP | Rate limit 10/phút, block 10s | NAT văn phòng | Tắt rule |
| 3 | Bad paths | `/wp-admin`, `/.env`, `/phpmyadmin`, `/xmlrpc.php` | Block | Thấp | Tắt rule |
| 4 | API/SEO no-challenge | `/api/v1/*`, `/sitemap.xml`, `/rss.xml`, `/robots.txt` | Không challenge | — | — |
| 5 | Search abuse | `/tim-kiem` theo IP | App 429; WAF nếu còn quota | Người đọc nhanh | Tắt rule |
| 6 | Hotlink | `/media/*`, `/assets/img/*` referer ngoài site/Google/Bing | Block | Google Images proxy | Tắt rule |
| 7 | AI crawler | UA/bot AI | robots + app UA guard | Googlebot | Kiểm tra `cf.client.bot` |

**Không bật Bot Fight Mode** trên preproduction có Publishing API cho đến khi test API client thật. BFM có thể challenge API/mobile; không thể skip bằng custom rule.

## 5. Security test cases (preproduction)

| Test | Kỳ vọng |
|---|---|
| Googlebot/Bingbot (request thật/verify) | 200, không challenge, sitemap/RSS 200 |
| Người đọc browser | 200, không captcha |
| Admin chưa đăng nhập | Access login/redirect |
| Admin đã đăng nhập | Dashboard 200 |
| Publishing API Bearer hợp lệ | 200/201, không 403/1020 |
| API thiếu/sai key | 401 |
| Login sai 11 lần/phút | 429/block 10s |
| Search 31/phút | 429 |
| Hotlink ảnh domain khác | 403 |
| Ảnh trong bài/site | 200 |
| Sitemap/RSS/robots | 200, đúng domain |
| Security headers | CSP/HSTS/nosniff/referrer đúng |
| WAF rule disable | Traffic trở lại bình thường trong 1–2 phút |
| Workers/D1/DO quota | Monitor không CRIT |

## 6. Rollback plan

1. Disable rule mới nhất trong WAF/Access.
2. Kiểm tra Security Events/Workers Logs 15–30 phút.
3. Nếu lỗi routing/SSL: xóa custom domain, quay lại workers.dev staging.
4. Nếu Access khóa nhầm: xóa policy/app hoặc thêm bypass tạm.
5. Không rollback bằng cách đổi DNS production; preproduction độc lập.

## 7. Điều kiện cần phê duyệt

1. Xác nhận domain/zone thật và quyền quản lý.
2. Phê duyệt tạo preproduction subdomain (không phải production).
3. Phê duyệt cấu hình WAF/Access **chỉ trên preproduction**.
4. Xác nhận giữ BFM tắt đến khi API test PASS.
5. Nếu cần service token Access cho automation: cấp và lưu local (không chat).

**Hiện trạng:** app-level security PASS; WAF/Access/BFM trên zone **NOT VERIFIED**.
