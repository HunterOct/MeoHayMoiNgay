# Publishing API (v1)

Base URL: `{SITE_URL}/api/v1` — ví dụ `http://localhost:3000/api/v1`.

Tài liệu máy đọc: [`openapi.yaml`](../openapi.yaml) và `GET /api/v1/openapi.yaml`.

## 1. Tạo API client

1. Đăng nhập `/admin` bằng tài khoản quản trị.
2. Mở **API & tích hợp** → **Tạo API client**.
3. Chọn quyền, chế độ xuất bản, giới hạn request/phút.
4. Sao chép key ngay khi hiện ra. Server chỉ lưu `sha256(secret)`, không lưu key gốc.
5. Có thể **Xoay vòng key** (key cũ mất hiệu lực ngay) hoặc **Thu hồi**.

Key có dạng `mh_<key_id>_<secret>`.

```http
Authorization: Bearer mh_aaf989b2fa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Không bao giờ gửi key qua query string, frontend, repo hay chat công khai.

## 2. Quyền (scopes)

| Scope | Quyền |
|---|---|
| `posts:read` | Đọc bài viết, chuyên mục, thẻ |
| `posts:write` | Tạo, sửa bài |
| `posts:publish` | Xuất bản, lên lịch, bỏ xuất bản, xóa mềm |
| `media:write` | Upload ảnh |
| `taxonomy:read` | Đọc chuyên mục/thẻ |

## 3. Hai chế độ xuất bản

| Chế độ | Yêu cầu `published`/`scheduled` |
|---|---|
| `review` | Bị hạ về `review` (chờ biên tập viên duyệt). Không cần scope publish. |
| `auto` | Xuất bản/lên lịch trực tiếp nếu key có `posts:publish`. Thiếu scope → 403. |

Response có `meta.publish_mode` và `meta.publish_demoted` để client biết yêu cầu đã bị hạ cấp.

## 4. Chống trùng lặp

### `external_id` (khuyến nghị)

Mỗi client có thể gửi `external_id` duy nhất cho bài viết. Nếu retry tạo lại cùng `external_id`:

- Bài còn tồn tại → `200` kèm bài cũ và `meta.external_id_replayed: true`.
- Bài đã bị xóa → `409 external_id_conflict`.

### `Idempotency-Key`

Gửi header `Idempotency-Key` cho `POST /posts`, `PATCH /posts/{id}`, `POST .../publish|schedule|unpublish`.
Retry cùng key + cùng payload trả lại đúng response cũ (`Idempotent-Replayed: true`). Cùng key nhưng payload khác → `409 idempotency_conflict`.

## 5. Endpoints

### `GET /me`

```bash
curl -H "Authorization: Bearer $MH_KEY" "$BASE/me"
```

### `GET /categories`, `GET /tags`

Trả về chuyên mục/thẻ kèm số bài đã xuất bản. Dùng slug khi tạo bài.

### `POST /posts`

```bash
curl -X POST "$BASE/posts" \
  -H "Authorization: Bearer $MH_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-2026-10-24-0001" \
  -d '{
    "title": "5 cách giữ rau thơm tươi lâu",
    "slug": "giu-rau-thom-tuoi-lau",
    "excerpt": "Rau thơm nhanh héo vì sai cách bảo quản.",
    "content": "## Nguyên nhân\n\nRau thơm héo vì mất nước...",
    "content_format": "markdown",
    "category": "an-uong",
    "tags": ["bảo quản thực phẩm", "rau củ"],
    "status": "published",
    "external_id": "ai-run-2026-10-24-0001",
    "seo": {
      "title": "Cách giữ rau thơm tươi lâu",
      "description": "Bảo quản rau thơm đúng cách giúp giữ được gần một tuần.",
      "focus_keyword": "giữ rau thơm tươi lâu"
    },
    "cover_media_id": "id-ảnh-đã-upload"
  }'
