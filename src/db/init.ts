import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(import.meta.dir, "schema.sql");

/**
 * Opens (creating if needed) the SQLite database at `path`, enables foreign-key
 * enforcement for this connection, and applies src/db/schema.sql idempotently
 * (skipped when the schema is already present).
 */
export function initDb(path = "constructor.db"): Database {
  const db = new Database(path, { create: true });
  // Per-connection setting — must run on every open, not just first init.
  db.run("PRAGMA foreign_keys = ON");

  const hasSchema = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  if (!hasSchema) {
    db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  }

  return db;
}

if (import.meta.main) {
  const db = initDb();
  db.close();
  console.log("db:init OK — constructor.db ready (schema applied idempotently)");
}
