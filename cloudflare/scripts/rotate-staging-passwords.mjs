import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const users = [
  { id: "user-m0-admin", email: "m0@test.local", role: "admin" },
  { id: "user-m0-editor", email: "editor@m0.test", role: "editor" },
  { id: "user-m0-author", email: "author@m0.test", role: "author" },
];

const out = {};
const lines = [];
for (const user of users) {
  const password = `M2-${crypto.randomBytes(18).toString("base64url")}`;
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 * 2 }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
  const hash = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
  out[user.role] = { email: user.email, password };
  lines.push(
    `UPDATE users SET password_hash='${hash}', failed_attempts=0, locked_until=NULL, updated_at='${new Date().toISOString()}' WHERE id='${user.id}';`,
  );
}
fs.writeFileSync("fixtures/.m2-passwords.json", JSON.stringify(out, null, 2));
fs.writeFileSync("fixtures/.m2-passwords.sql", lines.join("\n"));
const result = spawnSync(
  "npx.cmd",
  [
    "wrangler", "d1", "execute", "meohay-m0-stg-230403", "--remote",
    "-c", "wrangler.remote.jsonc", "--env-file", ".env.wrangler",
    "--file", "fixtures/.m2-passwords.sql",
  ],
  { encoding: "utf8", shell: true },
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}
console.log(`Rotated ${users.length} staging passwords; credentials in fixtures/.m2-passwords.json`);
