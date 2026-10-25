# STATIC ASSETS MEDIA — FINAL REPORT

**Ngày:** 2026-10-25  
**Quyết định:** Cloudflare Workers Static Assets, $0, không R2/billing/provider ngoài.  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — version cuối `de86bd51-9170-456d-9990-c27822b6ed64` (operations gate).  
**Node app:** `f26d45d` — không thay đổi.  
**Không thực hiện:** production deploy, DNS/WAF zone thật, R2/billing, Workers Paid, GitHub repo mới, xóa ảnh legacy.

> **Operations gate:** xem `STATIC-ASSETS-OPERATIONS-GATE.md`; báo cáo này là implementation gốc.
>
> **Kết luận:** pipeline Static Assets hoạt động thật trên staging (process → deploy → verify → D1 READY → article/OG/Admin). Tuy nhiên đây là pipeline **trusted local runner**, không phải upload runtime; tự động 24/7 phụ thuộc máy runner. Production vẫn **chưa được phê duyệt** (asset cap + runner uptime + WAF).

---

## A. Implementation

| File | Vai trò |
|---|---|
| `migrations/0011_media_static.sql` | `storage_provider`, `storage_key`, `url`, `sha256`, `status`, `error`, `updated_at` + indexes |
| `src/media.js` | provider `static` (runtime upload disabled), R2 adapter giữ nguyên |
| `src/media-service.js` | serialize URL/status/provider; static ready resolution; usage sync; delete static blocked |
| `src/admin-routes.js` | media list/status/URL; legacy static; upload blocked message |
| `src/views/admin/media.js` | READY/PENDING/FAILED, public URL, delete disabled cho static/used |
| `src/api-v1.js` | `/media` trả 501 `media_static_deploy_required`; `cover_media_id` dùng media READY |
| `src/admin-data.js` | sync `media_usages` từ cover/OG/content sau save |
| `scripts/process-static-image.py` | validate signature/dimensions, EXIF transpose, strip metadata, WebP, SHA, source backup |
| `scripts/static-media-runner.mjs` | queue/batch, lock, asset guard, D1 status, deploy, verify, manifest/state |
| `public/_headers` | cache immutable cho `/media/articles/*`, cache ảnh/font |
| `docs/STATIC-ASSETS-MEDIA.md` | runbook/automation/capacity |

Không lưu binary trong D1/DO. Không Worker nào tự deploy; chỉ runner local có Cloudflare token.

---

## B. Media Pipeline — bằng chứng

Đã chạy trên staging với một ảnh test:

1. Tạo post draft qua Publishing API.
2. `process-static-image.py` tạo WebP 1200×800, 2.786 byte, SHA-256 `fd69d6c9…`.
3. Runner ghi `public/media/articles/<post>/<sha>.webp`, D1 `status=pending`.
4. `wrangler deploy` (version test `43685bd7…`).
5. Verify URL: **HTTP 200**, `Content-Type: image/webp`, tải về SHA-256 khớp.
6. D1 `status=ready`, `media_usages` có post.
7. PATCH post `cover_media_id` → 200; public article 200 có ảnh/OG.
8. Admin `/admin/media` 200: status READY, URL static, message runner.
9. Pending media thử `cover_media_id` → **409 media_not_ready**.
10. Upload lại cùng file → không tạo row/file trùng.
11. Asset guard: giới hạn test 1 → chặn trước deploy.
12. Cleanup test post/media/file + deploy cuối `c73bcbe1…`; legacy assets vẫn 200.

Evidence: `fixtures/static-assets-e2e.json`.

---

## C. Automation — trung thực

- Runner có `--queue` (batch nhiều job, một deploy), `--watch` (poll queue), lock và retry.
- **Không phải 24/7 độc lập:** máy Windows/local phải bật. Máy tắt → ảnh pending, không deploy, không READY.
- Không dùng GitHub Actions/CI mới, không tài khoản ngoài, không storage trả phí.
- AI remote không thể đẩy binary vào Static Assets; AI/runner phải cùng máy/shared inbox. API chỉ nhận metadata/`cover_media_id` sau READY.
- Admin browser không upload trực tiếp; UI hiển thị hạn chế + runner workflow, không có nút fake.
- Batch interval: `--watch --interval 300` (mặc định 5 phút); một deploy/batch, serialize bằng lock.
- Không có queue vô hạn: max 50 file/run, queue file local.

---

## D. Admin/API Parity

| Chức năng | Kết quả |
|---|---|
| List/search/preview/alt/usage/status/URL | **PASS** |
| Chọn cover/OG bằng URL | **PASS** |
| `cover_media_id` READY | **PASS** |
| `cover_media_id` PENDING | **PASS (409)** |
| Upload binary từ Admin | **BLOCKED** (Static Assets runtime) |
| Upload binary từ AI API | **BLOCKED**; dùng runner + READY |
| Delete ảnh đang dùng | **PASS (blocked)** |
| Delete ảnh static | Runner/manual only; Admin disabled |
| OCC/idempotency/external_id | **PASS** (regression) |

