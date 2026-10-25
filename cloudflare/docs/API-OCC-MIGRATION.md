# API OCC & Admin Concurrency Migration

**Trạng thái:** strict mode đang bật trên staging (`REQUIRE_IF_MATCH=1`).  
**Phạm vi:** M5 staging; không áp dụng production/DNS.

## 1. Quy tắc bắt buộc

| Thao tác | Version precondition | Ghi chú |
|---|---|---|
| `POST /posts` (tạo mới) | Không | Dùng `Idempotency-Key` hoặc `external_id` để chống trùng khi retry. |
| `PATCH /posts/{id}` | **Bắt buộc** `If-Match` | Thiếu → `428 precondition_required`; cũ → `412 version_conflict`. |
| `POST /posts/{id}/publish` | **Bắt buộc** | Cùng semantics. |
| `POST /posts/{id}/schedule` | **Bắt buộc** | Cùng semantics. |
| `POST /posts/{id}/unpublish` | **Bắt buộc** | Cùng semantics. |
| `DELETE /posts/{id}` | **Bắt buộc** | Xóa mềm, vẫn kiểm tra version. |
| Admin editor save | **Bắt buộc** hidden `version` | Form stale hiển thị cảnh báo, không ghi đè. |
| Admin delete/restore/purge | **Bắt buộc** hidden `version` | Thiếu → `409`; stale → `409`. |
| Admin bulk action | **Bắt buộc** `version-<id>` cho mọi bài | Thiếu/stale → `409` trước khi ghi. |

`If-Match` chấp nhận `"v7"` (ETag), `v7`, hoặc `*` (bỏ kiểm tra; chỉ dùng cho script có chủ đích).

## 2. Hợp đồng lỗi

```json
{
  "error": {
    "code": "precondition_required",
    "message": "Cần gửi If-Match với version hiện tại trước khi sửa bài.",
    "details": [{ "path": "If-Match", "message": "Version hiện tại: 7" }],
    "request_id": "..."
  }
}
```

```json
{
  "error": {
    "code": "version_conflict",
    "message": "Bài viết đã được cập nhật ở phiên bản khác.",
    "current_version": 8,
    "details": [{ "path": "If-Match", "message": "Version hiện tại: 8" }],
    "request_id": "..."
  }
}
```

Response `412` trả `current_version` (và `details`) để client cập nhật ngay; header `ETag` đáng tin cậy trên response thành công, không dựa vào ETag của response lỗi.

## 3. Nâng cấp AI client

1. `GET /api/v1/posts/{id}`; lưu `data.version` và/hoặc `ETag`.
2. Gửi mutation với `If-Match: "v{version}"`.
3. Nếu `412`:
   - Không retry mù.
   - Đọc `current_version`, `GET` lại bài.
   - Merge thay đổi của mình lên bản mới (hoặc bỏ qua nếu xung đột nội dung).
   - Gửi lại với version mới và **cùng** `Idempotency-Key` chỉ khi payload không đổi.
4. Nếu `428`: client chưa nâng cấp; thêm header trước khi tiếp tục.
5. Nếu `409 idempotency_conflict`: key đã dùng với payload khác; tạo key mới sau khi kiểm tra.

## 4. Chính sách chuyển tiếp

- Staging và production mới nên bật strict ngay từ ngày đầu; không có client production cũ.
- Nếu phải tạm hỗ trợ client cũ, đặt `REQUIRE_IF_MATCH=0` **chỉ trong cửa sổ ngắn**, ghi nhận client nào chưa gửi header, và tắt lại sau khi nâng cấp. Không dùng chế độ này lâu dài vì last-write-wins vẫn có thể mất dữ liệu.
- Không đổi route hoặc bỏ `version` khỏi response; đó là breaking change ngược.
- OpenAPI `1.1.0` mô tả `version`, `ETag`, `If-Match`, `412`, `428`.

## 5. Admin bulk

- Form gửi `ids` lặp lại và `version-<id>` cho từng bài.
- Server preflight **tất cả** version trước khi ghi. Nếu một bài thiếu/stale, toàn bộ batch bị từ chối `409`, không có ghi nào.
- Nếu xung đột xảy ra trong khe thời gian giữa preflight và ghi (race hiếm), batch dừng, trả `409` kèm số bài đã cập nhật, ghi audit `post.bulk_<action>_conflict`.
- Bulk không phải transaction nhiều bài; UI phải tải lại và kiểm tra sau cảnh báo.
- Purge dùng claim version trước khi xóa để không xóa nhầm bản vừa restore.

## 6. Cron và cập nhật đồng thời

- `publishDue` chỉ chọn bài `scheduled` đến hạn, tăng `version`/`change_id` khi publish.
- Update API/Admin dùng CAS trên version; nếu cron đã publish trước, request cũ nhận `412`.
- Nếu update thắng trước, cron vẫn publish bài đã cập nhật; nội dung không bị ghi đè.
- Đã kiểm thử: cron thắng → PATCH `412`, bài published, version tăng; không mất nội dung.

## 7. Kiểm thử

```bash
node scripts/m4-occ-test.mjs          # 12 test OCC API/Admin
node scripts/m5-occ-bulk-test.mjs     # 26 test bulk/delete/restore/purge/idempotency/cron race
node scripts/m3-api-test.mjs          # 28 test API contract
```
