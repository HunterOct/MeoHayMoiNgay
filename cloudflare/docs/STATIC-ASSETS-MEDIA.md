# Static Assets Media — Implementation & Operations

**Quyết định:** Cloudflare Workers Static Assets, $0, không R2/không billing.  
**Trạng thái:** staging implementation/test PASS; production not approved.

## 1. Kiến trúc

Static Assets là file trong `public/`, đóng gói theo Worker deployment. Worker **không thể ghi file mới lúc runtime**. Vì vậy dùng trusted local runner:

```text
AI/Admin/ops
  → media-inbox/ hoặc queue JSON
  → scripts/static-media-runner.mjs
      → scripts/process-static-image.py (Pillow)
      → public/media/articles/{post_id}/{sha256}.webp
      → D1 media status=pending
      → wrangler deploy (Static Assets)
      → verify HTTP 200 + image/webp + SHA-256
      → D1 status=ready + media_usages
  → CMS/API dùng cover_media_id/url
```

- **Không** lưu binary trong D1/DO.
- **Không** worker nào tự deploy; chỉ trusted runner có Cloudflare token.
- Nguồn gốc ảnh lưu ở `media-source/articles/{post}/{sha}.{ext}`; manifest/checksums ở `media-source/manifest.json`.
- URL content-hash: `/media/articles/{post_id}/{sha256}.webp` → cache immutable qua `public/_headers`.
- Thư mục legacy/variants hiện có giữ nguyên.

## 2. Pipeline runner

```bash
# Một ảnh / một post (deploy ngay)
node scripts/static-media-runner.mjs --post <post_id> --alt "Mô tả" --file path/to/image.jpg

# Batch nhiều job trong queue (một deploy)
node scripts/static-media-runner.mjs --queue media-inbox/queue

# Chỉ xử lý/ghi pending, không deploy
node scripts/static-media-runner.mjs --post <post_id> --file x.jpg --no-deploy

# Watch queue (local machine phải chạy)
node scripts/static-media-runner.mjs --watch media-inbox/queue --interval 300
```

Tính năng:
- JPEG/PNG/WebP; signature + dimensions + 8 MB + 40 MP; EXIF orientation; strip metadata; WebP quality 82, max width 1600.
- SHA-256 dedup; filename content-hash; source backup; manifest.
- Một WebP/ảnh (không tạo nhiều variants cho upload mới) để tiết kiệm file.
- Lock `.media-pipeline.lock` serializes deploys; asset count preflight (warn 18.000, hard stop 19.500).
- D1 status pending → deploy → verify → ready/failed; usage insert; retry an toàn.
- Queue file `.json` `{post_id, alt, files:[...]}`; job thành công chuyển `processed/`, lỗi `failed/`.

## 3. Giới hạn tự động hóa

- **Không phải 24/7 độc lập**: runner là tiến trình local/Windows; máy tắt thì ảnh không được deploy. Không có GitHub Actions/CI mới, không external storage.
- AI phải gửi file vào inbox/queue trên máy runner (hoặc gọi runner cùng máy). AI remote chỉ có API metadata không thể đẩy binary vào Static Assets.
- Browser Admin **không upload trực tiếp** tới Worker (Static Assets không ghi runtime). Admin hiển thị ảnh READY và hướng dẫn runner; không có nút upload giả.
- Publishing API `/media` trả 501 `media_static_deploy_required`; AI tạo draft không ảnh trước, sau khi media READY dùng `cover_media_id`/URL rồi publish. OCC/idempotency giữ nguyên.
- Có thể chạy runner định kỳ bằng Task Scheduler; vẫn phụ thuộc máy.

## 4. Admin/API parity

| Chức năng | Trạng thái |
|---|---|
| List/search/preview ảnh ready | PASS (D1 + legacy) |
| Status pending/ready/failed | PASS |
| URL công khai/alt/usage | PASS |
| Chọn cover/OG bằng URL | PASS |
| `cover_media_id` với media ready | PASS |
| `cover_media_id` pending | 409 `media_not_ready` |
| Upload binary từ browser/AI API | **BLOCKED** (Static Assets) |
| Delete ảnh đang dùng | Blocked 409/disabled |
| Delete ảnh static | Runner/manual only; Admin không xóa file deploy |

## 5. Static Asset capacity

