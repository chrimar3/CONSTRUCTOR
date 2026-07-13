// T011a — Comps entry (FR-12): src/db/comps.ts.
// Operators enter known neighbourhood SALE prices (never asking) labelled by
// source; own sold units (units.sale_price NOT NULL) auto-count as
// 'own_transaction' alongside comps rows in the merge query the monthly
// report consumes. Tests are named after the requirement they pin.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { addComp, compsForMicroArea } from "../src/db/comps";

const COMPS_TS = join(import.meta.dir, "..", "src", "db", "comps.ts");
const MICRO = "Κυψέλη · Πλατεία Κύπρου, block Α";

let db: Database;

beforeEach(() => {
  db = initDb(":memory:");
});

afterEach(() => {
  db.close();
});

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    area: "Κυψέλη",
    microArea: MICRO,
    salePrice: 185000,
    source: "manual_known_sale",
    enteredBy: "Χρήστος",
    ...overrides,
  } as Parameters<typeof addComp>[1];
}

function compCount(): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM comps").get()!.n;
}

function addProject(microArea = MICRO): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', 'Αύρα', 'Κυψέλη', ?, 12, '2026-07-01')`,
    [microArea],
  );
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function addUnit(
  projectId: number,
  code: string,
  salePrice: number | null,
  sqm: number | null = 78,
  rooms: number | null = 2,
): void {
  db.run(
    `INSERT INTO units (project_id, unit_code, sqm, rooms, asking_initial, asking_current, sale_price, status)
     VALUES (?, ?, ?, ?, 250000, 250000, ?, ?)`,
    [projectId, code, sqm, rooms, salePrice, salePrice === null ? "live" : "sold"],
  );
}

// ─── addComp: storage ────────────────────────────────────────────────────────

describe("addComp", () => {
  test("FR-12: manual comp stored with source 'manual_known_sale' and all fields", () => {
    const result = addComp(db, {
      area: "Κυψέλη",
      microArea: MICRO,
      sqm: 82,
      rooms: 3,
      salePrice: 210000,
      saleDate: "2026-06-15",
      source: "manual_known_sale",
      enteredBy: "Λωίδα",
      note: "Γωνιακό, 4ος όροφος",
    });

    expect(result.id).toBeGreaterThan(0);
    const row = db.query("SELECT * FROM comps WHERE id = ?").get(result.id) as any;
    expect(row.area).toBe("Κυψέλη");
    expect(row.micro_area).toBe(MICRO);
    expect(Number(row.sqm)).toBe(82);
    expect(Number(row.rooms)).toBe(3);
    expect(Number(row.sale_price)).toBe(210000);
    expect(row.sale_date).toBe("2026-06-15");
    expect(row.source).toBe("manual_known_sale");
    expect(row.entered_by).toBe("Λωίδα");
    expect(row.note).toBe("Γωνιακό, 4ος όροφος");
  });

  test("FR-12: own_transaction comp stored; entered_by optional for that source", () => {
    const result = addComp(db, {
      area: "Κυψέλη",
      microArea: MICRO,
      salePrice: 240000,
      source: "own_transaction",
    });
    const row = db.query("SELECT * FROM comps WHERE id = ?").get(result.id) as any;
    expect(row.source).toBe("own_transaction");
    expect(row.entered_by).toBeNull();
    expect(row.sqm).toBeNull();
    expect(row.sale_date).toBeNull();
  });

  test("FR-12: missing source rejected, nothing stored", () => {
    expect(() => addComp(db, manualInput({ source: undefined }))).toThrow(/source/);
    expect(compCount()).toBe(0);
  });

  test("FR-12: unknown source rejected (only own_transaction | manual_known_sale)", () => {
    expect(() => addComp(db, manualInput({ source: "portal_asking" }))).toThrow(/source/);
    expect(() => addComp(db, manualInput({ source: "asking" }))).toThrow(/source/);
    expect(compCount()).toBe(0);
  });

  test("Article V: missing or blank micro_area rejected", () => {
    for (const bad of [undefined, "", "   ", "\t\n"]) {
      expect(() => addComp(db, manualInput({ microArea: bad }))).toThrow(/Article V/);
    }
    expect(compCount()).toBe(0);
  });

  test("FR-12: blank area rejected (comps must stay locatable)", () => {
    expect(() => addComp(db, manualInput({ area: "  " }))).toThrow(/area/);
    expect(compCount()).toBe(0);
  });

  test("FR-12: sale_price must be a positive integer € (an actual SALE price)", () => {
    for (const bad of [0, -1000, 185000.5, NaN, Infinity, undefined]) {
      expect(() => addComp(db, manualInput({ salePrice: bad }))).toThrow(RangeError);
    }
    expect(compCount()).toBe(0);
  });

  test("FR-12: manual_known_sale requires entered_by (accountability for manual entries)", () => {
    for (const bad of [undefined, "", "  "]) {
      expect(() => addComp(db, manualInput({ enteredBy: bad }))).toThrow(/entered_by/);
    }
    expect(compCount()).toBe(0);
  });

  test("Article IV: PII-shaped input keys rejected before any write", () => {
    expect(() => addComp(db, manualInput({ buyerName: "Παπαδόπουλος" }))).toThrow(/Article IV/);
    expect(() => addComp(db, manualInput({ phone: "69XXXXXXXX" }))).toThrow(/Article IV/);
    expect(compCount()).toBe(0);
  });
});

