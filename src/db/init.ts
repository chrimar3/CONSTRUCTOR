import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(import.meta.dir, "schema.sql");
export const DEFAULT_DB_PATH = "constructor.db";

/**
 * Opens (creating if needed) the SQLite DB and applies schema.sql.
 * Idempotent: an already-initialized DB is left untouched.
 * Foreign keys are enabled per-connection (SQLite scopes the pragma to the connection).
 */
export function initDb(path: string = DEFAULT_DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");

  const initialized = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  if (!initialized) {
    db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  }
  return db;
}

if (import.meta.main) {
  const db = initDb();
  const tables = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'")
    .get();
  console.log(`constructor.db ready (${tables?.n} tables).`);
  db.close();
}
