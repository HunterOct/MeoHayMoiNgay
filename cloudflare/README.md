# Cloudflare Workers Migration

Đây là workspace migration Cloudflare Free từ Node/Express, được đưa vào repo để lưu trữ.

- Ứng dụng Node gốc ở thư mục gốc repo, commit `f26d45d`, không bị thay đổi.
- Worker source: `src/`, migrations: `migrations/`, static: `public/`.
- Báo cáo gần nhất: `STATIC-ASSETS-OPERATIONS-GATE.md`, `FINAL-BLOCKER-REPORT.md`.
- Media dùng Workers Static Assets + trusted local runner; xem `docs/STATIC-ASSETS-MEDIA.md`.
- Không commit `.env.wrangler`, `.staging-token`, `.m5-backup.key`, fixtures credentials, backups hoặc screenshots.

## Chạy local

```bash
cd cloudflare
npm ci
npx wrangler dev --config wrangler.jsonc
```

## Deploy staging

```bash
set -a; . ./.env.wrangler; set +a
npx wrangler deploy --config wrangler.remote.jsonc
```
