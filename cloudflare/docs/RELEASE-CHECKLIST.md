# Production Release Checklist (Preparation Only)

> Tài liệu chuẩn bị. **Không phải quyền deploy production.** M5 chỉ phê duyệt staging.

## 0. Phê duyệt
- [ ] Có phê duyệt production riêng bằng văn bản.
- [ ] Người chịu trách nhiệm rollback và cửa sổ thời gian được chỉ định.
- [ ] Xác nhận không có thay đổi DNS/zone/R2/billing ngoài phạm vi được duyệt.
- [ ] Ứng dụng Node gốc vẫn ở `f26d45d` và không bị sửa.

## 1. Preflight
- [ ] CI xanh: `npm ci`, syntax check, `npm audit --omit=dev`, test suites.
- [ ] Staging chạy đúng version dự kiến; không có lỗi 5xx/health.
- [ ] `node scripts/m5-monitor.mjs --hours 24` không có CRIT/HIGH (CPU cold-start ghi nhận riêng).
- [ ] Không có migration pending ngoài danh sách.
- [ ] `package-lock.json` khớp `package.json`.
- [ ] Kiểm tra secrets/vars production: `SITE_URL`, `ENVIRONMENT`, `REQUIRE_IF_MATCH=1`, `REQUIRE_STAGING_TOKEN=0`.
- [ ] Không có R2 binding/credentials nếu chưa được duyệt.
- [ ] Media upload được xác nhận BLOCKED hoặc đã có quyết định media được duyệt.

## 2. Backup
- [ ] Ghi Time Travel bookmark hiện tại.
- [ ] Export data-only + mã hóa; xác minh SHA-256/decrypt.
- [ ] Lưu bản backup ngoài máy deploy.
- [ ] Diễn tập restore trên DB copy (nếu schema thay đổi).
- [ ] Xác nhận khóa mã hóa có bản sao an toàn.

## 3. Migration
- [ ] Danh sách migration sẽ chạy; không có DROP/rebuild chưa được duyệt.
- [ ] Đã test migration trên bản copy với dữ liệu đại diện.
- [ ] Ước lượng thời gian/khóa bảng.
- [ ] Có kế hoạch dừng và rollback nếu migration fail.
- [ ] Chạy `migrations apply` production.
- [ ] Xác nhận `d1_migrations` và schema/trigger đúng.

## 4. Environment validation
- [ ] `SITE_URL` đúng domain production, không phải workers.dev.
- [ ] D1 binding đúng database production, không trùng staging.
- [ ] DO binding/namespace riêng.
- [ ] Cron `*/5 * * * *` bật.
- [ ] Static assets là bản build/commit đúng.
- [ ] Strict If-Match bật.
- [ ] Endpoint staging bị tắt (`ENVIRONMENT=production`; `/api/m0/*` trả 404).
- [ ] Không có secret staging trong production.

## 5. Deploy
- [ ] Deploy Worker production.
- [ ] Ghi lại version ID và thời điểm.
- [ ] Kiểm tra upload assets và startup time.
- [ ] Không đổi DNS trong cùng bước nếu chưa được duyệt.

## 6. Smoke tests
- [ ] `GET /api/v1/health` → 200.
- [ ] Trang chủ, bài viết, category, tag, search → 200.
- [ ] `robots.txt`, `sitemap.xml`, `rss.xml` → 200, đúng domain.
- [ ] Canonical/OG/Twitter meta đúng.
- [ ] Redirect slug cũ → 301; bài xóa → 410.
- [ ] Security headers/CSP/HSTS không lỗi.
- [ ] 404/500 không lộ stack trace.

## 7. Admin
- [ ] Login admin thành công; cookie Secure/HttpOnly/SameSite.
- [ ] Dashboard/posts/editor render.
- [ ] Tạo/sửa draft; version conflict hiển thị đúng.
- [ ] Delete/restore/purge có version; bulk hoạt động.
- [ ] RBAC: editor/author không vượt quyền.
- [ ] Logout thu hồi session.

## 8. Publishing API
- [ ] Tạo draft với Bearer key + idempotency.
- [ ] PATCH thiếu If-Match → 428; stale → 412; đúng → 200.
- [ ] Publish/schedule/unpublish/delete đúng scope.
- [ ] `external_id` replay không tạo trùng.
- [ ] Cron publish bài scheduled.
- [ ] Media endpoint trả 501 nếu chưa có storage.

## 9. Monitoring
- [ ] `node scripts/m5-monitor.mjs --hours 1` chạy được.
- [ ] Cron heartbeat <15 phút.
- [ ] Workers requests/CPU, D1 reads/writes/storage, DO requests/memory, 4xx/5xx được theo dõi.
- [ ] Cảnh báo 50/70/85/95% đã có người nhận.
- [ ] Backup age <7 ngày.
- [ ] Sitemap/RSS/health probes OK.
- [ ] Không log secret/token/nội dung nhạy cảm.

## 10. Rollback decision
- [ ] Ngưỡng rollback đã thống nhất (5xx, health, login, API, D1).
- [ ] Version trước và bookmark trước migration được ghi.
- [ ] Có người có quyền rollback trực chiến.
- [ ] Kế hoạch DB rollback không làm mất bản ghi mới ngoài ý muốn.

## 11. Post-deployment review (sau 24–48h)
- [ ] So sánh error rate/CPU/D1 với baseline.
- [ ] Kiểm tra audit log bất thường.
- [ ] Kiểm tra SEO/indexing (Search Console nếu có).
- [ ] Kiểm tra backup kế tiếp chạy thành công.
- [ ] Ghi nhận incident/lesson learned.
- [ ] Chỉ đóng release khi các mục P0/P1 đã xử lý.