Hiện tại: **198 asset entries** (Wrangler read; 193 file vật lý + asset metadata) trong `public/` (gồm 60 ảnh legacy, 100 WebP variants, 20 font WOFF2, CSS/JS/favicon/placeholder/_headers). Giới hạn Free 20.000 file/version, 25 MiB/file.

Pipeline mới thêm **1 file/ảnh** (không variants). Thời gian tới hard stop 19.500 (nếu không xóa ảnh cũ):

| Bài/ngày × ảnh | File/ngày | Ngày tới 19.500 | Ghi chú |
|---|---:|---:|---|
| 10 × 1 | 10 | ~1.930 ngày (~5,3 năm) | An toàn |
| 10 × 2 | 20 | ~965 ngày (~2,6 năm) | An toàn |
| 10 × 3 | 30 | ~644 ngày (~1,8 năm) | Theo dõi |
| 30 × 1 | 30 | ~644 ngày | Theo dõi |
| 30 × 2 | 60 | ~322 ngày | Cần kế hoạch |
| 30 × 3 | 90 | ~215 ngày (~7 tháng) | Cần archive/limit |
| 50 × 1 | 50 | ~386 ngày | Theo dõi |
| 50 × 2 | 100 | ~193 ngày (~6,4 tháng) | Cần archive/limit |
| 50 × 3 | 150 | ~129 ngày (~4,3 tháng) | **Không bền vững** |

Nếu tạo 2–3 variants/ảnh, chia thời gian cho 2–3. Pipeline hiện chỉ tạo 1 WebP/ảnh để giảm file.

**Không tự xóa ảnh cũ.** Khi gần giới hạn: archive ảnh không dùng/không còn bài, tách asset set/Worker, hoặc nâng giới hạn (không có trong $0). Static Assets không reset hàng tháng.

## 6. Backup/recovery

- Source ảnh + manifest/checksum ở `media-source/` (local).
- D1 metadata backup theo runbook; phải backup cùng manifest.
- Static Assets theo Worker version; rollback version có thể làm mất asset mới nếu asset chỉ có ở version mới. Giữ source + deploy lại để phục hồi.
- Không coi deployment hiện tại là bản backup duy nhất.

## 7. Security

- Chỉ trusted runner có token; token không vào browser/AI client/log/repo.
- Validate signature, size, dimensions, pixel count, path; post_id sanitize; filename hash; không SVG/GIF/AVIF.
- Dedup theo SHA; không overwrite legacy; source backup.
- Asset count guard; lock; deploy serialization.
- Không worker nhận binary; API 501 rõ ràng.

## 8. Tested

- Local processor: JPEG→WebP, dimensions, hash, source backup.
- Runner deploy test asset: HTTP 200, `image/webp`, checksum match; article render/OG; Admin media ready/URL; pending `cover_media_id` →409; duplicate → no duplicate row/file; asset hard guard; cleanup + final deploy restores 70 posts/26 tags.
- Evidence: `fixtures/static-assets-e2e.json`.
- Rollback/deploy failure/concurrent batch: **NOT VERIFIED**; lock implemented but not stress-tested.

## 9. Operations gate additions

- **Code pinning:** runner hashes `src/`, `migrations/`, non-media `public/`, `wrangler.remote.jsonc`, package files. Before deploy, nếu hash khác `settings.media_code_hash` và không có `--allow-code-change`, runner dừng. Sau deploy code hợp lệ, chạy `node scripts/static-media-runner.mjs --record-code-hash` (hoặc `--allow-code-change` một lần) để cập nhật.
- **Audit:** `node scripts/static-media-runner.mjs --audit` in ra asset count, bytes, orphan files, missing files, duplicate content hashes, media status; cập nhật `media_asset_count/limit`.
- **Retry:** job lỗi nằm ở `queue/failed/`; `--retry-failed` đưa lại queue. Pending media rows được tái sử dụng, không tạo trùng.
- **Image cap:** mặc định 2 ảnh mới/post (`MEDIA_MAX_IMAGES_PER_POST=2`); `--allow-more-images` chỉ khi có chủ đích; bài cũ không bị sửa.
- **Admin:** banner asset count/limit từ settings; cảnh báo khi ≥90% hard limit.
- **Deploy failure:** runner đánh dấu failed, giữ source backup, có thể retry; deploy failure/rollback chưa stress-test.
- **Code deploy:** media deploy vẫn upload code hiện tại; code hash guard ngăn source cũ ghi đè code mới nếu hash đã được ghi nhận.
