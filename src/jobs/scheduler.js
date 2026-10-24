import { publishDue, getById } from "../db/posts.js";
import { cleanupSessions, cleanupLoginAttempts } from "../db/sessions.js";
import { cleanupIdempotency } from "../db/apikeys.js";
import { purgeAuditOlderThan } from "../db/audit.js";
import { logAudit } from "../db/audit.js";
import { logger } from "../lib/logger.js";

const timers = [];

export function runPublishSweep(now) {
  const ids = publishDue(now);
  for (const id of ids) {
    const post = getById(id);
    logAudit({
      actorType: "system",
      action: "post.published_scheduled",
      entityType: "post",
      entityId: id,
      meta: { slug: post?.slug || null, scheduledAt: post?.published_at || null },
    });
  }
  if (ids.length) logger.info("jobs.published_scheduled", { count: ids.length, ids });
  return ids;
}

function every(ms, fn, name) {
  const timer = setInterval(async () => {
    try {
      await fn();
    } catch (error) {
      logger.error("jobs.failed", { job: name, error: error.message });
    }
  }, ms);
  timer.unref?.();
  timers.push(timer);
  return timer;
}

export function startJobs() {
  runPublishSweep();
  every(20_000, () => runPublishSweep(), "publish-due");
  every(60 * 60_000, () => {
    const removed = cleanupSessions();
    if (removed) logger.info("jobs.sessions_cleaned", { removed });
  }, "sessions-cleanup");
  every(24 * 60 * 60_000, () => {
    const idem = cleanupIdempotency(7);
    const audit = purgeAuditOlderThan(180);
    const loginAttempts = cleanupLoginAttempts(30);
    logger.info("jobs.daily_cleanup", {
      idempotencyRemoved: idem,
      auditRemoved: audit,
      loginAttemptsRemoved: loginAttempts,
    });
  }, "daily-cleanup");
  logger.info("jobs.started");
}

export function stopJobs() {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
