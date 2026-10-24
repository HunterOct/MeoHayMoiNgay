import { parseArgs } from "node:util";
import { openDatabase, closeDb } from "../src/db/index.js";
import { config } from "../src/config.js";
import { createOrUpdateAdmin } from "./lib/admin.js";
import { findById } from "../src/db/users.js";
import { updateUser } from "../src/db/users.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
  },
  allowPositionals: false,
});

const email = values.email || config.adminEmail;
const role = values.role || "admin";
if (!["admin", "editor", "author"].includes(role)) {
  console.error("Role phải là admin, editor hoặc author.");
  process.exit(1);
}

openDatabase(config.dbPath);
try {
  const result = await createOrUpdateAdmin({
    email,
    password: values.password,
    name: values.name || "Bé Dâu",
    role,
  });
  if (values.password === undefined && result.created && result.password) {
    console.log(`Đã tạo ${role}: ${result.user.email}`);
    console.log(`Mật khẩu tạm (chỉ hiển thị một lần): ${result.password}`);
  } else if (result.created) {
    console.log(`Đã tạo ${role}: ${result.user.email}`);
  } else {
    console.log(`Đã cập nhật: ${findById(result.user.id).email}${result.passwordChanged ? " (đã đổi mật khẩu)" : ""}`);
    if (!result.passwordChanged) console.log("Không đổi mật khẩu. Dùng --password để đặt mật khẩu mới.");
  }
  updateUser(result.user.id, { is_active: 1 });
} finally {
  closeDb();
}
