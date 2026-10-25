CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL DEFAULT 'life',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'author',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  lede TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  content_source TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'html',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','scheduled','published','archived')),
  category_id TEXT REFERENCES categories(id),
  author_id TEXT REFERENCES users(id),
  cover_image TEXT NOT NULL DEFAULT '',
  cover_alt TEXT NOT NULL DEFAULT '',
  cover_caption TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  focus_keyword TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  og_image TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0,
  read_minutes INTEGER NOT NULL DEFAULT 4,
  views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  api_client_id TEXT,
  external_id TEXT
);

CREATE INDEX idx_posts_status_pub ON posts(status, published_at DESC);
CREATE INDEX idx_posts_category ON posts(category_id);
CREATE INDEX idx_posts_scheduled ON posts(status, scheduled_at);
CREATE UNIQUE INDEX idx_posts_client_external ON posts(api_client_id, external_id)
  WHERE external_id IS NOT NULL AND api_client_id IS NOT NULL;

CREATE TABLE post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

CREATE TABLE slug_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_id TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  publish_mode TEXT NOT NULL DEFAULT 'review',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  client_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (client_id, idem_key)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE VIRTUAL TABLE posts_fts USING fts5(
  post_id UNINDEXED,
  title,
  excerpt,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
