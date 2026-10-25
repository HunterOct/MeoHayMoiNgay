ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE users SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at = '';

ALTER TABLE posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE media ADD COLUMN uploaded_by TEXT;
ALTER TABLE api_clients ADD COLUMN revoked_at TEXT;
ALTER TABLE api_clients ADD COLUMN last_used_at TEXT;
ALTER TABLE audit_log ADD COLUMN user_agent TEXT;

CREATE TABLE IF NOT EXISTS revisions (
  id              TEXT PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  excerpt         TEXT NOT NULL DEFAULT '',
  content_html    TEXT NOT NULL DEFAULT '',
  content_source  TEXT NOT NULL DEFAULT '',
  content_format  TEXT NOT NULL DEFAULT 'html',
  seo_title       TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  cover_image     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,
  edited_by_type  TEXT NOT NULL DEFAULT 'user',
  edited_by_id    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_post ON revisions(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_usages (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, post_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('site_name', 'Mẹo Hay Mỗi Ngày'),
  ('site_tagline', 'Mẹo vặt đời sống & công nghệ — dễ làm, không tốn tiền'),
  ('site_description', 'Mẹo Hay Mỗi Ngày — blog mẹo vặt đời sống: nhà cửa gọn thơm, ăn uống và bảo quản thực phẩm, ngủ ngon khỏe người, cùng mẹo công nghệ như wifi nhanh hơn, điện thoại mượt hơn. Mỗi bài một vấn đề, làm theo từng bước trong vài phút.'),
  ('contact_email', ''),
  ('social_twitter', ''),
  ('social_facebook', ''),
  ('default_author_id', ''),
  ('copyright', 'Nội dung và hình ảnh thuộc Mẹo Hay Mỗi Ngày, vui lòng không sao chép khi chưa được đồng ý.'),
  ('allow_ai_crawlers', '0')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  ip         TEXT,
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at);
