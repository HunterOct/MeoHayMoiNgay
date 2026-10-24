export const migrations = [
  {
    version: 1,
    name: "initial",
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE users (
        id              TEXT PRIMARY KEY,
        email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash   TEXT NOT NULL,
        name            TEXT NOT NULL,
        role            TEXT NOT NULL CHECK (role IN ('admin','editor','author')),
        bio             TEXT NOT NULL DEFAULT '',
        is_active       INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until    TEXT,
        last_login_at   TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token    TEXT NOT NULL,
        ip            TEXT,
        user_agent    TEXT,
        created_at    TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        expires_at    TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE categories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        slug        TEXT NOT NULL UNIQUE,
        group_name  TEXT NOT NULL DEFAULT 'life',
        description TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE tags (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        slug       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE media (
        id            TEXT PRIMARY KEY,
        filename      TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        mime          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        width         INTEGER,
        height        INTEGER,
        alt           TEXT NOT NULL DEFAULT '',
        uploaded_by   TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE posts (
        id               TEXT PRIMARY KEY,
        slug             TEXT NOT NULL UNIQUE,
        title            TEXT NOT NULL,
        excerpt          TEXT NOT NULL DEFAULT '',
        lede             TEXT NOT NULL DEFAULT '',
        content_html     TEXT NOT NULL DEFAULT '',
        content_format   TEXT NOT NULL DEFAULT 'html' CHECK (content_format IN ('html','markdown')),
        status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','review','scheduled','published','archived')),
        category_id      TEXT REFERENCES categories(id) ON DELETE SET NULL,
        author_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
        cover_image      TEXT NOT NULL DEFAULT '',
        cover_alt        TEXT NOT NULL DEFAULT '',
        cover_caption    TEXT NOT NULL DEFAULT '',
        seo_title        TEXT NOT NULL DEFAULT '',
        seo_description  TEXT NOT NULL DEFAULT '',
        focus_keyword    TEXT NOT NULL DEFAULT '',
        canonical_url    TEXT NOT NULL DEFAULT '',
        og_image         TEXT NOT NULL DEFAULT '',
        is_featured      INTEGER NOT NULL DEFAULT 0,
        read_minutes     INTEGER NOT NULL DEFAULT 4,
        views            INTEGER NOT NULL DEFAULT 0,
        published_at     TEXT,
        scheduled_at     TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        deleted_at       TEXT,
        origin           TEXT NOT NULL DEFAULT 'admin',
        api_client_id    TEXT
      );
      CREATE INDEX idx_posts_status_pub ON posts(status, published_at DESC);
      CREATE INDEX idx_posts_category ON posts(category_id);
      CREATE INDEX idx_posts_author ON posts(author_id);
      CREATE INDEX idx_posts_scheduled ON posts(status, scheduled_at);
      CREATE INDEX idx_posts_deleted ON posts(deleted_at);

      CREATE TABLE post_tags (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      );
      CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

      CREATE TABLE slug_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        slug       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_slug_history_post ON slug_history(post_id);

      CREATE TABLE revisions (
        id             TEXT PRIMARY KEY,
        post_id        TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        excerpt        TEXT NOT NULL DEFAULT '',
        content_html   TEXT NOT NULL DEFAULT '',
        content_format TEXT NOT NULL DEFAULT 'html',
        seo_title      TEXT NOT NULL DEFAULT '',
        seo_description TEXT NOT NULL DEFAULT '',
        cover_image    TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL,
        edited_by_type TEXT NOT NULL DEFAULT 'user',
        edited_by_id   TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_revisions_post ON revisions(post_id, created_at DESC);

      CREATE TABLE media_usages (
        media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, post_id)
      );

      CREATE TABLE api_clients (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        key_id              TEXT NOT NULL UNIQUE,
        key_hash            TEXT NOT NULL,
        scopes              TEXT NOT NULL DEFAULT '[]',
        publish_mode        TEXT NOT NULL DEFAULT 'review'
                            CHECK (publish_mode IN ('auto','review')),
        rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
        is_active           INTEGER NOT NULL DEFAULT 1,
        revoked_at          TEXT,
        created_at          TEXT NOT NULL,
        last_used_at        TEXT
      );

      CREATE TABLE idempotency_keys (
        client_id     TEXT NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
        idem_key      TEXT NOT NULL,
        method        TEXT NOT NULL,
        path          TEXT NOT NULL,
        request_hash  TEXT NOT NULL,
        status_code   INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (client_id, idem_key)
      );

      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type  TEXT NOT NULL,
        actor_id    TEXT,
        action      TEXT NOT NULL,
        entity_type TEXT,
        entity_id   TEXT,
        meta        TEXT NOT NULL DEFAULT '{}',
        ip          TEXT,
        user_agent  TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
      CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);
      CREATE INDEX idx_audit_actor ON audit_log(actor_type, actor_id, created_at DESC);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE login_attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT NOT NULL,
        ip         TEXT,
        success    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_login_attempts ON login_attempts(email, created_at DESC);

      CREATE VIRTUAL TABLE posts_fts USING fts5(
        post_id UNINDEXED,
        title,
        excerpt,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
  {
    version: 2,
    name: "content_source",
    sql: `
      ALTER TABLE posts ADD COLUMN content_source TEXT NOT NULL DEFAULT '';
      UPDATE posts SET content_source = content_html WHERE content_source = '';
      ALTER TABLE revisions ADD COLUMN content_source TEXT NOT NULL DEFAULT '';
      UPDATE revisions SET content_source = content_html WHERE content_source = '';
    `,
  },
  {
    version: 3,
    name: "external_ids",
    sql: `
      ALTER TABLE posts ADD COLUMN external_id TEXT;
      CREATE UNIQUE INDEX idx_posts_client_external
        ON posts(api_client_id, external_id)
        WHERE external_id IS NOT NULL AND api_client_id IS NOT NULL;
    `,
  },
];
