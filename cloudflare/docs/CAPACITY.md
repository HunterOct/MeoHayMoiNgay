# Capacity Model — Cloudflare Free

**Cập nhật:** 2026-10-25. Số đo lấy từ staging/test D1, không phải load test production.  
**Giới hạn cần xác minh lại:** D1 Free 500 MB/database, 5 GB/account, 5M rows read/day, 100k rows written/day; Workers 100k req/day, 10 ms CPU/request; DO 100k req/day, 13k GB-s/day.

## 1. Dung lượng D1

### Số đo

| Mẫu | Kết quả |
|---|---|
| Staging hiện tại | 3,67 MB / 70–83 bài (gồm 10 bài lớn 26 KB + 2 revisions) |
| Trung bình hiện tại | ~44–49 KB/bài (gồm FTS, revision, index) |
| Thử 10 bài thực tế 26.132 byte + 2 revisions | tăng ~1,59 MB → **~159 KB/bài** |
| FTS + revisions | chiếm phần lớn dung lượng tăng; FTS không export được |

### Mô hình

| Nội dung/bài | Revisions | Ước tính/bài | 1.000 bài | 10.000 bài | 50.000 bài | 100.000 bài |
|---|---:|---:|---:|---:|---:|---:|
| ~2 KB, 1 revision | 1 | 30–50 KB | 30–50 MB | 0,3–0,5 GB | 1,5–2,5 GB | 3–5 GB |
| ~20–30 KB, 2–3 revisions | 2–3 | **120–180 KB** | 120–180 MB | **1,2–1,8 GB** | 6–9 GB | 12–18 GB |
| 26 KB, nhiều revision/audit | 5+ | 250–400 KB | 250–400 MB | 2,5–4 GB | 12,5–20 GB | 25–40 GB |

**Kết luận:**
- **1.000 bài**: thoải mái trong 500 MB nếu nội dung vừa.
- **10.000 bài**: vượt 500 MB/database → cần **nhiều database**. Free chỉ cho **10 database/account**, nên trần lý thuyết theo DB là 10 × 500 MB = 5 GB (trùng trần account).
- **50.000–100.000 bài**: vượt 5 GB/account ở mức nội dung thực tế; **100.000 bài không khả thi trên Free** với revisions/FTS đầy đủ.
- Trần account lý thuyết: `5 GB / 150 KB ≈ 34.900 bài` (nội dung vừa); `5 GB / 50 KB ≈ 100.000 bài` chỉ khi nội dung rất nhỏ, ít revision. FTS/audit/revisions làm con số thực tế thấp hơn.
- Trần mỗi DB: `500 MB / 150 KB ≈ 3.300 bài`; `500 MB / 44 KB ≈ 11.300 bài` (mức staging hiện tại).

### Phương án mở rộng (chưa thiết kế/không tự triển khai)
- Giảm revisions giữ lại (retention), nén/archived nội dung cũ.
- Tách D1 theo năm/chuyên mục với routing; cần thiết kế khóa/transaction xuyên DB.
- Đưa nội dung dài/ảnh sang storage khác (R2) — chưa được duyệt.
- Nâng Workers Paid/D1 paid — ngoài ngân sách $0.
- Không sharding tự động trong M5.

## 2. Workers requests

- Free 100k request/ngày (UTC) ≈ **3 triệu/tháng** nếu mọi request đều là Worker.
- Static assets (CSS/JS/ảnh legacy) được phục vụ riêng, không tính request Worker (theo tài liệu hiện hành — cần revalidate).
- Mỗi pageview SSR = 1 Worker request; API/Admin/search/feeds cộng thêm.

| Pageview/tháng | Pageview/ngày | Workers pageview/ngày | Đánh giá |
|---:|---:|---:|---|
| 10.000 | ~333 | 333 | Rất thoải mái |
| 100.000 | ~3.333 | 3.333 | Thoải mái |
| 1.000.000 | ~33.333 | 33.333 | Trong hạn mức, còn dư cho API/Admin |
| ~2.500.000 | ~83.000 | 83.000 | Gần trần; API/Admin có thể đẩy vượt |
| ~3.000.000 | 100.000 | 100.000 | Chạm trần lý thuyết, không còn dư |

Không có Workers Cache/edge cache bật; nếu bật cache cho public page, số request Worker có thể giảm mạnh nhưng chưa kiểm chứng.

