# M6 — FINAL HARDENING & PRODUCTION READINESS

**Ngày:** 2026-10-25  
**Ứng dụng Node gốc:** `f26d45ded8e31b38c5d30440cbc04cda6313d2c3` — không thay đổi.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — version cuối `3d782585-b039-423f-861f-2ec7c7679db9`.  
**Phạm vi:** M6 staging only. Không production, DNS, zone/WAF thật, R2/billing/Paid, không sửa Node app, không xóa staging.

> **Kết luận ngắn:** M6 đã hoàn tất phần hardening có thể làm trong $0/staging. Media upload vẫn **BLOCKED** (chưa có provider được duyệt); WAF/Access chưa kiểm chứng trên zone thật; CPU P95 low-traffic vẫn >7 ms. **Production chưa được phê duyệt.** Quyết định: **CONDITIONAL GO** cho tiếp tục chuẩn bị; **production vẫn NO-GO** cho đến khi xử lý các điều kiện ở mục I.

---

## A. Executive Summary

Đã hoàn thành:

- **Media abstraction provider-agnostic**: `MEDIA_PROVIDER=none` mặc định; adapter R2 chỉ bật khi có cả provider + binding; validation MIME/kích thước/dimensions; rollback object nếu ghi metadata lỗi; admin/API dùng chung service; không fake success.
- **Ảnh responsive**: 100 biến thể WebP (480/960/1600) cho 60 ảnh legacy, `<picture>`/`srcset`/`sizes`, preload hero theo `imagesrcset`, width/height thật, lazy/async, fallback ảnh lỗi.
- **Font self-host**: 20 WOFF2 (Be Vietnam Pro + Playfair Display), bỏ Google Fonts, preload font chính, kèm license OFL.
- **Accessibility**: heading hierarchy, list semantics, slider dots 24px, labels, admin main/skip-link, contrast dark mode; Lighthouse Accessibility home/article/admin-login **1.00**.
- **Cold start**: tách `plainText` khỏi sanitizer; lazy-load `sanitize.js`, `zod`, scrypt; startup **12–16 ms** (M5 ~37 ms).
- **Content image policy**: chỉ HTTPS hoặc path nội bộ; ảnh `http://` bị loại khỏi content HTML; cover/OG HTTP bị từ chối.
- **Capacity & WAF planning**: mô hình 1k–100k bài, 10–100 bài AI/ngày; WAF Free rule plan + preproduction test matrix.
- **Regression cuối**: **215/215 PASS**; media 18/18; backup/restore verify 24/24.

Chưa hoàn thành / chưa kiểm chứng:

- Dynamic media upload vẫn **501** (chưa có provider/billing được duyệt).
- WAF/Access/Bot Fight Mode **NOT VERIFIED** (không có zone).
- CPU P95 low-traffic vẫn >7 ms do cold isolates; chưa có load test đại diện.
- Chưa có alert tự động; backup automation vẫn phụ thuộc máy ngoài.

---

## B. Media Decision

### So sánh (2026-10-25)

| Phương án | Free | Billing | Upload động | Rủi ro | Kết luận |
|---|---|---|---|---|---|
| **Cloudflare R2** | 10 GB, 1M Class A, 10M Class B; egress free | **Cần R2 subscription/billing** | Có (S3/Worker binding) | Overage billed; cần budget alert | **Chính** |
| Backblaze B2 | 10 GB, không cần thẻ | Overage/egress theo B2 | Có (S3 API) | Provider ngoài, secret, egress | **Dự phòng** |
| Supabase Storage | 1 GB, 5 GB egress, file ≤50 MB | Free | Có | 1 GB quá thấp | Không chọn |
| Cloudinary | ~25 credits/tháng | Free có điều kiện | Có | Credit/transform, không phải object storage thuần | Không chọn |
| Workers Static Assets | 20k file/25 MiB | Không | Không | Phải rebuild/deploy | Chỉ ảnh build-time |
| External HTTPS URL | $0 | Không | Không | Ảnh mất/hotlink/bản quyền | Tạm thời |

### Đã triển khai
- `src/media-policy.js`: validate MIME (sniff), ≤8 MB, ≤8192×8192, ≤40 MP, alt/filename.
- `src/media.js`: provider interface; **yêu cầu rõ** `MEDIA_PROVIDER`; `none` mặc định; `r2` cần binding `MEDIA`.
- `src/media-service.js`: put → metadata; metadata lỗi → xóa object; delete kiểm tra usage; cover media ID resolve.
- Admin/API: 501/redirect rõ ràng khi disabled; không fake upload.
- `cover_media_id` chỉ hoạt động khi provider bật; nếu không 501/400.
- Referer ảnh: same-origin + Google/Bing; không fetch URL server-side.
- Config staging/production mẫu: `MEDIA_PROVIDER=none`.

### Cần phê duyệt
1. Chọn **R2** (khuyến nghị) hay **Backblaze B2** hay không dynamic upload.
2. Có bật R2 subscription/billing + budget alert không.
3. Nếu không bật billing: chấp nhận phát hành không có dynamic upload? (Nếu ảnh là cốt lõi → không).
4. Cấp secret/bucket production sau khi duyệt (không thực hiện trong M6).

