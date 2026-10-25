import { forbidden } from "./errors.js";

const PUBLISH_ROLES = new Set(["admin", "editor"]);

export function canPublish(user) {
  return Boolean(user && PUBLISH_ROLES.has(user.role));
}

export function canManageTaxonomy(user) {
  return canPublish(user);
}

export function canManageUsers(user) {
  return user?.role === "admin";
}

export function canManageApiClients(user) {
  return user?.role === "admin";
}

export function canManageSettings(user) {
  return user?.role === "admin";
}

export function canViewAudit(user) {
  return user?.role === "admin";
}

export function canPurge(user) {
  return user?.role === "admin";
}

export function canEditPost(user, post) {
  if (!user || !post) return false;
  if (user.role === "admin" || user.role === "editor") return true;
  if (user.role === "author" && post.author_id === user.id) {
    return ["draft", "review"].includes(post.status);
  }
  return false;
}

export function canDeletePost(user, post) {
  return canEditPost(user, post);
}

export function requirePermission(check, message = "Không có quyền thực hiện thao tác này") {
  return (req, res, next) => (check(req.user, req) ? next() : next(forbidden(message)));
}

export const ROLE_LABELS = {
  admin: "Quản trị viên",
  editor: "Biên tập viên",
  author: "Tác giả",
};

export const STATUS_LABELS = {
  draft: "Nháp",
  review: "Chờ duyệt",
  scheduled: "Đã lên lịch",
  published: "Đã xuất bản",
  archived: "Lưu trữ",
};
