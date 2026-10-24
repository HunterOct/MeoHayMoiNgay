export class HttpError extends Error {
  constructor(status, message, { code = "error", details = null, expose = true } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const badRequest = (message, options = {}) =>
  new HttpError(400, message, {
    code: "bad_request",
    ...(options && typeof options === "object" && ("code" in options || "details" in options)
      ? options
      : { details: options || null }),
  });
export const unauthorized = (message = "Cần đăng nhập") =>
  new HttpError(401, message, { code: "unauthorized" });
export const forbidden = (message = "Không có quyền thực hiện thao tác này", options = {}) =>
  new HttpError(403, message, { code: "forbidden", ...options });
export const notFound = (message = "Không tìm thấy nội dung") =>
  new HttpError(404, message, { code: "not_found" });
export const gone = (message = "Nội dung đã bị xóa") =>
  new HttpError(410, message, { code: "gone" });
export const conflict = (message, options = {}) =>
  new HttpError(409, message, { code: "conflict", ...(options || {}) });
export const tooManyRequests = (message = "Bạn thao tác quá nhanh, vui lòng thử lại sau") =>
  new HttpError(429, message, { code: "rate_limited" });
export const serviceUnavailable = (message = "Dịch vụ tạm thời không khả dụng") =>
  new HttpError(503, message, { code: "unavailable" });
