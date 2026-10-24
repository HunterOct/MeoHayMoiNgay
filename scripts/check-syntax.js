import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["server.js"];
for (const dir of ["src", "scripts", "tests"]) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "legacy" || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) targets.push(full);
    }
  };
  walk(path.join(root, dir));
}

let failed = 0;
for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Syntax error: ${path.relative(root, file)}`);
    console.error(result.stderr.trim());
  }
}
console.log(`Checked ${targets.length} files, ${failed} failed.`);
process.exit(failed ? 1 : 0);
