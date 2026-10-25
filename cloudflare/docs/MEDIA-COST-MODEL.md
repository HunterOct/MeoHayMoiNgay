> **Superseded 2026-10-25:** người dùng chọn Workers Static Assets. Mô hình R2/B2 dưới đây là phân tích lịch sử; xem `STATIC-ASSETS-MEDIA.md`.

# M7 — Media Cost & Capacity Model

**Trạng thái:** ước tính; chưa có upload media thật (provider BLOCKED). Không kích hoạt R2/B2/provider nào.

## 1. Giả định

- Ảnh đã tối ưu: thumbnail 50 KB, cover 200 KB, inline 150 KB.
- Kịch bản 1 ảnh/bài = 200 KB; 3 ảnh = 500 KB; 5 ảnh = 800 KB.
- 30 ngày/tháng.
- Upload = 1 Class A operation/ảnh.
- Image reads phụ thuộc pageview và cache; bảng dùng 100.000 pageview/tháng, 3 ảnh/view, cache hit 90% (chỉ 10% request tới R2). Đây là **giả định**, chưa đo edge cache.
- D1 metadata media: không đáng kể so với nội dung bài.

## 2. Dung lượng

| Bài/ngày | 1 ảnh/tháng | 1 ảnh/năm | 3 ảnh/tháng | 3 ảnh/năm | 5 ảnh/tháng | 5 ảnh/năm |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 60 MB | 0,72 GB | 150 MB | 1,8 GB | 240 MB | 2,88 GB |
| 30 | 180 MB | 2,16 GB | 450 MB | 5,4 GB | 720 MB | 8,64 GB |
| 50 | 300 MB | 3,6 GB | 750 MB | 9 GB | 1,2 GB | 14,4 GB |
| 100 | 600 MB | 7,2 GB | 1,5 GB | 18 GB | 2,4 GB | 28,8 GB |

**Kết luận dung lượng:**
- 10–50 bài/ngày, 1–3 ảnh: trong R2 Free 10 GB ít nhất ~1 năm (trừ 50/ngày × 3 ảnh ~9 GB/năm, sát trần).
- 100 bài/ngày × 5 ảnh: vượt 10 GB sau ~4–5 tháng; cần lifecycle/archive hoặc trả phí.
- 100 bài/ngày × 3 ảnh: ~18 GB/năm, vượt 10 GB sau ~6–7 tháng.

## 3. Operations

| Bài/ngày | 1 ảnh upload/tháng | 3 ảnh upload/tháng | 5 ảnh upload/tháng |
|---:|---:|---:|---:|
| 10 | 300 | 900 | 1.500 |
| 30 | 900 | 2.700 | 4.500 |
| 50 | 1.500 | 4.500 | 7.500 |
| 100 | 3.000 | 9.000 | 15.000 |

- R2 Free Class A **1M/tháng**; upload vẫn rất thấp.
- Reads (Class B) ước tính với 100k pageview/tháng, 3 ảnh/view, cache miss 10%: **90.000/tháng**; Free 10M/tháng.
- Nếu cache miss 100%: 300.000/tháng; vẫn dưới 10M nhưng traffic spike có thể tăng.
- 1M pageview/tháng, 5 ảnh/view, cache miss 10% = 500.000/tháng; vẫn dưới 10M.
- 10M pageview/tháng, 5 ảnh, miss 10% = 5M/tháng; gần/dưới 10M nhưng Workers/D1 sẽ là giới hạn trước.

## 4. Chi phí vượt Free (ước tính, cần đối chiếu pricing hiện hành)

- R2 Standard: storage **$0,015/GB-month**, Class A **$4,50/triệu**, Class B **$0,36/triệu**; egress free.
- 28,8 GB (100 bài/ngày × 5 ảnh/năm): 18,8 GB vượt → ~**$0,28/tháng** ở thời điểm đó (chưa gồm operations).
- 18 GB (100 × 3/năm): 8 GB vượt → ~**$0,12/tháng**.
- R2 **không có hard spending cap** được xác nhận trong phạm vi tài liệu đã đọc; budget alert chỉ **thông báo**, không chặn phí. Không được nói alert ngăn phát sinh phí.
- B2: 10 GB free, sau đó billed; egress free theo hạn mức/partner, vượt bị tính. Cần đọc bảng giá B2 hiện hành trước khi cam kết.
- Supabase 1 GB storage/5 GB egress: không đủ cho 100 bài/ngày có ảnh.
- Cloudinary credit dùng chung transformation/storage/bandwidth; không phù hợp làm object storage thuê bao lâu dài.

