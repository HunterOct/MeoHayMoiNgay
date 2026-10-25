CREATE INDEX IF NOT EXISTS idx_posts_status_pub_id
  ON posts(status, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_posts_cat_status_pub
  ON posts(category_id, status, published_at DESC);