// ─── Merge query: own sold units + manual comps ──────────────────────────────

describe("compsForMicroArea", () => {
  test("FR-12: own sold units auto-count as own_transaction alongside manual comps", () => {
    const projectId = addProject(MICRO);
    addUnit(projectId, "A1", 265000, 85, 3); // sold — must appear
    addUnit(projectId, "A2", null); // unsold — must NOT appear
    addComp(db, manualInput({ salePrice: 185000, sqm: 70, rooms: 2 }));

    const merged = compsForMicroArea(db, MICRO);
    expect(merged.length).toBe(2);

    const own = merged.filter((c) => c.source === "own_transaction");
    expect(own.length).toBe(1);
    expect(own[0]!.salePrice).toBe(265000);
    expect(own[0]!.sqm).toBe(85);
    expect(own[0]!.rooms).toBe(3);
    expect(own[0]!.microArea).toBe(MICRO);

    const manual = merged.filter((c) => c.source === "manual_known_sale");
    expect(manual.length).toBe(1);
    expect(manual[0]!.salePrice).toBe(185000);
  });

  test("FR-12/Article V: merge is scoped to the requested micro_area only", () => {
    const other = "Κυψέλη · Φωκίωνος Νέγρη, block Β";
    const projectId = addProject(other);
    addUnit(projectId, "B1", 300000); // sold, but in another micro-area
    addComp(db, manualInput({ microArea: other, salePrice: 199000 }));
    addComp(db, manualInput({ salePrice: 185000 }));

    const merged = compsForMicroArea(db, MICRO);
    expect(merged.length).toBe(1);
    expect(merged[0]!.salePrice).toBe(185000);

    const otherMerged = compsForMicroArea(db, other);
    expect(otherMerged.length).toBe(2);
  });

  test("Article III: merge query is deterministic — same DB, same output", () => {
    const projectId = addProject(MICRO);
    addUnit(projectId, "A1", 265000);
    addUnit(projectId, "A3", 230000, 65, 2);
    addComp(db, manualInput({ salePrice: 185000 }));
    addComp(db, manualInput({ salePrice: 199000, sqm: 75 }));

    const first = compsForMicroArea(db, MICRO);
    const second = compsForMicroArea(db, MICRO);
    expect(first.length).toBe(4);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// ─── CLI: bun run comp:add ───────────────────────────────────────────────────

describe("CLI comp:add", () => {
  test("FR-12: CLI stores a manual comp and confirms in Greek", () => {
    const dir = mkdtempSync(join(tmpdir(), "t011a-comp-cli-"));
    try {
      const proc = Bun.spawnSync({
        cmd: [
          process.execPath,
          COMPS_TS,
          "--area=Κυψέλη",
          `--micro-area=${MICRO}`,
          "--price=185000",
          "--source=manual_known_sale",
          "--entered-by=Χρήστος",
          "--sqm=78",
          "--rooms=2",
          "--date=2026-06-15",
        ],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).toMatch(/[Α-Ωα-ωάέήίόύώ]/); // Greek confirmation

      const stored = initDb(join(dir, "constructor.db"));
      try {
        const row = stored.query("SELECT * FROM comps").get() as any;
        expect(row.micro_area).toBe(MICRO);
        expect(Number(row.sale_price)).toBe(185000);
        expect(row.source).toBe("manual_known_sale");
        expect(row.entered_by).toBe("Χρήστος");
      } finally {
        stored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FR-12: help text states the price is an actual SALE price, never asking", () => {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, COMPS_TS, "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toMatch(/ΠΩΛΗΣΗΣ/i); // SALE price...
    expect(out).toMatch(/ποτέ ζητούμενη/i); // ...never asking
  });

  test("FR-12: CLI without required source fails (exit 1) and stores nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "t011a-comp-cli-bad-"));
    try {
      const proc = Bun.spawnSync({
        cmd: [
          process.execPath,
          COMPS_TS,
          "--area=Κυψέλη",
          `--micro-area=${MICRO}`,
          "--price=185000",
        ],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(1);

      const stored = initDb(join(dir, "constructor.db"));
      try {
        const n = stored.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM comps").get()!.n;
        expect(n).toBe(0);
      } finally {
        stored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
