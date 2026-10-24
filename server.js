import { config } from "./src/config.js";
import { createApp } from "./src/app.js";
import { getDb, closeDb } from "./src/db/index.js";
import { startJobs, stopJobs } from "./src/jobs/scheduler.js";
import { logger } from "./src/lib/logger.js";

const app = createApp();
getDb();

const server = app.listen(config.port, () => {
  logger.info("server.started", {
    port: config.port,
    env: config.nodeEnv,
    siteUrl: config.siteUrl,
    db: config.dbPath,
  });
});

startJobs();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutdown", { signal });
  stopJobs();
  server.close(() => {
    closeDb();
    logger.info("server.stopped");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("server.shutdown_timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { reason: String(reason) });
});
process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error: error.message, stack: error.stack });
  shutdown("uncaughtException");
});
