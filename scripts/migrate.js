import { openDatabase, closeDb } from "../src/db/index.js";
import { config } from "../src/config.js";

const db = openDatabase(config.dbPath);
const version = db.pragma("user_version", { simple: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
console.log(`Database: ${config.dbPath}`);
console.log(`Schema version: ${version}`);
console.log(`Tables: ${tables.join(", ")}`);
closeDb();
