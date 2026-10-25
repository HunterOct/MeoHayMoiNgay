import fs from "node:fs";
import crypto from "node:crypto";

const meta = JSON.parse(fs.readFileSync("fixtures/seed-meta.json", "utf8"));
const secret = crypto.randomBytes(32).toString("base64url");
const keyId = crypto.randomBytes(5).toString("hex");
const key = `mh_${keyId}_${secret}`;
const hash = crypto.createHash("sha256").update(secret).digest("hex");
const now = new Date().toISOString();
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sql = [
  `INSERT INTO users (id,email,password_hash,name,role,is_active,created_at) VALUES ('user-m0-author','author@m0.test',${q(meta.passwordHash)},'M0 Author','author',1,${q(now)});`,
  `INSERT INTO users (id,email,password_hash,name,role,is_active,created_at) VALUES ('user-m0-editor','editor@m0.test',${q(meta.passwordHash)},'M0 Editor','editor',1,${q(now)});`,
  `INSERT INTO api_clients (id,name,key_id,key_hash,scopes,publish_mode,rate_limit_per_min,is_active,created_at) VALUES ('client-m0-low','M0 Low Rate',${q(keyId)},${q(hash)},'["posts:read"]','review',10,1,${q(now)});`,
].join("\n");
fs.writeFileSync("fixtures/extra-users.sql", sql);
fs.writeFileSync("fixtures/extra-meta.json", JSON.stringify({ lowRateKey: key, authorPassword: meta.password, editorPassword: meta.password }, null, 2));
console.log(JSON.stringify({ sqlBytes: sql.length, lowRateKeyId: keyId }));
