ALTER TABLE categories ADD COLUMN cached_post_count INTEGER NOT NULL DEFAULT 0;
UPDATE categories
SET cached_post_count = (
  SELECT COUNT(*) FROM posts p
  WHERE p.category_id = categories.id AND p.status = 'published' AND p.deleted_at IS NULL
);
