# STATIC ASSETS OPERATIONS GATE

**Ngày:** 2026-10-25  
**Staging:** `https://meohay-m0-stg-230403.poseidonxx001.workers.dev` — version UI follow-up `18bd488b-b69d-44d9-9008-d99b67e0df08` (ops-gate build `de86bd51` + bỏ số bài/nút xem tất cả public)  
**Media:** Cloudflare Workers Static Assets, $0, no R2/billing/provider ngoài.  
**Node app:** `f26d45d` — không thay đổi.  
**Không thực hiện:** production deploy, DNS, WAF zone, R2/billing, GitHub repo/workflow, xóa ảnh legacy.

> **Kết luận:** pipeline Static Assets hoạt động thật trên staging và đã chặn publish khi ảnh chưa READY. Tuy nhiên mô hình vận hành vẫn là **trusted local runner**, không phải dịch vụ 24/7; asset cap 20.000 file là giới hạn thật. **Production: CONDITIONAL GO** cho mô hình local-runner có kiểm soát; **NO-GO cho tự động hoàn toàn 24/7 từ AI remote** nếu không có runner/CI + nguồn ảnh bền vững được duyệt.

---

## A. Operational Readiness

Đã bổ sung:

- **Queue/batch**: `--queue <dir>` gom nhiều job, một deploy; `--watch --interval 300` poll queue; max 50 file/run.
- **Lock**: `.media-pipeline.lock` serialize deploy; lock cũ >30 phút được coi là stale.
- **Pending recovery**: D1 media status `pending`; runner tìm theo `sha256`, tái sử dụng row/file, không tạo trùng.
- **Retry**: job lỗi chuyển `queue/failed/`; `--retry-failed` đưa lại queue.
- **Code pinning**: hash `src/`, `migrations/`, non-media `public/`, config/package; nếu khác `settings.media_code_hash` và không có `--allow-code-change`, runner dừng. `--record-code-hash` sau deploy code.
- **Audit**: `--audit` báo asset count/bytes, orphan files, missing files, duplicate content hashes, media status; ghi `media_asset_count/limit` vào D1.
- **Admin**: banner `Static Assets: 193 / 19500 file`; cảnh báo ≥90% hard stop.
- **Publish gate**: `cover_media_id` pending →409; URL `/media/...` pending trong cover/OG/content khi publish/schedule →409 `media_not_ready` (tested). Draft/review vẫn cho phép chờ ảnh.
- **Usage**: sync `media_usages` từ cover/OG/content; ảnh đang dùng không xóa được.

### Tình huống vận hành

| Tình huống | Kết quả | Ghi chú |
|---|---|---|
| Windows + runner đang chạy | **PASS** | test deploy/verify thật |
| Máy tắt trước khi AI gửi bài | **PARTIAL** | draft/queue file phải còn trên máy runner/shared disk; AI remote không đẩy binary |
| Máy tắt giữa xử lý | **PARTIAL** | D1 pending + source backup + queue còn; lock stale 30m; chưa kill-test |
| Mất mạng lúc deploy | **PARTIAL** | deploy lỗi được bắt, status failed, retry; chưa mô phỏng media deploy failure |
| Runner restart sau nhiều giờ | **PARTIAL** | queue/pending reuse; stale lock code; chưa test thời gian dài |
| Nhiều bài chờ | **PARTIAL** | batch ≤50, một deploy; chưa load-test |
| Deploy thành công, client mất phản hồi | **PARTIAL** | D1 pending/failed + retry; chưa mô phỏng |
| AI retry cùng bài | **PASS** | idempotency API + SHA dedup; không duplicate row/file |
| Không mất ảnh cũ | **PASS** | deploy lại giữ legacy; test asset cleanup + final deploy |
| Không publish ảnh pending | **PASS** | pending cover/URL →409 |
| Không deploy code cũ | **PASS (guard)** | code hash guard; chưa fault-inject |

**Giới hạn được chấp nhận:** runner phải chạy trên máy Windows/local. Nếu máy tắt, AI có thể tạo draft nhưng ảnh không READY/deploy; không có 24/7 tự động.

---

## B. Automation Decision

### GitHub Actions Free (không triển khai)

- Private repo Free: **2.000 phút/tháng**, **500 MB artifact/storage** (theo tài liệu hiện hành); public repo không phù hợp vì code/metadata.
- GitHub Actions **không tạo kho ảnh bền vững**: artifact có hạn, repo chứa binary làm tăng clone/build; cần object storage/LFS (LFS free hạn chế) → không đáp ứng $0 sạch.
- Cần trigger + image source trước workflow; AI remote không thể đẩy binary nếu không có repo token/storage.
- Token Cloudflare phải là secret; workflow có thể deploy source cũ nếu checkout sai commit; cần pin SHA, environment approval.
- Không tạo repo/workflow thực tế.

### Quyết định

**Chọn A — trusted local runner** cho blog nhỏ/$0:
- Đơn giản, không repo mới, không CI quota, không lộ code.
- Batch/lock/audit/code pin/retry đã có.
- Chấp nhận máy runner phải bật; nếu cần 24/7, cần phê duyệt B (CI + nguồn ảnh bền vững) hoặc C (local + CI dự phòng), không tự triển khai.

---

## C. Media Capacity

- Wrangler reads **198 asset entries** (193 file vật lý; gồm legacy JPG, 100 WebP variants, 20 WOFF2 + licenses, CSS/JS/favicon/placeholder/_headers).
- Giới hạn Free **20.000 file/version, 25 MiB/file**, không reset.
- Audit hiện tại: 193 file, 0 media file/row (test asset đã dọn); hard limit 19.500, warn 18.000.
- Pipeline tạo **1 WebP/ảnh**, không variants; default **2 ảnh mới/post**; không tự xóa ảnh cũ.