## 3. Bài AI/ngày

Giả định mỗi bài tạo + cập nhật + đọc + audit + cron:

| Bài/ngày | API request ước tính | D1 rows written ước tính | DO request ước tính | Đánh giá |
|---:|---:|---:|---:|---|
| 10 | 50–100 | 300–600 | 20–40 | Rất thoải mái |
| 50 | 250–500 | 1.500–3.000 | 100–200 | Thoải mái |
| 100 | 500–1.000 | 3.000–6.000 | 200–400 | Thoải mái |
| 500 | 2.500–5.000 | 15.000–30.000 | 1.000–2.000 | Trong hạn mức, cần theo dõi |
| ~1.500+ | 7.500–15.000 | 45.000–90.000 | 3.000–6.000 | Gần trần writes 100k/ngày |

- D1 writes là giới hạn chặt hơn cho publishing tự động; 100k rows/ngày chia 20–30 rows/bài ≈ **3.300–5.000 bài/ngày** lý thuyết, nhưng đồng thời còn public reads và cron.
- DO 100k request/ngày không phải nút thắt ở 10–500 bài/ngày. CPU content DO ~84 ms/request là thông số cần theo dõi khi payload lớn.

## 4. Kết hợp pageview + bài AI

| Kịch bản | Workers/ngày | D1 reads/ngày | D1 writes/ngày | Kết luận |
|---|---:|---:|---:|---|
| 100k pageview/tháng + 10 bài/ngày | ~3.700 | ~0,1–0,3M | ~0,5k | An toàn |
| 1M pageview/tháng + 50 bài/ngày | ~35.000 | ~1–2M | ~3k | An toàn, còn dư |
| 1M pageview/tháng + 100 bài/ngày | ~35.000 | ~1–2M | ~6k | An toàn |
| 3M pageview/tháng + 100 bài/ngày | ~102.000 | ~3–5M | ~6k | **Vượt Workers/dễ chạm D1 reads** |
| 10M pageview/tháng | ~333.000 | >5M | — | **Không khả thi Free** |

Giả định D1 reads/pageview 20–50 rows; con số thực tế phụ thuộc query/list/search. Cần đo lại trên production traffic thật.

## 5. Cron, backup, media

- Cron 5 phút = 288 lần/ngày; mỗi lần đọc scheduled + cleanup batch 50 → writes nhỏ.
- Backup 3,2 MB mất ~10 s export; 500 MB ước tính vài phút đến hàng chục phút (chưa test); 1,5 GB+ có thể vượt thời gian/giới hạn thực tế — cần đo trước production.
- Media không nằm trong D1: xem `docs/MEDIA-STORAGE.md` (100 bài/ngày × 3 ảnh × 200 KB ≈ 1,8 GB/tháng).

## 6. Kết luận capacity

- **10k–100k pageview/tháng**: dễ dàng trong Free.
- **1M pageview/tháng**: khả thi nếu tối ưu query và không có traffic API bất thường; cần monitor.
- **3M pageview/tháng**: sát trần Workers; không nên cam kết.
- **10M pageview/tháng**: cần nâng gói hoặc cache/CDN khác — ngoài M5.
- **100k bài**: không khả thi trên một D1/Free account với mô hình hiện tại.
- Mọi con số là ước tính; **chưa load test quy mô lớn** để tránh vượt quota.

---

# M6 — FINAL CAPACITY MODEL

## 7. Mô hình theo dung lượng thực đo

Giả định **150 KB/bài** cho bài AI 20–30 KB + 2–3 revisions + FTS; **44 KB/bài** là mức staging hiện tại (ít revision, nội dung nhỏ).

| Số bài | 150 KB/bài | 44 KB/bài | DB cần (500 MB) | Đánh giá Free |
|---:|---:|---:|---:|---|
| 1.000 | 150 MB | 44 MB | 1 | An toàn |
| 5.000 | 750 MB | 220 MB | 2 | An toàn |
| 10.000 | 1,5 GB | 440 MB | 3 (hoặc 1 nếu 44 KB) | An toàn có giám sát |
| 25.000 | 3,75 GB | 1,1 GB | 8 (hoặc 3) | Gần trần account |
| 50.000 | 7,5 GB | 2,2 GB | 15 (hoặc 5) | **FAIL ở 150 KB**; 44 KB khả thi nhưng ít dư |
| 100.000 | 15 GB | 4,4 GB | 30 (hoặc 10) | **FAIL**; 44 KB chỉ đúng lý thuyết, không nên cam kết |

