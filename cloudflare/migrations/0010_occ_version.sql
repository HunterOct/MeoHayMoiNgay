ALTER TABLE posts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE posts ADD COLUMN change_id TEXT NOT NULL DEFAULT '';
UPDATE posts SET change_id = lower(hex(randomblob(16))) WHERE change_id = '';
