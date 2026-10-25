CREATE INDEX IF NOT EXISTS idx_posts_status_views
  ON posts(status, views DESC, published_at DESC, id DESC);