---

## C. Performance

Chi tiết: `docs/PERFORMANCE.md`. Tóm tắt:

| Metric | Kết quả |
|---|---|
| Worker startup | **12–19 ms** (M5 ~37 ms) |
| Cold probe 10 request | avg 9,32 ms; P50 4,63; P95/P99 **27,75 ms**; 0 errors |
| Warm/home P50 | ~3,9–4,4 ms (một số nhóm) |
| CPU P95 low-traffic | **>7 ms**, bị cold isolate/colo chi phối |
| DO | 0 exceeded CPU/memory; memory P95 40,3 MiB |
| D1 | 24h test traffic: 1,64M reads / 55,3k writes; DB 3,67 MB |
| Lighthouse home | Perf **96**, A11y **100**, BP 100, SEO 100; LCP **2,0 s**, CLS 0,017 |
| Lighthouse article | Perf 86–98 (network variance), A11y 100, LCP **1,7 s**, CLS 0,012 |
| Image delivery savings | **2.091 KiB → 139 KiB** |

**Đánh giá:** tối ưu cold start và ảnh/font có bằng chứng rõ. **Chưa chứng minh P95 ≤7 ms** cho mọi route ở low traffic; cần traffic thật hoặc test nhiều colo. Không thay thế CPU bằng wall time (wall P95 có lúc >20 s do mạng).

---

## D. UI & Accessibility

Đã sửa:
- Heading order: footer/widget/checklist dùng h3; error page h2.
- Checklist: `<li><button>` thay vì `li role=button`; keyboard native; `aria-pressed` đúng.
- Slider dots: hit target 24×24, `role=group` thay vì tablist thiếu tab con.
- Bỏ `aria-label` trùng trên card/hero (label-content-name mismatch).
- Admin login: self-host font, `<main>`, dark-mode button contrast.
- Admin: skip-link + `main id`, label cho content format.
- Ảnh: alt, width/height, lazy, fallback.

Kết quả:
- Lighthouse Accessibility: home **1,00**, article **1,00**, admin login **1,00**.
- Admin DOM audit: 0 field thiếu label, 0 ảnh thiếu alt, 0 control thiếu tên ở các trang load thành công.
- Screenshot: `screenshots-m6/` (home desktop/mobile/light/dark, article mobile, category, admin login/dashboard/posts/editor/mobile).

Còn lại: bảng admin mobile cần cuộn ngang; chưa test screen reader thật (NVDA/VoiceOver); chưa audit toàn bộ dark contrast trên mọi component.

---

## E. Security & WAF

- App-level: auth/RBAC/CSRF/session, scopes, rate limit, OCC, idempotency, sanitize — regression PASS.
- Content image: chỉ HTTPS/path nội bộ; `http://` bị loại; cover/OG HTTP bị 400.
- Media provider disabled rõ ràng; `/media` 404 khi chưa cấu hình; không lộ secret.
- `/api/m0/*` bị chặn khi `ENVIRONMENT=production` (M5 hardening, giữ nguyên).
- **WAF/Access/BFM: NOT VERIFIED**. Không có zone/custom domain; không thay đổi DNS/WAF.
- BFM không thể skip Publishing API → **không bật** đến khi test preproduction.
- WAF plan: Access `/admin/*`, 1 rate-limit rule login, block path rác, không challenge API/SEO, hotlink sau test Google/Bing. Xem `docs/WAF-SECURITY-PLAN.md`.

---

## F. Capacity

Chi tiết: `docs/CAPACITY.md`.

| Số bài | 150 KB/bài | 44 KB/bài | DB 500 MB | Free |
|---:|---:|---:|---:|---|
| 1.000 | 150 MB | 44 MB | 1 | OK |
| 5.000 | 750 MB | 220 MB | 2 | OK |
| 10.000 | 1,5 GB | 440 MB | 3 | OK có giám sát |
| 25.000 | 3,75 GB | 1,1 GB | 8 | Gần trần |
| 50.000 | 7,5 GB | 2,2 GB | 15 | FAIL ở 150 KB |
| 100.000 | 15 GB | 4,4 GB | 30 | **FAIL** |

- Free: 500 MB/DB, 5 GB/account, **10 DB/account**.
- Ngưỡng an toàn: ≤70% (3,5 GB; ~350 MB/DB).
- AI 10/30/50 bài/ngày an toàn; 100 bài/ngày vượt 5 GB sau ~1 năm nếu 150 KB/bài.
- Media 100 bài/ngày × 3 ảnh × 200 KB ≈ 1,8 GB/tháng; R2 Free 10 GB đủ ~5–6 tháng nếu không lifecycle.
- 1M pageview/tháng an toàn; 3M sát trần Workers; 10M không khả thi Free.

### Cloudflare Free limits (revalidated 2026-10-25)

