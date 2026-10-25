> **Superseded 2026-10-25:** người dùng đã chọn Workers Static Assets. Tài liệu R2/B2 dưới đây là phân tích lịch sử; xem `STATIC-ASSETS-MEDIA.md`.

# Media Storage Decision (M5)

**Trạng thái:** media upload **BLOCKED**. Không bật R2, không thêm billing, không tích hợp provider mới.

## 1. Phương án

| Phương án | Dung lượng/chi phí | Upload động | Rủi ro | Kết luận |
|---|---|---|---|---|
| **R2 Free** | 10 GB storage, 1M Class A, 10M Class B/tháng, egress free; **cần bật R2 subscription/billing** | Có | Vượt free bị tính phí; phụ thuộc billing; cần backup riêng | **Khuyến nghị chính nếu được duyệt billing** |
| Workers Static Assets | 20.000 file / 25 MiB/deployment; free | Không (phải rebuild/deploy) | Không phù hợp ảnh AI upload liên tục | Chỉ ảnh có sẵn khi build (legacy) |
| External HTTPS URL | $0 | AI gửi URL | Ảnh bị xóa/hotlink/bản quyền/độ khả dụng; không kiểm soát | **Dự phòng tạm**, cần validation + giám sát |
| Cloudflare Images | Trả phí | Có | Không nằm trong ngân sách $0 | Không dùng |
| Provider free khác | Tuỳ provider | Có thể | Điều khoản, độ ổn định, khóa tài khoản, migration | Chưa được duyệt; không tự chọn |

## 2. Quy mô ảnh

Giả định 3 ảnh/bài, 200 KB/ảnh (JPEG/WebP đã tối ưu):

| Bài AI/ngày | Ảnh/tháng | Dung lượng/tháng | 1 năm |
|---:|---:|---:|---:|
| 10 | 900 | ~180 MB | ~2,2 GB |
| 50 | 4.500 | ~900 MB | ~10,8 GB |
| 100 | 9.000 | ~1,8 GB | ~21,6 GB |

- R2 Free 10 GB đủ khoảng **5–6 tháng** ở 100 bài/ngày nếu không dọn ảnh cũ; cần lifecycle/archive trước khi chạm 10 GB.
- Request đọc ảnh: 100 bài/ngày × 3 ảnh × 30 = 9.000 lượt tải/tháng nếu mỗi ảnh chỉ xem 1 lần; traffic thật có thể cao hơn nhưng vẫn dưới 10M Class B.
- Nếu ảnh 1–2 MB, dung lượng tăng 5–10 lần; phải resize/compress trước khi lưu.

## 3. Rủi ro External URL

- Ảnh có thể bị xóa/đổi nội dung sau khi bài publish → bài mất ảnh.
- Hotlink protection/CORS của nguồn có thể chặn.
- Bản quyền: AI có thể gửi URL ảnh không được phép dùng.
- Không kiểm soát cache/SEO image; có thể lộ referrer/tracking.
- URL `http://` gây mixed content trên HTTPS. Code hiện chỉ cho `http(s)`; production nên siết **https-only**.
- Không fetch server-side nên không có SSRF trực tiếp, nhưng browser người đọc vẫn tải URL bên ngoài.
- Không có bản sao lưu; provider mất là mất ảnh.

## 4. Phương án chính & dự phòng

### Chính (đề xuất, chờ duyệt)
- R2 bucket riêng cho production, binding `MEDIA`, không dùng chung staging.
- Upload qua Worker với giới hạn size/MIME/signature, tên file random, không path traversal.
- Lưu metadata D1 (`media`, `media_usages`) và URL trong bài.
- Lifecycle/archive ảnh cũ; giám sát dung lượng/Class A/B.
- Backup media: mirror/export định kỳ ra nơi lưu trữ được duyệt; R2 một mình không phải backup.
- Bật budget alert/guard; không bật billing cho đến khi có phê duyệt rõ ràng.

### Dự phòng
- **Backblaze B2** (nếu được duyệt): adapter mới, secret riêng, kiểm tra egress/overage và license.
- Hoặc tiếp tục external HTTPS URL cho ảnh AI (giải pháp tạm).
- Chỉ chấp nhận `https://`, chặn URL nội bộ/private, kiểm tra content-type/size phía client (không fetch server).
- Kiểm tra ảnh tồn tại định kỳ; hiển thị placeholder nếu lỗi.
- Ghi rõ trong hợp đồng API: ảnh có thể mất nếu nguồn xóa; không đảm bảo lưu trữ.
- Không coi đây là "media upload hoàn chỉnh".

## 5. Điều kiện cần phê duyệt