| Bài/ngày × ảnh | File/ngày | Ngày tới 19.500 |
|---|---:|---:|
| 10 × 2 | 20 | ~965 (~2,6 năm) |
| 30 × 3 | 90 | ~215 (~7 tháng) |
| 50 × 3 | 150 | ~129 (~4,3 tháng) |

Nếu tạo 2–3 variants/ảnh, chia thời gian cho 2–3. Khi gần ngưỡng: dừng nhận ảnh, archive ảnh không dùng, tách asset set/Worker; không xóa ảnh đang dùng. Static Assets không phù hợp vô hạn ở 50×3.

---

## D. End-to-End Result

Đã test staging:

1. AI/API tạo draft (không ảnh).
2. Ảnh đưa vào inbox local (manual/local workflow — **không phải AI remote tự gửi binary**).
3. Runner validate/process WebP + SHA + source backup.
4. Deploy Static Assets.
5. Verify HTTP 200, `image/webp`, checksum SHA-256.
6. D1 READY + usage.
7. API PATCH `cover_media_id` + publish; article 200 có ảnh; OG image đúng; Admin media READY/URL.
8. Pending media publish → **409 media_not_ready** (tested final build).
9. Dedup, asset hard guard, queue/lock/audit/code hash tested ở mức code/local.
10. Test asset/post cleaned; final deploy giữ 70 posts/26 tags, legacy assets 200.

**Phân biệt:** API `/media` trực tiếp vẫn **501 `media_static_deploy_required`**. Pipeline runner là kênh upload riêng; không phải API binary parity. AI remote chưa thể tự gửi file đến runner nếu không có shared inbox/máy local.

### Final regression (build `de86bd51`; UI follow-up rebuild `18bd488b`)

| Bộ test | Kết quả |
|---|---|
| M1 public consistency | 42/42 |
| M2 Admin | 74/74 |
| M2.5 API client/settings/retention | 16/16 |
| M3 Publishing API | 28/28 |
| M4 OCC | 12/12 |
| M5 bulk/OCC | 26/26 |
| Security | 17/17 |
| **Tổng** | **215/215 PASS** trên `de86bd51`; M1/M2 = 42/42 + 74/74 sau UI follow-up `18bd488b` |
| Media policy/service + adapter | 18/18 + 14/14 |
| Backup/restore | 24/24 |
| Migration isolated | 29/29 |

Các bộ test này chạy trên build cuối; static E2E test asset đã được dọn trước regression cuối.

---

## E. Deployment & Recovery

- Media deploy uploads current code+assets; **code hash guard** ngăn source cũ ghi đè code mới nếu hash đã ghi. `--record-code-hash` sau deploy code; `--allow-code-change` chỉ khi cố ý.
- Lock serialize, batch một deploy; queue failed/retry; source backup + manifest checksum; audit orphan/missing.
- Không tự xóa asset/ảnh cũ; test asset removed only after explicit test cleanup.
- Rollback code: Worker version rollback; assets thuộc version đó. Nếu asset mới chỉ có ở version mới, rollback làm mất URL cho đến khi deploy lại; D1 metadata/source backup vẫn còn.
- **Chưa test:** deploy failure thật, rollback Worker, concurrent batch stress, restore một ảnh từ source backup.

---

## F. Production Blockers

### P0 — Nếu yêu cầu là AI remote tự động 24/7
1. Static Assets không nhận binary runtime; AI remote không thể đẩy file vào runner nếu không có máy/shared storage. Local runner phải bật.
2. Không có cơ chế queue server/CI 24/7 đã được duyệt.

### P1
1. Asset cap 20.000: 50×3 chỉ ~4,3 tháng; cần giới hạn/archive trước.
2. Deploy failure/rollback/concurrent batch chưa diễn tập.
3. Admin không upload trực tiếp; AI phải dùng runner.
4. WAF/Access/BFM chưa kiểm chứng zone thật.
5. Backup source/manifest local chưa có replication ngoài máy.

### P2
1. Audit orphan/duplicate tự động định kỳ.
2. Nhiều biến thể ảnh/AVIF khi có nhu cầu.
3. UI mobile/asset dashboard nâng cao.

---

## G. Final Decision

# **CONDITIONAL GO**

Điều kiện:
1. Chấp nhận mô hình trusted local runner (máy bật/duy trì lịch) hoặc phê duyệt CI + nguồn ảnh bền vững (không tự triển khai).
2. Chốt giới hạn ảnh/ngày và archive trước 20k; không dùng 50×3 dài hạn nếu không có kế hoạch.
3. Chấp nhận Admin không upload trực tiếp; AI binary qua runner.
4. Diễn tập deploy failure/rollback/concurrent batch và backup/restore một ảnh.
5. WAF/Access preproduction + production cutover approval riêng.

Không có production deploy/DNS/WAF/R2/billing/Node change hoặc xóa ảnh legacy.

## Decisions cần phê duyệt

1. Duy trì local runner trên máy nào, lịch chạy/người chịu trách nhiệm?
2. Giới hạn ảnh: mặc định 2 ảnh/post; trần ngày/tháng? Chấp nhận archive trước 20k?
3. Chấp nhận Admin/AI không upload binary trực tiếp, dùng runner/shared inbox?
4. Nếu cần 24/7: có phê duyệt GitHub Actions private + nguồn ảnh bền vững (không $0 tuyệt đối) không?
5. Cho phép preproduction WAF và production resources/cutover riêng?
