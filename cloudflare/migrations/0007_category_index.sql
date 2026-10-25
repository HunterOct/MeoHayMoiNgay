CREATE INDEX IF NOT EXISTS idx_posts_cat_status_pub_id
  ON posts(category_id, status, published_at DESC, id DESC)
  WHERE deleted_at IS NULL;
