# Backup & Restore Runbook (D1 Free)

**Đã kiểm chứng trên:** `meohay-m5-src-1792914988` → `meohay-m5-restore-1792914988` (hai D1 độc lập, không phải staging chính).  
**Ngày:** 2026-10-25. **Kết quả:** 24/24 kiểm tra khớp; FTS rebuild và trigger counters PASS.

## 1. Giới hạn phải biết

- D1 SQL export **không xuất được virtual table/FTS5** (`posts_fts*`). Export toàn bộ DB sẽ lỗi:
  `cannot export databases with virtual tables (like FTS5)`.
- Vì vậy backup chuẩn gồm:
  1. Schema + trigger từ `migrations/0001…0010` (nguồn schema).
  2. Data-only export của các bảng thường.
  3. Rebuild FTS từ `posts` sau restore.
  4. Rebuild cached counters.
- `--no-schema --table …` không mang trigger. Phải tạo schema bằng migrations trước khi import.
- Backup D1 **không chứa media**. Hiện media upload BLOCKED, ảnh legacy nằm trong `public/` và được deploy cùng Worker.
- Backup **không chứa Durable Object SQLite** (rate-limit/auth scratch). Mất DO storage không mất nội dung; chỉ mất rate-limit tạm thời.
- Time Travel Free: **7 ngày**, restore toàn database, giới hạn tần suất; không thay thế backup độc lập.

## 2. Bảng cần export

```
users categories tags posts post_tags revisions slug_history media media_usages
api_clients settings counters audit_log sessions login_attempts idempotency_keys rate_limits
```

`d1_migrations` có thể export thêm nếu muốn giữ lịch sử; schema vẫn phải khớp migration hiện tại.

## 3. Backup định kỳ (data + mã hóa)

Yêu cầu: máy vận hành có Node, Wrangler, `CLOUDFLARE_API_TOKEN` trong biến môi trường (không nằm trong repo), và file khóa `.m5-backup.key` (32 byte, gitignored).

```bash
set -a; . ./.env.wrangler; set +a

npx wrangler d1 export <DB_NAME> --remote --config wrangler.remote.jsonc \
  --no-schema \
  --table users --table categories --table tags --table posts \
  --table post_tags --table revisions --table slug_history --table media \
  --table media_usages --table api_clients --table settings --table counters \
  --table audit_log --table sessions --table login_attempts \
  --table idempotency_keys --table rate_limits \
  --output backups/meohay-$(date +%Y%m%d-%H%M).sql

node scripts/m5-encrypt-backup.mjs   # AES-256-GCM + SHA-256; tạo .enc và file verify
```

Kiểm tra file `.enc` bằng cách giải mã ra file tạm, so SHA-256 đã in, rồi xóa file tạm. Không commit `.sql`, `.enc`, `.key`.

**Đo thực tế (83 bài, 3,2 MB SQL):**
| Bước | Thời gian |
|---|---:|
| Export data-only | 9,8 s |
| Clear target | 3,8 s |
| Import vào DB thứ hai | 13,8 s |
| Rebuild FTS + counters | 3,8 s |
| **Tổng restore** | **~31 s** (chưa gồm tải/giải mã/verify) |

## 4. Quy trình restore vào DB độc lập

1. Tạo D1 mới (cùng account/region) và ghi lại tên/ID.
2. Áp migration schema:
   ```bash
   npx wrangler d1 migrations apply <NEW_DB_NAME> --remote --config <config-có-binding>
   ```
3. Import data:
   ```bash
   npx wrangler d1 execute <NEW_DB_NAME> --remote --config <config> --yes --file backups/meohay-YYYYMMDD-HHMM.sql
   ```
4. Rebuild FTS + counters:
   ```sql
   DELETE FROM posts_fts;
   INSERT INTO posts_fts (post_id,title,excerpt,content)
   SELECT id,title,excerpt,COALESCE(NULLIF(content_source,''),content_html) FROM posts;

   UPDATE categories SET cached_post_count=(
     SELECT COUNT(*) FROM posts p
     WHERE p.category_id=categories.id AND p.status='published' AND p.deleted_at IS NULL
   );
   UPDATE tags SET cached_post_count=(
     SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id
     WHERE pt.tag_id=tags.id AND p.status='published' AND p.deleted_at IS NULL
   );
   DELETE FROM counters;
   INSERT INTO counters(key,value)
   VALUES ('published_posts',(SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL));
   ```
5. Chạy verify:
   ```bash
   node scripts/m5-verify-restore.mjs
   ```
   Script so sánh counts/byte sums giữa source và target, kiểm tra FTS search, orphan rows, cached counters, trigger và migrations.
6. Test trigger: insert một published post, xác nhận `published_posts` và `categories.cached_post_count` tăng; xóa, xác nhận giảm.
7. Chỉ sau khi verify PASS mới cân nhắc cutover hoặc đổi binding.

## 5. Time Travel

```bash
npx wrangler d1 time-travel info <DB_NAME> --config wrangler.remote.jsonc
npx wrangler d1 time-travel restore <DB_NAME> \
  --bookmark=<BOOKMARK> --config wrangler.remote.jsonc
```

- Free giữ **7 ngày**. Bookmark hiện tại lấy từ `info`.
- Restore là **toàn database**; request đang chạy có thể lỗi/ngắt trong lúc restore.
- Trước khi restore production: export backup mới, ghi bookmark hiện tại, thông báo freeze ghi.
- Muốn thử trước: restore/fork sang DB copy (nếu account hỗ trợ), verify rồi mới restore nguồn.
- Đã thử trên DB test: xóa 1 bài (73→72), restore bookmark (72→73), counts/FTS khớp.
- Không dùng Time Travel thay backup dài hạn: hết 7 ngày là mất khả năng quay lại.

## 6. RPO / RTO đề xuất

| Kịch bản | RPO | RTO |
|---|---:|---:|
| Xóa nhầm trong 7 ngày | ~0–5 phút (bookmark gần nhất) | 5–15 phút |
| Hỏng DB/migration | 24 giờ (backup ngày) | ~10–20 phút |
| Mất account/region | 24 giờ + bản lưu ngoài | 30–60 phút (tạo DB mới) |
| Mất máy backup | 24 giờ hoặc lâu hơn | Phụ thuộc bản lưu ngoài |

Đề xuất: backup mã hóa **hằng ngày**, giữ 7 bản ngày + 4 bản tuần; diễn tập restore mỗi tháng; trước mọi migration/deploy lớn tạo bookmark + export.

## 7. Phụ thuộc bên ngoài

- **Máy chạy backup**: nếu tắt/không có mạng, backup không chạy. Time Travel vẫn bảo vệ 7 ngày nhưng không có bản độc lập.
- **Cloudflare API token**: hết hạn/thu hồi → backup/restore dừng. Cần quy trình rotate và lưu token an toàn.
- **Khóa mã hóa**: mất `.m5-backup.key` → không giải mã được backup. Cần bản sao offline ở nơi an toàn; không lưu cùng máy backup.
- **Dung lượng**: Free 5 GB/account; backup local không tính vào quota nhưng ổ đĩa máy vận hành phải đủ.
- **Email/webhook cảnh báo**: chưa cấu hình; hiện kiểm tra qua script monitoring.

## 8. Chưa kiểm chứng

- Restore lên production thật / domain thật.
- Restore xuyên phiên bản schema (backup cũ → schema mới) — phải test trên copy trước.
- Restore media/R2 — chưa có R2.
- Tự động hóa backup bằng GitHub Actions/Windows Task Scheduler — chưa bật.
- Time Travel fork (nếu có) và ảnh hưởng request đang chạy trên production.
