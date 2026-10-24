import path from "node:path";
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { logger } from "./lib/logger.js";
import { requestContext, helmetMiddleware, contentSecurityPolicy, originCheck } from "./middleware/security.js";
import { loadSession } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { publicRouter } from "./routes/public.js";
import { feedsRouter } from "./routes/feeds.js";
import { mediaRouter } from "./routes/media.js";
import { adminRouter } from "./routes/admin/index.js";
import { apiRouter } from "./routes/api.js";

export function createApp() {
  getDb();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.set("query parser", "simple");

  app.use(requestContext);
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/assets") || req.path.startsWith("/media")) return;
      logger.info("http.request", {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Date.now() - start,
        ip: req.ip,
      });
    });
    next();
  });
  app.use(helmetMiddleware);
  app.use(contentSecurityPolicy);
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  app.use(originCheck);
  app.use(express.urlencoded({ extended: false, limit: "1mb", parameterLimit: 200 }));
  app.use(express.json({ limit: "1mb" }));

  app.use(
    "/assets",
    express.static(path.join(config.publicDir, "assets"), {
      index: false,
      maxAge: "365d",
      immutable: true,
      setHeaders(res) {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    }),
  );
  app.use(
    express.static(config.publicDir, {
      index: false,
      maxAge: "1h",
      setHeaders(res) {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    }),
  );

  app.get("/healthz", (req, res) => {
    try {
      getDb().prepare("SELECT 1").get();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        status: "ok",
        uptime: Math.round(process.uptime()),
        time: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("health.failed", { error: error.message });
      res.status(503).json({ status: "error" });
    }
  });

  app.use(loadSession);

  app.use(feedsRouter);
  app.use("/media", mediaRouter);
  app.use("/admin", adminRouter);
  app.use("/api/v1", apiRouter);
  app.use(publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