| Dịch vụ | Giới hạn |
|---|---|
| Workers | 100k request/ngày; 10 ms CPU/request; 128 MB; 50 external subrequests; 20k static assets/version, 25 MiB/file; 5 cron/account |
| D1 | **500 MB/database; 5 GB/account; 10 database/account**; 5M rows read/day; 100k rows written/day; 7 ngày Time Travel; 10 restore/10 phút/DB; row 2 MB |
| Durable Objects | 100k request/ngày; 13.000 GB-s/ngày; SQLite-only Free; 5 GB storage/account |
| R2 | 10 GB-month; 1M Class A; 10M Class B; egress free; **cần R2 subscription/billing** |
| WAF Free | Custom rules + **1 rate-limiting rule**; Bot Fight Mode không skip được |
| Access | Zero Trust; bảo vệ được hostname/path/Worker; chưa bật/kiểm chứng |

---

## G. Regression

| Bộ test | Kết quả |
|---|---|
| M1 public consistency | **42/42** |
| M2 Admin functional | **74/74** |
| M2 security | **17/17** |
| M2.5 API client/settings/retention | **16/16** |
| M3 Publishing API | **28/28** |
| M4 OCC | **12/12** |
| M5 bulk/delete/restore/purge/idempotency/cron race | **26/26** |
| **Tổng** | **215/215** |
| Media service/policy (local) | **18/18** |
| Backup/restore verify (independent DBs) | **24/24** |
| SEO | M1 + Lighthouse SEO 100 |
| UI smoke | screenshot + browser scroll (0 broken ảnh), checklist toggle OK |
| Media fallback | 501 API disabled; broken image → placeholder OK |
| Cron | heartbeat OK, scheduled tests PASS |
| Monitoring | health/SEO 200, cron heartbeat <15m |

So với baseline M5 215/215: **không regression**. Test không chạy: WAF/Access thật, load test lớn, hết quota, D1 mất kết nối kéo dài, production cutover, dynamic media upload thật.

---

## H. Production Blockers

### P0 — Bắt buộc trước production
1. **Dynamic media upload chưa hoạt động** (provider/billing chưa duyệt). Nếu blog AI cần ảnh tự động, không thể production.
2. **100.000 bài không khả thi** trên Free nếu đây là yêu cầu cứng (500 MB/DB, 5 GB/account, 10 DB).

### P1 — Rủi ro đáng kể
1. WAF/Access/BFM chưa kiểm chứng trên domain/zone thật; BFM có thể chặn Publishing API.
2. CPU P95 low-traffic >7 ms; chưa chứng minh dưới tải đại diện.
3. Chưa có alert tự động (email/webhook), backup automation phụ thuộc máy ngoài.
4. Chưa diễn tập restore/rollback production; rollback hạ tầng về Node chưa kiểm chứng.
5. Restore session có thể resurrect session cũ; cần invalidate sau restore.
6. Bulk nhiều bài không phải transaction all-or-nothing; race hiếm có thể để lại partial + cảnh báo/audit.

### P2 — Sau production
1. Mobile admin table scroll/UX; screen-reader audit đầy đủ; dark contrast toàn bộ.
2. Revision/audit retention policy; DO queue/hibernation metrics; cache public.
3. Fuzz HTML/Markdown 200k; load test theo colo.
4. Tối ưu thêm LCP/TBT; AVIF nếu có encoder.

---

## I. Final Go / No-Go

# **CONDITIONAL GO**

M6 đã hoàn thành hardening trong phạm vi staging. **Đây không phải GO production.** Production vẫn **NO-GO** cho đến khi:

1. Chọn và phê duyệt media storage (R2/B2) hoặc chấp nhận bản phát hành không dynamic upload.
2. Nếu R2: duyệt billing + budget guard; tích hợp adapter, test upload/delete/backup.
3. Có preproduction domain/zone để test WAF/Access/BFM; xác nhận không chặn API/SEO.
4. Có bằng chứng CPU P95 ≤7 ms dưới traffic đại diện hoặc chấp nhận rủi ro có giám sát.
5. Bật backup automation + alert; diễn tập restore/rollback.
6. Phê duyệt production resources/cutover riêng.

## Decisions needed from you

1. **Media**: R2 (khuyến nghị), Backblaze B2, hay không dynamic upload?
2. **R2 billing**: có cho phép bật subscription/budget alert không?
3. **Limited release**: có chấp nhận phát hành chỉ ảnh legacy + external HTTPS URL không? (Nếu ảnh là cốt lõi → không.)
4. **WAF test**: có cho phép tạo preproduction domain/zone và cấu hình WAF/Access chỉ ở đó không?
5. **Production resources/cutover**: có cho phép tạo production D1/Worker và cutover sau khi các điều kiện trên đạt không?

Không có thay đổi production, DNS, WAF, R2/billing, Node app hoặc xóa staging nào được thực hiện.

### Tài liệu tham khảo
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Bot Fight Mode: https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
- Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing
- Supabase pricing: https://supabase.com/pricing
- Cloudinary pricing: https://cloudinary.com/pricing

---

**M6 ĐÃ HOÀN THÀNH TRONG PHẠM VI STAGING — ĐANG CHỜ QUYẾT ĐỊNH MEDIA STORAGE VÀ PHÊ DUYỆT PRODUCTION.**