- Free: **10 database/account**, mỗi DB **500 MB**, tổng **5 GB**.
- Ngưỡng vận hành an toàn đề xuất: **≤70%** (3,5 GB account; ~350 MB/DB), dự phòng cho FTS/revision/audit tăng.
- Ở 150 KB/bài: ngưỡng an toàn ~23.000 bài (3,5 GB), trần cứng ~35.000 bài. Không dùng 35.000 như cam kết.
- Ở 44 KB/bài: ngưỡng an toàn ~80.000 bài; nhưng mô hình này chỉ đúng khi nội dung nhỏ/ít revision.
- **Không tự động sharding.** Nếu cần >10 DB phải nâng Paid hoặc thiết kế lại.

## 8. AI Publishing capacity

Giả định 150 KB/bài cuối cùng, 25–40 rows written/bài, 2–5 DO request/bài, 10 API request/bài.

| Bài/ngày | Bài/tháng | Dung lượng/tháng | 1 năm | D1 writes/ngày | DO req/ngày | Đánh giá |
|---:|---:|---:|---:|---:|---:|---|
| 10 | 300 | 45 MB | 540 MB | 250–400 | 20–50 | An toàn |
| 30 | 900 | 135 MB | 1,62 GB | 750–1.200 | 60–150 | An toàn |
| 50 | 1.500 | 225 MB | 2,7 GB | 1.250–2.000 | 100–250 | An toàn có giám sát |
| 100 | 3.000 | 450 MB | 5,4 GB | 2.500–4.000 | 200–500 | Vượt 5 GB sau ~1 năm; cần retention/DB mới |

- Worker requests cho publishing 100 bài/ngày ~1.000/ngày, không đáng kể so với public traffic.
- D1 writes 100 bài/ngày ~4.000/ngày, dưới 100k; giới hạn thực tế là **storage**, không phải writes.
- Cron 288 lần/ngày; cleanup batch 50; không phải bottleneck.
- Backup full DB tăng theo dung lượng; 4,5 GB export có thể rất chậm, chưa test. Cần backup incremental/DB split trước mốc này.
- Media tách khỏi D1: 100 bài/ngày × 3 ảnh × 200 KB ≈ **1,8 GB/tháng**; R2 Free 10 GB chỉ đủ ~5–6 tháng nếu không lifecycle.

## 9. Kết hợp traffic + AI

| Kịch bản | Workers/ngày | D1 reads/ngày | D1 writes/ngày | Kết luận |
|---|---:|---:|---:|---|
| 1M pageview/tháng + 30 bài/ngày | ~35k | 1–2M | ~1k | An toàn |
| 1M pageview/tháng + 100 bài/ngày | ~35k | 1–2M | ~4k | An toàn, trừ storage/media |
| 3M pageview/tháng + 100 bài/ngày | ~102k | 3–5M | ~4k | **Vượt Workers/dễ chạm D1 reads** |
| 10M pageview/tháng | ~333k | >5M | — | **Không khả thi Free** |

## 10. Retention / giám sát / tăng trưởng

- Đề xuất (chưa tự xóa): giữ 10 revision gần nhất hoặc 90 ngày; audit 180 ngày; session/idempotency theo cleanup hiện tại; slug history giữ.
- Giám sát: cảnh báo 50/70/85/95%; DB >350 MB hoặc account >3,5 GB → chuẩn bị archive/DB mới.
- Tăng trưởng: archive bài cũ + revision ra DB riêng; tách DB theo năm/chuyên mục; chuyển nội dung dài/media sang storage; nâng Paid nếu cần >5 GB.
- Không thực hiện sharding/retention tự động khi chưa được duyệt.

## 11. Kết luận an toàn

- **≤10.000 bài + ≤30 bài AI/ngày + ≤1M pageview/tháng**: phù hợp Free với biên an toàn.
- **50 bài/ngày**: được nếu theo dõi storage/backup và có kế hoạch archive.
- **100 bài/ngày**: chỉ trong ~1 năm đầu; cần retention/media/DB split trước khi chạm 5 GB.
- **100.000 bài**: không khả thi Free với mô hình hiện tại.
