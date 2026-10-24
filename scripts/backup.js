import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { openDatabase, closeDb, backupTo } from "../src/db/index.js";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(config.rootDir, "data/backups", stamp);
fs.mkdirSync(backupDir, { recursive: true });

openDatabase(config.dbPath);
await backupTo(path.join(backupDir, "blog.db"));
closeDb();

if (fs.existsSync(config.uploadDir)) {
  fs.cpSync(config.uploadDir, path.join(backupDir, "uploads"), { recursive: true });
}
fs.writeFileSync(
  path.join(backupDir, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      dbPath: config.dbPath,
      uploadDir: config.uploadDir,
      siteUrl: config.siteUrl,
    },
    null,
    2,
  ),
);

const root = path.join(config.rootDir, "data/backups");
const cutoff = Date.now() - config.backupRetentionDays * 86400 * 1000;
let removed = 0;
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const full = path.join(root, entry.name);
  const stat = fs.statSync(full);
  if (stat.mtimeMs < cutoff) {
    fs.rmSync(full, { recursive: true, force: true });
    removed += 1;
  }
}
console.log(`Backup written to ${backupDir}`);
console.log(`Old backups removed: ${removed}`);
