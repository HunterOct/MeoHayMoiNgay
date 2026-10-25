# Deployment Architecture — Dev / Staging / Production

**Phạm vi M5:** chỉ deploy staging. Production chỉ có file mẫu, **không deploy, không DNS, không D1 production**.

## 1. Ma trận môi trường

| Hạng mục | Dev (local) | Staging | Production (kế hoạch) |
|---|---|---|---|
| Worker | `wrangler.jsonc` → `meohay-m0` | `wrangler.remote.jsonc` → `meohay-m0-stg-230403` | `wrangler.production.example.jsonc` |
| D1 | local `meohay-m0` (id 0) | `meohay-m0-stg-230403` / `df5d54cc-…` | D1 riêng, ID riêng |
| Durable Object | `SecureOps` local | `SecureOps` staging | `SecureOps` production |
| Static assets | `./public` | `./public` | `./public` |
| Cron | `* * * * *` (local) | `*/5 * * * *` | `*/5 * * * *` |
| Site URL | `http://127.0.0.1:8787` | workers.dev staging | domain thật |
| `REQUIRE_IF_MATCH` | tuỳ test | `1` | `1` |
| `REQUIRE_STAGING_TOKEN` | 0 | `1` | `1` (surface bị chặn bởi `ENVIRONMENT=production`) |
| Secrets | `.dev.vars` local | Wrangler secret | Wrangler secret riêng |
| Media | `MEDIA_PROVIDER=static` | `MEDIA_PROVIDER=static` | Static Assets + trusted runner |
| Dữ liệu | seed | dữ liệu staging | dữ liệu thật, không copy sang staging |

Không dùng chung D1, DO namespace, API key, session secret hoặc token giữa các môi trường.

## 2. Secrets

Đặt bằng Wrangler, không nằm trong file config/repo:

```bash
npx wrangler secret put STAGING_TOKEN --config wrangler.remote.jsonc
```

- `STAGING_TOKEN` chỉ dùng cho endpoint test `/api/m0/*`; production đặt `REQUIRE_STAGING_TOKEN=0` và không cấu hình token.
- Session token là random opaque, lưu hash/không cần secret ký ngoài.
- API key, mật khẩu admin, `CLOUDFLARE_API_TOKEN` không commit, không đưa vào D1/log.
- `.env.wrangler`, `.staging-token`, `.m2-passwords.json`, `.m5-backup.key` đã gitignore.
- Production dùng token Cloudflare riêng; không tái sử dụng staging credentials.
- Rotate định kỳ và sau khi có người rời dự án.

## 3. Migration

- Forward-only, đánh số `0001…0010`.
- Không sửa migration đã apply; thay đổi mới phải là file mới.
- Trước migration production: Time Travel bookmark + export + test trên bản copy.
- Lệnh:
  ```bash
  npx wrangler d1 migrations list <DB> --remote --config <config>
  npx wrangler d1 migrations apply <DB> --remote --config <config>
  ```
- Không chạy migration phá hủy (DROP/rebuild bảng) nếu chưa có backup và kế hoạch rollback.
- Migration `0010` thêm `version`/`change_id`; production mới có thể chạy toàn bộ chuỗi từ đầu.

## 4. Deploy staging

```bash
set -a; . ./.env.wrangler; set +a
node --check src/index.js
npx wrangler deploy --config wrangler.remote.jsonc
```

Sau deploy:
1. `GET /api/v1/health` → 200.
2. `GET /sitemap.xml`, `/rss.xml`, `/robots.txt` → 200.
3. Admin login → dashboard.
4. API tạo draft + If-Match update.
5. `node scripts/m5-monitor.mjs --hours 1` → cron heartbeat, 5xx, CPU.
6. Chạy smoke regression nếu thay đổi lớn.

## 5. CI/CD đề xuất

- **CI (mỗi push):** `npm ci`, `node --check src/*.js`, `npm audit --omit=dev`, unit/syntax checks. Không cần credentials cho bước này.
- **Staging deploy:** workflow `workflow_dispatch` (thủ công), môi trường `staging`, secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; chạy smoke test sau deploy.
- **Production deploy:** workflow riêng, required reviewers, chỉ chạy khi có phê duyệt production; không tự động từ merge.
- Không đặt token trong workflow file; dùng GitHub Environment secrets.
- Khóa dependency: commit `package-lock.json`, dùng `npm ci`, Node 24.
- Mẫu workflow: `ci/github-actions-staging.example.yml` (chưa kích hoạt).

## 6. Cấu hình production mẫu

`wrangler.production.example.jsonc`:
- `workers_dev: false` để không lộ workers.dev.
- `SITE_URL` và `database_id` là placeholder.
- `MEDIA_PROVIDER=static`; media upload runtime không hỗ trợ, dùng trusted runner (xem `STATIC-ASSETS-MEDIA.md`).
- Không có binding R2.
- `REQUIRE_STAGING_TOKEN=1`; code chặn toàn bộ `/api/m0/*` khi `ENVIRONMENT=production`.
- Route/custom domain phải thêm khi được duyệt; không tự đổi DNS.

## 7. Thứ tự cutover đề xuất (chưa được phép)

1. Tạo D1 production riêng, chạy migration.
2. Deploy Worker production (workers.dev tạm hoặc route chưa public).
3. Smoke test nội bộ với Host header/Preview URL.
4. Backup + bookmark.
5. Chuyển DNS/route khi có phê duyệt riêng.
6. Theo dõi 24–48h; giữ Node app và DNS cũ để rollback.

Không thực hiện các bước 1–6 trong M5.
