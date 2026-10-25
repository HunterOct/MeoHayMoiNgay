# Monitoring, Quotas & Alerts (Cloudflare Free)

**Công cụ:** `scripts/m5-monitor.mjs` — GraphQL Analytics + D1 REST + HTTP probes.  
**Chạy:**
```bash
node scripts/m5-monitor.mjs --hours 24
# tuỳ chọn: --worker <name> --db <id> --site <url> --backup <path>
```
Kết quả JSON: `fixtures/m5-monitor-latest.json`. Exit code `2` nếu có HIGH/CRIT.

## 1. Ngưỡng

| Ngưỡng | Ý nghĩa | Hành động |
|---:|---|---|
| 50% | Theo dõi | Ghi nhận xu hướng; tối ưu nếu tăng đều |
| 70% | Cảnh báo | Giảm tải/loại bỏ query nặng; chuẩn bị phương án |
| 85% | Cảnh báo cao | Tạm chặn scraping/API nặng; archive; điều chỉnh cron |
| 95% | Nguy cơ gián đoạn | Kích hoạt degradation, dừng client không thiết yếu, xử lý ngay |

- Workers requests/D1 rows tính theo **ngày UTC**; monitor quy đổi cửa sổ đo về 24h.
- D1 storage tính theo **database** (500 MB) và **account** (5 GB).
- DO requests tính theo ngày; DO storage/CPU theo dõi riêng.
- CPU P95 không phải quota ngày: mục tiêu vận hành **≤7 ms**, cảnh báo >7 ms, HIGH >10 ms (soft limit). Cold start thường làm P95 cao.

## 2. Metric đã thu thập

| Nhóm | Metric | Nguồn |
|---|---|---|
| Workers | requests, errors, subrequests, CPU P50/P95/P99 | `workersInvocationsAdaptive` |
| HTTP | phân bố status (401/403/429/5xx) | dimensions `status` |
| D1 | rows read/written, read/write queries, latency P50/P95, size | `d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups`, REST |
| DO | requests/errors/CPU P50/P95, memory P95, exceededCpu/Memory, rows, storage | `durableObjectsInvocationsAdaptiveGroups`, `durableObjectsPeriodicGroups`, `durableObjectsStorageGroups` |
| Cron | heartbeat, ok/error, tuổi heartbeat | `settings.cron_last_run` / `cron_last_error` |
| Backup | tồn tại, kích thước, tuổi, stale >7 ngày | filesystem |
| SEO/health | `/api/v1/health`, `/sitemap.xml`, `/rss.xml`, `/robots.txt` | HTTP probe |

Chưa thu thập được trực tiếp:
- WAF/zone analytics (chưa có custom domain/zone).
- Bot Fight Mode/Access logs.
- Workers Logs stream dài hạn (không dùng tail do timeout).
- Chi phí/hoá đơn (không bật billing).
- DO queueing/hibernation chi tiết.

## 3. Ưu tiên bảo vệ

Thứ tự nghiệp vụ:
1. **Admin + authentication** — không khóa người vận hành.
2. **Publishing API** — không mất bài/duplicate.
3. **Database** — không hỏng/không vượt writes.
4. **Public content** — giảm tải trước nếu cần.

Cloudflare Free **không cho đặt quota riêng/priority reservation** theo route. Vì vậy:
- Dùng rate limit application-level (API key/IP, login, search).
- Public limiter in-memory chỉ best-effort theo isolate, không phải quota toàn cục.
- Khi quota cạn, mọi request Worker có thể lỗi; không thể "hy sinh" public để cứu Admin bằng cấu hình Free. Cần chấp nhận rủi ro hoặc nâng gói (chưa được duyệt).

## 4. Graceful degradation hiện có

| Tình huống | Hành vi |
|---|---|
| API vượt rate | 429 + `Retry-After`, không ghi DB |
| Login vượt rate/lock | 429/khóa tạm, không lộ tài khoản tồn tại |
| Search vượt 30/phút/IP | 429 + `Retry-After` (DO) |
| Public HTML/feed vượt limiter isolate | 429 (best-effort) |
| D1 lỗi | API 500 generic; health 503; không trả "publish thành công" giả |
| DO lỗi | API 500 generic; client retry với idempotency |
| Cron lỗi | ghi `cron_last_error`, không publish một phần; monitor CRIT |
| Media chưa có | 501 rõ ràng, không giả success |
| Worker CPU vượt | request lỗi; không tự chuyển paid |

Chưa kiểm chứng hành vi khi **hết quota ngày** hoặc **D1 mất kết nối kéo dài**; cần diễn tập trên staging cô lập nếu được duyệt.

## 5. Cảnh báo

Hiện chưa cấu hình dịch vụ trả phí. Phương án $0:
- Chạy monitor thủ công mỗi ngày.
- Windows Task Scheduler/cron trên máy vận hành, ghi log + exit code.
- GitHub Actions scheduled workflow (nếu repo được phép) dùng secrets; chỉ đọc metric, không deploy.
- Gửi cảnh báo qua email/webhook miễn phí nếu có; chưa bật.

Nếu máy chạy monitor tắt, không có cảnh báo chủ động. Cron heartbeat và Time Travel vẫn hoạt động độc lập.

## 6. Log & dữ liệu nhạy cảm

- Không log Authorization, cookie, API key, password hash, token, nội dung nhạy cảm.
- Log cron dạng JSON: `event`, `selected`, `published`, `cleanup`, `ms`; lỗi chỉ message rút gọn.
- API trả `request_id`; audit log lưu actor/action/entity, không lưu secret.
- Monitor chỉ đọc metric tổng hợp, không đọc nội dung bài.

## 7. Runbook khi vượt ngưỡng

1. Xác định metric và cửa sổ thời gian từ JSON.
2. Nếu 401/403 tăng: kiểm tra client/key rotation, không khóa nhầm.
3. Nếu 429 tăng: điều chỉnh client, không tăng vô hạn rate limit.
4. Nếu D1 reads cao: kiểm tra query/list/search, bật giới hạn phân trang.
5. Nếu D1 writes cao: kiểm tra retry loop/idempotency, cron batch.
6. Nếu storage gần 500 MB: archive revision/audit cũ, cân nhắc DB mới (chưa tự động sharding).
7. Nếu CPU P95 cao: kiểm tra cold start/payload; rollback version nếu regression.
8. Nếu cron heartbeat cũ: kiểm tra trigger, D1, lỗi; chạy publish thủ công có kiểm soát.
9. Nếu backup stale: chạy backup ngay, kiểm tra ổ đĩa/quyền/token.

---

# M6 — FINAL OBSERVABILITY NOTES

- Thêm đo cold start bằng `scripts/m6-cold-probe.mjs`; route-level bằng `scripts/m6-route-bench.mjs`.
- Startup time build cuối: **12–16 ms** (Wrangler); cold probe 10 request: avg 9,32 ms, P50 4,63, P95/P99 27,75, 0 errors.
- Warm route P95 **chưa chứng minh ≤7 ms** ở low traffic; request đầu mỗi colo/isolate vẫn cold. Không thay thế CPU bằng wall time.
- Snapshot 24h cuối: 8.113 request, CPU P50 5,00 / P95 17,69 ms, 0 error; D1 1,64M reads / 55,3k writes; DO 4.005 request, memory P95 40,3 MiB; cron heartbeat OK.
- Lighthouse home: Perf 96 / A11y 100 / BP 100 / SEO 100; article LCP 1,7 s; admin login A11y 100.
- Image delivery savings 2.091 KiB → 139 KiB.
- WAF/Access/BFM vẫn **NOT VERIFIED** vì không có zone.
