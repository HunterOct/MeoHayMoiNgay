import { config } from "../../src/config.js";
import { findByEmailWithHash, insertUser, findById, setUserPassword, updateUser } from "../../src/db/users.js";
import { hashPassword, passwordProblem, generatePassword } from "../../src/lib/passwords.js";
import { setSettings } from "../../src/db/settings.js";

export async function ensureAdmin({ name = "Bé Dâu" } = {}) {
  const existing = findByEmailWithHash(config.adminEmail);
  if (existing) {
    return { user: findById(existing.id), created: false, password: null };
  }
  let password = config.adminPassword;
  if (password) {
    const problem = passwordProblem(password);
    if (problem) throw new Error(`ADMIN_PASSWORD không hợp lệ: ${problem}`);
  } else {
    password = generatePassword();
  }
  const passwordHash = await hashPassword(password);
  const user = insertUser({
    email: config.adminEmail,
    passwordHash,
    name,
    role: "admin",
    bio: "Người viết Mẹo Hay Mỗi Ngày — chuyên săn những mẹo vặt đời sống và trục trặc công nghệ trong nhà.",
  });
  setSettings({ default_author_id: user.id });
  return { user, created: true, password: config.adminPassword ? null : password };
}

export async function createOrUpdateAdmin({ email, password, name = "Bé Dâu", role = "admin" }) {
  const existing = findByEmailWithHash(email);
  if (existing) {
    if (password) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      await setUserPassword(existing.id, password);
    }
    updateUser(existing.id, { name, role });
    return { user: findById(existing.id), created: false, passwordChanged: Boolean(password) };
  }
  const finalPassword = password || generatePassword();
  const problem = passwordProblem(finalPassword);
  if (problem) throw new Error(problem);
  const user = insertUser({ email, passwordHash: await hashPassword(finalPassword), name, role });
  return { user, created: true, password: password ? null : finalPassword };
}
