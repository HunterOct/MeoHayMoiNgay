import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prepareEnv, cleanupDir, seedUser, seedCategory, seedPost, getDb } from "./support.js";

const dir = prepareEnv("mh-jobs");
const { openDatabase, closeDb } = await import("../src/db/index.js");
const { runPublishSweep } = await import("../src/jobs/scheduler.js");
openDatabase();

const admin = await seedUser({
  email: "admin@test.local",
  password: "AdminPass12345",
  name: "Quản trị",
  role: "admin",
});
const category = await seedCategory({ name: "Mẹo vặt", slug: "meo-vat", group: "life" });

const due = await seedPost({
  title: "Bài tới giờ",
  slug: "bai-toi-gio",
  authorId: admin.id,
  categoryId: category.id,
  status: "scheduled",
  scheduledAt: new Date(Date.now() - 60_000).toISOString(),
});
const future = await seedPost({
  title: "Bài tương lai",
  slug: "bai-tuong-lai",
  authorId: admin.id,
  categoryId: category.id,
  status: "scheduled",
  scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
});

after(async () => {
  closeDb();
  cleanupDir(dir);
});

test("scheduled publishing job publishes only due posts and audits it", async () => {
  const published = runPublishSweep();
  assert.ok(published.includes(due.id));
  assert.equal(published.includes(future.id), false);

  const db = await getDb();
  const dueRow = db.prepare("SELECT status, published_at, scheduled_at FROM posts WHERE id = ?").get(due.id);
  assert.equal(dueRow.status, "published");
  assert.ok(dueRow.published_at);
  assert.equal(dueRow.scheduled_at, null);

  const futureRow = db.prepare("SELECT status FROM posts WHERE id = ?").get(future.id);
  assert.equal(futureRow.status, "scheduled");

  const audit = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'post.published_scheduled' AND entity_id = ?")
    .get(due.id).n;
  assert.equal(audit, 1);
});
