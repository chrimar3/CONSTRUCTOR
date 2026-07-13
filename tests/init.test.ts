import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";

const EXPECTED_TABLES = [
  "projects",
  "units",
  "price_changes",
  "buyers",
  "buyer_identity",
  "opportunities",
  "sales_events",
  "marketing_assets",
  "comps",
].sort();

const EXPECTED_VIEWS = [
  "v_velocity",
  "v_price_realization",
  "v_buyer_pool",
  "v_separation",
].sort();

let dbPath: string;
let openDbs: Database[] = [];

function tempDbPath(): string {
  return join(tmpdir(), `constructor-test-${crypto.randomUUID()}.db`);
}

function track(db: Database): Database {
  openDbs.push(db);
  return db;
}

function names(db: Database, type: "table" | "view"): string[] {
  return db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all(type)
    .map((r) => r.name);
}

afterEach(() => {
  for (const db of openDbs) db.close();
  openDbs = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (p && existsSync(p)) rmSync(p);
  }
});

describe("initDb", () => {
  test("creates the DB file at the given path", () => {
    dbPath = tempDbPath();
    expect(existsSync(dbPath)).toBe(false);
    track(initDb(dbPath));
    expect(existsSync(dbPath)).toBe(true);
  });

  test("applies schema.sql: all 9 tables and 4 views present", () => {
    dbPath = tempDbPath();
    const db = track(initDb(dbPath));
    expect(names(db, "table")).toEqual(EXPECTED_TABLES);
    expect(names(db, "view")).toEqual(EXPECTED_VIEWS);
  });

  test("PRAGMA foreign_keys is ON for the returned connection", () => {
    dbPath = tempDbPath();
    const db = track(initDb(dbPath));
    const row = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
    expect(row?.foreign_keys).toBe(1);
  });

  test("FK enforcement fires on a dangling reference", () => {
    dbPath = tempDbPath();
    const db = track(initDb(dbPath));
    expect(() =>
      db.run(
        `INSERT INTO units (project_id, unit_code, asking_initial, asking_current)
         VALUES (999, 'A1', 100000, 100000)`
      )
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("double-init is a no-op: no error, existing data survives", () => {
    dbPath = tempDbPath();
    const db1 = track(initDb(dbPath));
    db1.run(
      `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
       VALUES ('Δομική ΑΕ', 'Αύρα', 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`
    );

    const db2 = track(initDb(dbPath));
    expect(names(db2, "table")).toEqual(EXPECTED_TABLES);
    expect(names(db2, "view")).toEqual(EXPECTED_VIEWS);
    const count = db2
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects")
      .get();
    expect(count?.n).toBe(1);
  });
});
