UPDATE categories
SET cached_post_count = (
  SELECT COUNT(*) FROM posts p
  WHERE p.category_id = categories.id AND p.status = 'published' AND p.deleted_at IS NULL
);

CREATE TRIGGER IF NOT EXISTS trg_posts_cache_ins
AFTER INSERT ON posts
WHEN NEW.status = 'published' AND NEW.deleted_at IS NULL AND NEW.category_id IS NOT NULL
BEGIN
  UPDATE categories SET cached_post_count = cached_post_count + 1 WHERE id = NEW.category_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_posts_cache_del
AFTER DELETE ON posts
WHEN OLD.status = 'published' AND OLD.deleted_at IS NULL AND OLD.category_id IS NOT NULL
BEGIN
  UPDATE categories SET cached_post_count = cached_post_count - 1 WHERE id = OLD.category_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_posts_cache_upd
AFTER UPDATE OF status, category_id, deleted_at ON posts
BEGIN
  UPDATE categories
  SET cached_post_count = cached_post_count - 1
  WHERE id = OLD.category_id
    AND OLD.category_id IS NOT NULL
    AND OLD.status = 'published'
    AND OLD.deleted_at IS NULL
    AND (NEW.status != 'published' OR NEW.deleted_at IS NOT NULL OR NEW.category_id IS NOT OLD.category_id);

  UPDATE categories
  SET cached_post_count = cached_post_count + 1
  WHERE id = NEW.category_id
    AND NEW.category_id IS NOT NULL
    AND NEW.status = 'published'
    AND NEW.deleted_at IS NULL
    AND (OLD.status != 'published' OR OLD.deleted_at IS NOT NULL OR NEW.category_id IS NOT OLD.category_id);
END;
