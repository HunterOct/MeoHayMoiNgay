ALTER TABLE categories ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE categories SET created_at = COALESCE(NULLIF(created_at, ''), '2026-10-24T00:00:00.000Z');
UPDATE categories SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at);
