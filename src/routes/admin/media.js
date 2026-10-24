import express from "express";
import multer from "multer";
import { config } from "../../config.js";
import { listMedia, getMedia, updateMediaAlt, deleteMedia, mediaUsageCount } from "../../db/media.js";
import { storeImage, deleteImageFile } from "../../lib/uploads.js";
import { logAudit } from "../../db/audit.js";
import { notFound, forbidden } from "../../lib/errors.js";
import { verifyCsrfToken } from "../../middleware/auth.js";
import { renderMedia } from "../../views/admin/media.js";

export const mediaAdminRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

function uploadSingle(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const code = error.code === "LIMIT_FILE_SIZE" ? "too_large" : "upload_failed";
      return res.redirect(`/admin/media?err=${code}`);
    }
    if (!verifyCsrfToken(req)) {
      return next(forbidden("Phiên làm việc hết hạn hoặc token bảo vệ không đúng."));
    }
    next();
  });
}

mediaAdminRouter.get("/media", (req, res) => {
  const q = String(req.query.q || "").slice(0, 100);
  const pick = req.query.pick === "1";
  const result = listMedia({ q, page: Number(req.query.page) || 1, perPage: 24 });
  res.send(renderMedia(res.locals, { result, q, pick }));
});

mediaAdminRouter.post("/media", uploadSingle, (req, res, next) => {
  try {
    if (!req.file) return res.redirect("/admin/media?err=upload_failed");
    const media = storeImage({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      alt: req.body.alt || "",
      uploadedBy: req.user.id,
    });
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "media.uploaded",
      entityType: "media",
      entityId: media.id,
      meta: { filename: media.filename, size: media.size, mime: media.mime },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    const back = req.body.pick === "1" ? "/admin/media?pick=1&msg=uploaded" : "/admin/media?msg=uploaded";
    return res.redirect(back);
  } catch (error) {
    if (error.code === "too_large" || error.code === "invalid_image") {
      return res.redirect(`/admin/media?err=${error.code}`);
    }
    next(error);
  }
});

mediaAdminRouter.post("/media/:id/alt", (req, res, next) => {
  try {
    const media = getMedia(req.params.id);
    if (!media) throw notFound("Ảnh không tồn tại");
    updateMediaAlt(media.id, req.body.alt || "");
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "media.alt_updated",
      entityType: "media",
      entityId: media.id,
      meta: { filename: media.filename },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect(req.body.pick === "1" ? "/admin/media?pick=1&msg=media_updated" : "/admin/media?msg=media_updated");
  } catch (error) {
    next(error);
  }
});

mediaAdminRouter.post("/media/:id/delete", (req, res, next) => {
  try {
    const media = getMedia(req.params.id);
    if (!media) throw notFound("Ảnh không tồn tại");
    if (mediaUsageCount(media.id) > 0) return res.redirect("/admin/media?err=media_in_use");
    deleteImageFile(media.filename);
    deleteMedia(media.id);
    logAudit({
      actorType: "user",
      actorId: req.user.id,
      action: "media.deleted",
      entityType: "media",
      entityId: media.id,
      meta: { filename: media.filename },
      ip: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return res.redirect("/admin/media?msg=media_deleted");
  } catch (error) {
    next(error);
  }
});