```

`status` nhận `draft | review | published | scheduled` (mặc định `draft`).
Với `scheduled`, gửi `scheduled_at` ISO 8601 ở tương lai.

Nội dung được sanitize theo allow-list. Markdown được render thành HTML an toàn. Không chấp nhận `<script>`, event handler, `javascript:` URL.

### `GET /posts?status=&category=&q=&limit=&offset=`

Danh sách không kèm nội dung đầy đủ, có `pagination`.

### `GET /posts/{id}`, `GET /posts/slug/{slug}`

Trả bài đầy đủ, gồm `content` gốc và `content_html` đã sanitize.

### `PATCH /posts/{id}`

Cập nhật một phần. Chỉ gửi trường cần đổi. Có thể đổi `status`, `scheduled_at`, `category`, `tags`, `seo`.

Lưu ý: muốn sửa bài **đã xuất bản** cần scope `posts:publish`.

### `POST /posts/{id}/publish`

Xuất bản ngay. Chỉ chế độ `auto` + scope `posts:publish`.

### `POST /posts/{id}/schedule`

```json
{ "scheduled_at": "2026-10-25T01:00:00.000Z" }
```

Job nền kiểm tra mỗi 20 giây và tự chuyển bài đã tới giờ sang `published`.

### `POST /posts/{id}/unpublish`

```json
{ "status": "draft" }
```

`status`: `draft | review | archived` (mặc định `draft`).

### `DELETE /posts/{id}`

Xóa mềm. Bài chuyển vào thùng rác; URL công khai trả `410`. Khôi phục trong admin.

### `POST /media`

`multipart/form-data` với trường `file` (JPG/PNG/WebP/GIF, tối đa `MAX_UPLOAD_MB`) và `alt` tuỳ chọn.

```bash
curl -X POST "$BASE/media" \
  -H "Authorization: Bearer $MH_KEY" \
  -F "file=@anh.jpg" \
  -F "alt=Ảnh minh họa"
```

Response có `id` để dùng làm `cover_media_id`, và `path` (`/media/...`) để nhúng trong nội dung.

## 6. Lỗi

```json
{
  "error": {
    "code": "validation_error",
    "message": "Dữ liệu không hợp lệ.",
    "details": [{ "path": "title", "message": "Tiêu đề tối thiểu 3 ký tự." }],
    "request_id": "…"
  }
}
```

| HTTP | Ý nghĩa |
|---|---|
| 400 | Dữ liệu sai / JSON lỗi |
| 401 | Thiếu hoặc sai key |
| 403 | Thiếu scope, sai chế độ, không có quyền |
| 404 | Không tìm thấy |
| 409 | Trùng `external_id` hoặc `Idempotency-Key` với payload khác |
| 410 | Bài đã xóa |
| 413 | Ảnh quá lớn |
| 429 | Vượt rate limit (`Retry-After`) |
| 500 | Lỗi server (không lộ chi tiết nội bộ) |

## 7. Quy trình tích hợp gợi ý

1. `GET /categories` để chọn slug chuyên mục.
2. (Tuỳ chọn) `POST /media` để lấy `cover_media_id`.
3. `POST /posts` với `external_id` + `Idempotency-Key`, `status: published` (auto) hoặc `review`.
4. Nếu response `meta.publish_demoted = true`, bài đang chờ duyệt — không retry để "đăng lại".
5. Khi cần sửa: `GET /posts/slug/{slug}` → `PATCH /posts/{id}`.
6. Khi cần đổi lịch: `POST /posts/{id}/schedule`.

Retry an toàn: dùng cùng `Idempotency-Key` và cùng `external_id`; nhận `200` thay vì `201` nghĩa là thao tác đã được thực hiện trước đó.

## 8. Giới hạn & vận hành

- Rate limit mặc định theo client; cấu hình trong admin. Vượt → `429` + `Retry-After`.
- Giới hạn IP toàn API: 300 request/phút.
- API không bật CORS: dành cho server-to-server. Không gọi trực tiếp từ trình duyệt khác origin.
- Bài do API tạo được gán cho “Tác giả mặc định cho API” trong Cài đặt.
- Mọi thao tác quan trọng ghi vào nhật ký hệ thống (`actor_type = api`).
