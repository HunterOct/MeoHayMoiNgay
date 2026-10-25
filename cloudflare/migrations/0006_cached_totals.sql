ALTER TABLE tags ADD COLUMN cached_post_count INTEGER NOT NULL DEFAULT 0;
UPDATE tags SET cached_post_count = (
  SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id
  WHERE pt.tag_id = tags.id AND p.status = 'published' AND p.deleted_at IS NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT INTO counters (key, value)
VALUES ('published_posts', (SELECT COUNT(*) FROM posts WHERE status = 'published' AND deleted_at IS NULL))
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

CREATE TRIGGER IF NOT EXISTS trg_counter_posts_ins
AFTER INSERT ON posts
WHEN NEW.status = 'published' AND NEW.deleted_at IS NULL
BEGIN
  UPDATE counters SET value = value + 1 WHERE key = 'published_posts';
END;

CREATE TRIGGER IF NOT EXISTS trg_counter_posts_del
AFTER DELETE ON posts
WHEN OLD.status = 'published' AND OLD.deleted_at IS NULL
BEGIN
  UPDATE counters SET value = value - 1 WHERE key = 'published_posts';
END;

CREATE TRIGGER IF NOT EXISTS trg_counter_posts_upd
AFTER UPDATE OF status, deleted_at ON posts
BEGIN
  UPDATE counters SET value = value - 1
  WHERE key = 'published_posts'
    AND OLD.status = 'published' AND OLD.deleted_at IS NULL
    AND (NEW.status != 'published' OR NEW.deleted_at IS NOT NULL);
  UPDATE counters SET value = value + 1
  WHERE key = 'published_posts'
    AND NEW.status = 'published' AND NEW.deleted_at IS NULL
    AND (OLD.status != 'published' OR OLD.deleted_at IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_tag_count_add
AFTER INSERT ON post_tags
WHEN EXISTS (
  SELECT 1 FROM posts p WHERE p.id = NEW.post_id AND p.status = 'published' AND p.deleted_at IS NULL
)
BEGIN
  UPDATE tags SET cached_post_count = cached_post_count + 1 WHERE id = NEW.tag_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tag_count_remove
AFTER DELETE ON post_tags
WHEN EXISTS (
  SELECT 1 FROM posts p WHERE p.id = OLD.post_id AND p.status = 'published' AND p.deleted_at IS NULL
)
BEGIN
  UPDATE tags SET cached_post_count = cached_post_count - 1 WHERE id = OLD.tag_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tag_count_post_status
AFTER UPDATE OF status, deleted_at ON posts
BEGIN
  UPDATE tags SET cached_post_count = cached_post_count - 1
  WHERE id IN (SELECT tag_id FROM post_tags WHERE post_id = OLD.id)
    AND OLD.status = 'published' AND OLD.deleted_at IS NULL
    AND (NEW.status != 'published' OR NEW.deleted_at IS NOT NULL);
  UPDATE tags SET cached_post_count = cached_post_count + 1
  WHERE id IN (SELECT tag_id FROM post_tags WHERE post_id = NEW.id)
    AND NEW.status = 'published' AND NEW.deleted_at IS NULL
    AND (OLD.status != 'published' OR OLD.deleted_at IS NOT NULL);
END;
