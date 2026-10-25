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

export const forbidden = (message = "Không có quyền thực hiện thao tác này") =>
  new HttpError(403, message, { code: "forbidden" });

export const notFound = (message = "Không tìm thấy nội dung") =>
  new HttpError(404, message, { code: "not_found" });

export const gone = (message = "Nội dung đã bị xóa") =>
  new HttpError(410, message, { code: "gone" });

export const unauthorized = (message = "Cần đăng nhập") =>
  new HttpError(401, message, { code: "unauthorized" });