Không tuyên bố media upload API parity đầy đủ; binary ingestion là trusted runner, không phải HTTP API.

---

## E. Free Tier Capacity

Hiện tại: **198 asset entries** (Wrangler; 193 file vật lý: legacy JPG, 100 WebP variants, 20 WOFF2 + licenses, CSS/JS/favicon/placeholder/_headers). Giới hạn **20.000 file/version**, **25 MiB/file**, không reset.

Pipeline tạo **1 WebP/ảnh** (không variants cho upload mới). Còn ~19.302 file tới hard stop 19.500:

| Bài/ngày × ảnh | File/ngày | Ngày tới 19.500 |
|---|---:|---:|
| 10 × 1 | 10 | ~1.930 (~5,3 năm) |
| 10 × 2 | 20 | ~965 (~2,6 năm) |
| 30 × 3 | 90 | ~215 (~7 tháng) |
| 50 × 3 | 150 | ~129 (~4,3 tháng) |

Nếu 2 variants/ảnh: chia đôi; 3 variants: chia ba. 50×3×3 ≈ 43 ngày. **Không xóa ảnh cũ tự động.** Khi gần ngưỡng: archive ảnh không dùng, tách asset set/Worker, hoặc nâng giới hạn (không $0). Static Assets **không phù hợp vô hạn** ở 50 bài/ngày × 3 ảnh.

Khuyến nghị vận hành: ≤10 bài/ngày × 2 ảnh (an toàn >2 năm); 30×3 cần archive sau ~7 tháng; 50×3 cần kế hoạch trước ~4 tháng.

---

## F. Security

- Signature JPEG/PNG/WebP; reject SVG/GIF/AVIF; 8 MB, 8192px, 40MP; EXIF transpose; strip metadata.
- Post ID sanitize; hash filename; no path traversal/overwrite; source backup.
- SHA dedup; asset hard stop; lock; batch max 50; deploy only trusted runner.
- Token local env; không browser/AI/log/repo. Không binary D1/DO.
- Static asset public (by design); Admin delete disabled; usage sync prevents deleting used images.
- Rủi ro còn: runner machine compromise, token theft, asset cap, deploy failure; chưa test rollback/deploy failure/concurrent batch stress.

---

## G. Testing

| Test | Kết quả |
|---|---|
| Image process/hash/WebP | PASS local |
| Runner deploy/verify HTTP/type/checksum | PASS staging |
| Article/OG/Admin | PASS staging |
| Pending cover | PASS 409 |
| Dedup | PASS |
| Asset hard guard | PASS |
| Media service/policy | **18/18 PASS** |
| Adapter mock | **14/14 PASS** |
| Regression (M1/M2/M2.5/M3/M4/M5/security) | **215/215 PASS** (code build `1232950d`; final `c73bcbe1` chỉ đổi assets/headers) |
| Backup/restore | **24/24 PASS** |
| Deploy failure/rollback/concurrent batch | **NOT VERIFIED** |
| 24/7 automation | **BLOCKED/PARTIAL** (local runner) |
| WAF/Access | **NOT VERIFIED** |
| Production deploy | **NOT EXECUTED** |

Lighthouse/SEO/UI giữ kết quả M6 (home 96/100/100/100, a11y 100); media test asset đã dọn.

---

## H. Production Readiness

| Hạng mục | Trạng thái |
|---|---|
| Static media pipeline (local/staging) | **PASS** |
| Public delivery/checksum/cache | **PASS staging** |
| Admin library READY/URL/usage | **PASS** |
| AI/Admin binary upload | **BLOCKED** (Static Assets runtime) |
| 24/7 automation | **PARTIAL** (runner machine) |
| Free file capacity at 50×3 | **PARTIAL/AT RISK** (~4 months) |
| WAF/Access/zone | **NOT VERIFIED** |
| Production migration/cutover | **NOT EXECUTED** |

## Decision

**CONDITIONAL GO cho staging/tiền production; production chưa được phê duyệt.**

Điều kiện trước production:
1. Chấp nhận/duy trì trusted runner online hoặc có lịch chạy; nếu không, AI không tự deploy ảnh.
2. Chốt giới hạn ảnh/ngày và archive/tách asset trước 20k; 50×3 chỉ ~4 tháng.
3. Chấp nhận Admin không upload trực tiếp; AI binary qua runner.
4. Test deploy failure/rollback/concurrent batch; backup manifest/source.
5. WAF/Access preproduction + production cutover approval riêng.

## Decisions cần phê duyệt

1. Chấp nhận mô hình **trusted local runner** (không 24/7 nếu máy tắt)?
2. Chốt mức ảnh/ngày (khuyến nghị ≤10×2; 30×3 cần archive; 50×3 không bền vững)?
3. Chấp nhận Admin không upload trực tiếp và AI gửi ảnh qua runner?
4. Cho phép preproduction domain/WAF test?
5. Cho phép tạo production resources/cutover sau điều kiện?

Không có thay đổi production, DNS, WAF, R2/billing, Node app hoặc xóa ảnh legacy.
