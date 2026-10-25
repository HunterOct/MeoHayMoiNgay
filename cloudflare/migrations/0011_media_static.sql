ALTER TABLE media ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'r2';
ALTER TABLE media ADD COLUMN storage_key TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN url TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE media ADD COLUMN error TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE media SET storage_key = 'media/' || filename WHERE storage_key = '';
UPDATE media SET url = '/media/' || filename WHERE url = '';
UPDATE media SET updated_at = created_at WHERE updated_at = '';

CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
CREATE INDEX IF NOT EXISTS idx_media_sha256 ON media(sha256);