## 5. Traffic spike

- R2 egress free giúp biên an toàn; rủi ro chính là **Class B** và storage, không phải băng thông.
- Một spike 1M ảnh trong ngày vẫn dưới 10M/tháng nhưng có thể vượt nếu lặp lại.
- Không có CDN/cache measurement vì chưa có R2/custom domain; cache hit phải đo sau khi bật.
- Workers Free 100k request/ngày và D1 5M reads/ngày sẽ cạn trước media R2 trong traffic rất lớn.

## 6. Đề xuất

- **Chính:** R2 (nếu được duyệt billing), lifecycle/archive ảnh cũ, giới hạn upload theo API client/admin, budget alert + theo dõi thủ công.
- **Dự phòng:** Backblaze B2 (nếu không muốn R2 billing) với adapter mới; cần test egress/ops/terms.
- **Tạm thời:** external HTTPS URLs có kiểm soát; không coi là media upload đầy đủ.
- **Không chọn:** Supabase 1 GB/Cloudinary credits cho quy mô 100 bài/ngày.

## 7. Chưa đo / chưa xác minh

- Dung lượng ảnh thật do AI tạo (chưa upload).
- Cache hit thực tế, egress, Class A/B thực tế.
- Hành vi R2 khi vượt Free/chưa thanh toán.
- B2 free tier/egress hiện hành và điều khoản.
- Media backup/restore.

## 8. Số tháng còn trong R2 Free (không xóa ảnh cũ)

R2 Free = 10 GB **tổng dung lượng lưu trữ**, không reset theo tháng. Bảng dưới là thời gian tới khi chạm 10 GB nếu bắt đầu từ 0 và giữ toàn bộ ảnh.

| Bài/ngày | 1 ảnh (200 KB) | 2 ảnh (350 KB) | 3 ảnh (500 KB) |
|---:|---:|---:|---:|
| 10 | ~166 tháng | ~95 tháng | ~66 tháng |
| 20 | ~83 tháng | ~47 tháng | ~33 tháng |
| 30 | ~55 tháng | ~31 tháng | ~22 tháng |
| 50 | ~33 tháng | ~19 tháng | ~13 tháng |

- 3 ảnh/ngày ở 50 bài/ngày chạm 10 GB sau ~13 tháng; 30 bài/ngày ~22 tháng.
- Nếu ảnh lớn hơn 200 KB hoặc có nhiều biến thể/OG, thời gian ngắn hơn.
- Đây là **ước tính**, chưa có upload thật; không phải cam kết dung lượng.

## 9. B2: public/private và Worker proxy

- B2 có thể dùng bucket public hoặc private; public phục vụ ảnh trực tiếp, private cần Worker proxy/authorized URL.
- Worker proxy làm tăng Worker requests/CPU/subrequests; ảnh lớn/traffic cao có thể chạm Workers Free 100k request/ngày trước khi chạm B2 free.
- CDN/cache có thể giảm request tới B2 nhưng chưa đo; custom domain/CDN cần cấu hình zone/URL và kiểm tra egress/terms.
- B2 tạo tài khoản free không cần thẻ **không đồng nghĩa** mọi chức năng public/private/egress đều miễn phí lâu dài; phải đọc bảng giá/terms hiện hành.
- Không chọn Worker proxy cho toàn bộ ảnh nếu traffic lớn mà chưa có cache/quota test.

## 10. Kết luận cập nhật

- **R2**: phù hợp nhất về tích hợp; cần billing; 10 GB không reset; **không có hard cap đã xác nhận**.
- **B2**: dự phòng nếu không muốn R2 billing; cần adapter + terms + egress/ops test.
- **Không upload động**: chỉ đủ nếu ảnh không phải yêu cầu cốt lõi; AI/Admin không thể upload thumbnail/OG.
- **Không provider nào** đáp ứng “miễn phí vô hạn lâu dài”; 10 GB là hữu hạn.