1. Cho phép tạo/bật R2 subscription và phương thức thanh toán (nếu chọn R2).
2. Xác nhận ngân sách tối đa/tháng và người theo dõi billing.
3. Chấp nhận rủi ro vượt free 10 GB/1M Class A/10M Class B.
4. Chấp nhận cần backup media riêng.
5. Nếu không duyệt R2: chấp nhận external URL và rủi ro mất ảnh.

## 6. Kết luận

- Blog tự động đăng bài **có ảnh** cần storage thật; external URL không đủ tin cậy cho production lâu dài.
- Media upload vẫn **BLOCKED** và là blocker P1 cho production nếu yêu cầu ảnh là bắt buộc.
- Không có thay đổi R2/billing/provider nào được thực hiện trong M5.

---

# M6 — MEDIA DECISION & IMPLEMENTATION (STAGING)

## 7. So sánh provider (revalidated 2026-10-25)

| Provider | Free | Billing/card | API upload | Egress | Rủi ro chính |
|---|---:|---|---|---|---|
| **Cloudflare R2** | 10 GB-month, 1M Class A, 10M Class B | **Cần R2 subscription + billing** | S3 API + Worker binding | Free | Overage bị tính tiền; cần budget alert |
| Backblaze B2 | 10 GB storage | Không cần thẻ để tạo; overage billed | S3-compatible | 1 GB/day free direct, thêm qua partner; overage billed | Cần provider ngoài + secret; egress/overage |
| Supabase Storage | 1 GB storage, 5 GB egress, file ≤50 MB | Free plan, project có thể pause | REST/S3-compatible | 5 GB/tháng | 1 GB rất thấp; egress nhanh hết |
| Cloudinary | ~25 credits/tháng (credit chia cho storage/bandwidth/transform) | Free có điều kiện | REST | Theo credit | Credit cạn, điều khoản/transform; không phải object storage thuần |
| Workers Static Assets | 20k file/25 MiB mỗi file | Không | Không upload động | Free | Phải rebuild/deploy; không phù hợp AI upload |
| External HTTPS URL | $0 | Không | Không (AI gửi URL) | Phụ thuộc nguồn | Ảnh mất/hotlink/bản quyền/privacy |

**Kết luận:** **R2 là phương án chính** (tích hợp Workers/D1, egress free) nhưng cần phê duyệt billing. **Backblaze B2 là phương án dự phòng** nếu không muốn bật R2 billing (10 GB, không cần thẻ, S3 API; egress/overage theo chính sách B2). External HTTPS URL chỉ là giải pháp tạm, không phải media upload. Không provider ngoài nào được tích hợp trong M6.

## 8. Kiến trúc đã triển khai (provider-agnostic)

- `src/media-policy.js`: MIME sniffing, kích thước ≤8 MB, dimensions ≤8192, pixels ≤40 MP, alt normalize, filename/path validation.
- `src/media.js`: provider interface `{provider, enabled, put, get, delete}`; `r2` adapter chỉ hoạt động khi **cả** `MEDIA_PROVIDER=r2` và binding `MEDIA` tồn tại. Mặc định `none`.
- `src/media-service.js`: upload/delete/metadata; ghi D1 sau khi put; nếu ghi metadata lỗi → xóa object vừa put (rollback); delete kiểm tra `media_usages`.
- Admin và `/api/v1/media` dùng cùng service; khi disabled trả 501/redirect rõ ràng, **không giả lập success**.
- Metadata (`media` table) tách khỏi binary; binary key là `media/<filename>`.
- `cover_media_id` chỉ dùng được khi provider bật và media tồn tại; nếu không trả 501/400.
- Ảnh public: same-origin referer + Google/Bing; hotlink khác bị 403. Không fetch URL server-side.
- UI/JS có fallback ảnh lỗi về `/assets/img/placeholder.svg`.

### Thêm provider sau này
1. Implement adapter trong `media.js` (put/get/delete).
2. Thêm env `MEDIA_PROVIDER=<name>` + secret cần thiết.
3. Không đổi schema bài viết/CMS/API: URL vẫn `/media/<filename>` hoặc URL provider.
4. Chạy lại `scripts/m6-media-test.mjs` và test upload/delete/hotlink.

## 9. Quyết định cần phê duyệt
1. Chọn **R2** (khuyến nghị) hay external provider khác.
2. Có cho phép bật R2 subscription/billing + budget alert không.
3. Nếu không bật billing: chấp nhận phát hành **không có dynamic upload**, chỉ ảnh legacy + external HTTPS URL đã kiểm soát.
4. Có cho phép tạo bucket/provider production và đưa secret vào production không.

**Hiện trạng:** dynamic media upload vẫn **BLOCKED**. Nếu ảnh là yêu cầu cốt lõi, production vẫn NO-GO cho đến khi quyết định 1–4.
