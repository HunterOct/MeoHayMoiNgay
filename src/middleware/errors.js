import crypto from "node:crypto";
import { config } from "../config.js";
import { getSettings } from "../db/settings.js";
import { listCategories } from "../db/taxonomy.js";
import { listLatest } from "../db/posts.js";
import { logger } from "../lib/logger.js";
import { renderError } from "../views/error.js";
import { renderAdminError } from "../views/admin/error.js";

export function notFoundHandler(req, res, next) {
  const error = Object.assign(new Error("Không tìm thấy trang"), { status: 404, code: "not_found" });
  next(error);
}

function ensureChrome(res) {
  try {
    if (!res.locals.settings) res.locals.settings = getSettings();
    if (!res.locals.chrome) {
      const categories = listCategories({ withCounts: true });
      res.locals.chrome = {
        categories,
        latest: listLatest(5),
        groups: [...new Set(categories.map((category) => category.group_name))],
      };
    }
  } catch {
    res.locals.settings = res.locals.settings || {
      site_name: "Mẹo Hay Mỗi Ngày",
      site_tagline: "",
      site_description: "",
      copyright: "",
    };
    res.locals.chrome = res.locals.chrome || { categories: [], latest: [], groups: [] };
  }
  if (!res.locals.nonce) {
    res.locals.nonce = crypto.randomBytes(16).toString("base64");
  }
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    err = Object.assign(new Error("JSON không hợp lệ."), { status: 400, code: "invalid_json", expose: true });
  } else if (err.type === "entity.too.large") {
    err = Object.assign(new Error("Dữ liệu gửi lên quá lớn."), { status: 413, code: "payload_too_large" });
  } else if (err.type === "charset.unsupported") {
    err = Object.assign(new Error("Charset không được hỗ trợ."), { status: 415, code: "unsupported_charset" });
  }
  const status = Number(err.status) || 500;
  const isApi = req.path.startsWith("/api/");
  const requestId = req.id || "";
  const log = status >= 500 ? logger.error : logger.warn;
  log("request.failed", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    status,
    code: err.code,
    error: err.message,
    ...(status >= 500 && config.nodeEnv !== "production" ? { stack: err.stack } : {}),
  });

  if (isApi) {
    return res.status(status).json({
      error: {
        code: err.code || (status === 500 ? "internal_error" : "error"),
        message: status >= 500 ? "Đã có lỗi xảy ra, vui lòng thử lại sau." : err.message,
        ...(err.details ? { details: err.details } : {}),
        request_id: requestId,
      },
    });
  }

  ensureChrome(res);
  const titles = {
    400: "Yêu cầu không hợp lệ",
    401: "Cần đăng nhập",
    403: "Không có quyền truy cập",
    404: "Không tìm thấy trang",
    410: "Nội dung đã bị gỡ",
    429: "Truy cập quá nhanh",
    500: "Có lỗi xảy ra",
    503: "Tạm thời không khả dụng",
  };
  const messages = {
    400: "Yêu cầu gửi lên không hợp lệ.",
    401: "Vui lòng đăng nhập để tiếp tục.",
    403: err.message || "Bạn không có quyền truy cập nội dung này.",
    404: "Đường dẫn bạn mở không tồn tại hoặc đã được thay đổi.",
    410: "Nội dung này đã được gỡ khỏi blog.",
    429: err.message || "Bạn thao tác quá nhanh. Chờ một lát rồi thử lại.",
    500: "Máy chủ gặp sự cố khi xử lý yêu cầu. Vui lòng thử lại sau.",
    503: "Dịch vụ đang tạm bảo trì.",
  };

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.path.startsWith("/admin")) {
    return res.status(status).send(
      renderAdminError(res.locals, {
        status,
        title: titles[status] || "Có lỗi xảy ra",
        message: messages[status] || "Đã có lỗi xảy ra.",
      }),
    );
  }
  let latest = [];
  try {
    latest = listLatest(4);
  } catch {
    latest = [];
  }
  return res.status(status).send(
    renderError(res.locals, {
      status,
      title: titles[status] || "Có lỗi xảy ra",
      message: messages[status] || "Đã có lỗi xảy ra.",
      latest,
    }),
  );
}
