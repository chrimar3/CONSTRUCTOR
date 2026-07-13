import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";

const TEST_DB = "/tmp/constructor-init-test.db";

afterEach(() => {
  rmSync(TEST_DB, { force: true });
});

describe("initDb", () => {
  test("creates the DB file and applies the schema", () => {
    const db = initDb(TEST_DB);
    expect(existsSync(TEST_DB)).toBe(true);

    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
      )
      .all()
      .map((r) => r.name);

    for (const table of [
      "projects",
      "units",
      "price_changes",
      "buyers",
      "buyer_identity",
      "opportunities",
      "sales_events",
      "marketing_assets",
      "comps",
    ]) {
      expect(names).toContain(table);
    }
    for (const view of ["v_velocity", "v_price_realization", "v_buyer_pool", "v_separation"]) {
      expect(names).toContain(view);
    }
    db.close();
  });

  test("enables foreign key enforcement", () => {
    const db = initDb(TEST_DB);
    const fk = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
    expect(fk?.foreign_keys).toBe(1);

    // FK actually fires: event referencing a missing opportunity must fail
    expect(() =>
      db.run(
        "INSERT INTO sales_events (opportunity_id, event_type, event_date, handled_by, next_action) VALUES (999, 'inquiry', '2026-07-13', 'Χρήστος', 'call back')"
      )
    ).toThrow();
    db.close();
  });

  test("is idempotent — calling twice on the same file does not fail", () => {
    initDb(TEST_DB).close();
    const db = initDb(TEST_DB);
    const count = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='projects'")
      .get();
    expect(count?.n).toBe(1);
    db.close();
  });
});
