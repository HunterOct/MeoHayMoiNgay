# Rollback Strategy

**Nguyên tắc:** code rollback ≠ database rollback. Rollback Worker không tự hoàn nguyên dữ liệu/migration.

## 1. Code rollback (Worker)

```bash
npx wrangler deployments list --config wrangler.remote.jsonc
npx wrangler rollback <VERSION_ID> --config wrangler.remote.jsonc
# hoặc deploy lại commit cũ:
git checkout <commit-cu>
npx wrangler deploy --config wrangler.remote.jsonc
```

- Version ID staging hiện tại được ghi sau mỗi deploy.
- Trước rollback: export backup + Time Travel bookmark nếu thay đổi có ghi dữ liệu.
- Static assets được rollback cùng version deploy; `public/` cũ phải có trong commit đó.
- Cron trigger thuộc Worker version; kiểm tra lại schedule sau rollback.
- Secret/vars không rollback theo code; kiểm tra `wrangler secret list`, vars trong config.

## 2. Database rollback

### 2.1 Khi nào dùng

| Tình huống | Cách xử lý |
|---|---|
| Xóa nhầm bài trong 7 ngày | Time Travel bookmark gần nhất, hoặc restore bài từ revision/trash |
| Migration sai cấu trúc | Stop writes → backup → Time Travel về trước migration; sửa migration mới |
| API ghi sai hàng loạt | Xác định phạm vi; ưu tiên restore revision/backup targeted thay vì cả DB |
| Hỏng DB/region | Restore từ backup độc lập sang DB mới, đổi binding |

- **Không có down migration tự động.** Migration forward-only; rollback schema bằng Time Travel/restore, không chạy DROP tùy tiện.
- Time Travel trả cả DB về thời điểm trước; mọi bản ghi mới sau bookmark sẽ mất. Vì vậy phải export các bản ghi mới trước khi restore nếu cần giữ.
- Restore DB không tự đổi binding Worker; phải trỏ lại `database_id` hoặc tạo DB mới và deploy config.
- Rebuild FTS/counters sau restore data-only (xem `docs/BACKUP-RESTORE.md`).

### 2.2 Quy trình an toàn

1. Freeze ghi (maintenance/thông báo) nếu có thể.
2. Ghi bookmark hiện tại + export backup.
3. Restore/fork sang DB copy, chạy `scripts/m5-verify-restore.mjs`.
4. So sánh các bản ghi phát sinh sau bookmark; export riêng nếu cần.
5. Restore DB chính hoặc đổi binding.
6. Rebuild FTS/counters nếu cần; smoke test.
7. Mở lại ghi; audit log ghi nhận sự cố.

## 3. Infrastructure rollback (về Node.js)

- Ứng dụng Node gốc vẫn ở commit `f26d45d`, **không sửa**.
- Khi chưa cutover DNS, rollback = giữ nguyên Node, tắt/không dùng Worker staging.
- Sau cutover, rollback = trả DNS/route về Node cũ. **Chưa kiểm chứng** và không nằm trong M5.
- Dữ liệu phát sinh trên D1 sau cutover không tự đồng bộ về SQLite Node. Cần kế hoạch freeze + export/import riêng; hiện **NOT VERIFIED**.
- Không xóa D1/Worker staging trong lúc rollback; giữ để điều tra.

## 4. Ma trận sự cố

| Sự cố | Phát hiện | Hành động ngay | Rollback |
|---|---|---|---|
| Worker deploy lỗi | 5xx tăng, health fail | Rollback version trước | Code rollback |
| D1 migration lỗi | Deploy/migration error, query fail | Dừng deploy, không chạy migration tiếp | Time Travel/restore + sửa migration |
| Admin login lỗi | Login 5xx/403 bất thường | Kiểm tra secret/session/D1; rollback code gần nhất | Code rollback |
| Publishing API lỗi | 5xx/401/412 tăng | Kiểm tra DO/D1/version; tạm dừng client | Code rollback |
| Mất SEO metadata | Sitemap/canonical sai | Kiểm tra settings/render; rollback | Code rollback |
| Cron ngừng publish | heartbeat >15 phút | Kiểm tra trigger/log; chạy thủ công có kiểm soát | Code/config rollback |
| D1 chạm quota | monitor HIGH/CRIT | Giảm traffic/ghi, archive, tạm chặn API | Không rollback quota; cần giảm tải/paid |
| Worker vượt CPU | P95 cao, 5xx/1102 | Giảm payload/cache, rollback version ổn định | Code rollback |

## 5. Tiêu chí quyết định rollback

Rollback ngay khi:
- 5xx > 5% trong 5 phút hoặc health fail liên tục.
- Admin không đăng nhập được.
- API publish sai/không idempotent.
- D1 migration lỗi hoặc mất dữ liệu.
- SEO/indexing hỏng rõ ràng (robots/sitemap 5xx/sai).

Không rollback mù khi:
- Chỉ một client gửi sai version → trả 412 và hướng dẫn client.
- Cold start CPU cao đơn lẻ → theo dõi, không rollback ngay.
- Rate limit 429 do client vượt hạn mức → điều chỉnh client.

## 6. RTO/RPO rollback

- Code rollback: 2–5 phút (deploy/rollback version).
- DB Time Travel: 5–15 phút + verify.
- Restore backup độc lập: ~10–20 phút gồm tạo DB/import/rebuild/verify.
- Rollback về Node sau cutover: chưa đo, phụ thuộc DNS TTL và đồng bộ dữ liệu.
