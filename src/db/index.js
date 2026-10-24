import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { migrations } from "./schema.js";
import { logger } from "../lib/logger.js";

let instance = null;

export function openDatabase(filePath = config.dbPath) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  if (filePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  migrate(db);
  return db;
}

export function getDb() {
  if (!instance) instance = openDatabase();
  return instance;
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    });
    run();
    logger.info("db.migrated", { version: migration.version, name: migration.name });
  }
  return pending.length;
}

/** Wrap a function in a write transaction. Nested calls reuse the outer transaction. */
export function tx(fn) {
  const db = getDb();
  if (db.inTransaction) return fn();
  return db.transaction(fn)();
}

export function backupTo(targetPath) {
  const db = getDb();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  return db.backup(targetPath).then((result) => {
    logger.info("db.backup", { file: targetPath, pages: result.totalPages });
    return result;
  });
}
