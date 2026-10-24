import express from "express";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listTags,
  findOrCreateTag,
  updateTag,
  deleteTag,
  getCategoryById,
} from "../../db/taxonomy.js";
import { canManageTaxonomy, requirePermission } from "../../lib/permissions.js";
import { logAudit } from "../../db/audit.js";
import { notFound } from "../../lib/errors.js";
import { renderCategories, renderTags } from "../../views/admin/taxonomy.js";

export const taxonomyAdminRouter = express.Router();

taxonomyAdminRouter.use(
  ["/categories", "/tags"],
  requirePermission(canManageTaxonomy, "Chỉ biên tập viên hoặc quản trị viên mới quản lý chuyên mục."),
);

function isUniqueError(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message || ""));
}

function audit(req, action, entityType, entityId, meta) {
  logAudit({
    actorType: "user",
    actorId: req.user.id,
    action,
    entityType,
    entityId,
    meta,
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  });
}

taxonomyAdminRouter.get("/categories", (req, res) => {
  res.send(
    renderCategories(res.locals, { categories: listCategories({ withCounts: true }) }),
  );
});

taxonomyAdminRouter.post("/categories", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 80) return res.redirect("/admin/categories?err=invalid");
  const group = req.body.group === "tech" ? "tech" : "life";
  try {
    const category = createCategory({
      name,
      slug: String(req.body.slug || "").trim(),
      group,
      description: String(req.body.description || "").trim().slice(0, 300),
      sortOrder: Number(req.body.sort_order) || 0,
    });
    audit(req, "taxonomy.category_created", "category", category.id, { name: category.name });
    return res.redirect("/admin/categories?msg=category_created");
  } catch (error) {
    if (isUniqueError(error)) return res.redirect("/admin/categories?err=duplicate");
    throw error;
  }
});

taxonomyAdminRouter.post("/categories/:id", (req, res) => {
  const existing = getCategoryById(req.params.id);
  if (!existing) throw notFound("Chuyên mục không tồn tại");
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 80) return res.redirect("/admin/categories?err=invalid");
  try {
    const category = updateCategory(existing.id, {
      name,
      slug: String(req.body.slug || "").trim(),
      group: req.body.group === "tech" ? "tech" : "life",
      description: String(req.body.description || "").trim().slice(0, 300),
      sortOrder: Number(req.body.sort_order) || 0,
    });
    audit(req, "taxonomy.category_updated", "category", category.id, { name: category.name });
    return res.redirect("/admin/categories?msg=category_updated");
  } catch (error) {
    if (isUniqueError(error) || error.code === "SLUG_TAKEN") {
      return res.redirect("/admin/categories?err=duplicate");
    }
    throw error;
  }
});

taxonomyAdminRouter.post("/categories/:id/delete", (req, res, next) => {
  try {
    const existing = getCategoryById(req.params.id);
    if (!existing) throw notFound("Chuyên mục không tồn tại");
    const reassignTo = String(req.body.reassign_to || "").trim() || null;
    if (reassignTo) {
      const target = getCategoryById(reassignTo);
      if (!target) return res.redirect("/admin/categories?err=invalid");
    }
    deleteCategory(existing.id, { reassignTo });
    audit(req, "taxonomy.category_deleted", "category", existing.id, {
      name: existing.name,
      reassignTo,
    });
    return res.redirect("/admin/categories?msg=category_deleted");
  } catch (error) {
    if (error.code === "CATEGORY_IN_USE") return res.redirect("/admin/categories?err=category_in_use");
    next(error);
  }
});

taxonomyAdminRouter.get("/tags", (req, res) => {
  res.send(renderTags(res.locals, { tags: listTags({ withCounts: true }) }));
});

taxonomyAdminRouter.post("/tags", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 60) return res.redirect("/admin/tags?err=invalid");
  try {
    const tag = findOrCreateTag(name);
    if (req.body.slug) updateTag(tag.id, { name, slug: String(req.body.slug).trim() });
    audit(req, "taxonomy.tag_created", "tag", tag.id, { name: tag.name });
    return res.redirect("/admin/tags?msg=tag_created");
  } catch (error) {
    if (isUniqueError(error) || error.code === "SLUG_TAKEN") return res.redirect("/admin/tags?err=duplicate");
    throw error;
  }
});

taxonomyAdminRouter.post("/tags/:id", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 60) return res.redirect("/admin/tags?err=invalid");
  try {
    const tag = updateTag(req.params.id, {
      name,
      slug: String(req.body.slug || "").trim(),
    });
    if (!tag) throw notFound("Thẻ không tồn tại");
    audit(req, "taxonomy.tag_updated", "tag", tag.id, { name: tag.name });
    return res.redirect("/admin/tags?msg=tag_updated");
  } catch (error) {
    if (isUniqueError(error) || error.code === "SLUG_TAKEN") return res.redirect("/admin/tags?err=duplicate");
    throw error;
  }
});

taxonomyAdminRouter.post("/tags/:id/delete", (req, res) => {
  deleteTag(req.params.id);
  audit(req, "taxonomy.tag_deleted", "tag", req.params.id, {});
  res.redirect("/admin/tags?msg=tag_deleted");
});

