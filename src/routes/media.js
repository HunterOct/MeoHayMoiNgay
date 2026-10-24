import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { hotlinkGuard } from "../middleware/bot-guard.js";
import { getMediaByFilename } from "../db/media.js";
import { notFound } from "../lib/errors.js";

export const mediaRouter = express.Router();

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpg|jpeg|png|webp|gif)$/i;

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

mediaRouter.get("/:filename", hotlinkGuard, (req, res, next) => {
  const filename = String(req.params.filename || "");
  if (!SAFE_NAME.test(filename)) return next(notFound());
  const full = path.resolve(config.uploadDir, filename);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) return next(notFound());
  if (!fs.existsSync(full)) return next(notFound("Hình ảnh không tồn tại"));

  const media = getMediaByFilename(filename);
  const ext = path.extname(filename).toLowerCase();
  res.setHeader("Content-Type", media?.mime || MIME[ext] || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.sendFile(full);
});
