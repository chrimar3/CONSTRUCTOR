// T011 — src/db/seed.ts + seed.example.json: Day-0 migration (US-7 / FR-10 / SC-6).
// The seed file is a declarative snapshot of an EXISTING pipeline (three arrays:
// projects+units, analytical buyers, opportunities+event history) referenced by
// natural keys, validated in full BEFORE any write, loaded in one transaction,
// idempotent on re-run (insert-if-absent by natural key). Tests are named after
// the requirement they pin so failures read as violations.

import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { activityCounters, listPipeline } from "../src/db/queries";
import { seed, type SeedFile } from "../src/db/seed";

const ROOT = join(import.meta.dir, "..");
const EXAMPLE_PATH = join(ROOT, "seed.example.json");
const SEED_TS = join(ROOT, "src", "db", "seed.ts");
const PII_KEY = /(name|phone|email|mail|tel)/i;
const GREEK = /[Α-Ωα-ωΆΈΉΊΌΎΏάέήίόύώϊϋΐΰ]/;

function example(): SeedFile {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}

/** Minimal valid seed file — cloned + mutated by the negative tests. */
function tiny(): SeedFile {
  return {
    projects: [
      {
        builder_name: "Δομική ΑΕ",
        project_name: "Τεστ-Α",
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Α",
        total_units: 1,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [{ unit_code: "Α1", asking_initial: 200000 }],
      },
    ],
    buyers: [
      {
        pseudonym: "#1",
        source_channel: "spitogatos",
        created_at: "2026-06-20T09:00:00.000Z",
      },
    ],
    opportunities: [
      {
        project: "Τεστ-Α",
        buyer: "#1",
        focus_unit: "Α1",
        stage: "Lead",
        temperature: "warm",
        next_action: "Τηλεφώνημα για ραντεβού",
        next_owner: "Χρήστος",
        updated_at: "2026-06-20T09:00:00.000Z",
        events: [
          {
            type: "inquiry",
            date: "2026-06-20T09:00:00.000Z",
            handled_by: "Χρήστος",
            next_action: "Τηλεφώνημα για ραντεβού",
          },
        ],
      },
    ],
  };
}

let db: Database;

beforeEach(() => {
  db = initDb(":memory:");
});

function projectId(name: string): number {
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM projects WHERE project_name = ?")
    .get(name);
  if (!row) throw new Error(`test: project "${name}" not found`);
  return row.id;
}

function count(table: string): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
}

function tableCounts() {
  return {
    projects: count("projects"),
    units: count("units"),
    buyers: count("buyers"),
    opportunities: count("opportunities"),
    events: count("sales_events"),
  };
}

describe("T011 seed — US-7/SC-6 Day-0 migration", () => {
  test("US-7/SC-6: seeding a fresh DB populates the board for every project in the file", () => {
    const data = example();
    seed(db, data);

    for (const p of data.projects) {
      const cards = listPipeline(db, projectId(p.project_name));
      const liveInFile = data.opportunities.filter(
        (o) =>
          o.project === p.project_name &&
          o.stage !== "Συμβόλαιο" &&
          o.stage !== "Fallthrough",
      );
      expect(cards.length).toBe(liveInFile.length);
      expect(cards.length).toBeGreaterThan(0); // board never empty on first launch
      for (const card of cards) {
        expect(card.pseudonym).toMatch(/^#\d+$/); // pseudonyms only — no PII
        expect(card.nextAction.trim().length).toBeGreaterThan(0); // Article II
        expect(card.nextAction).toMatch(GREEK);
        expect(["Χρήστος", "Λωίδα", "Γιολάντα"]).toContain(card.nextOwner);
      }
    }
  });

  test("US-7: activityCounters reflect the seeded event history per project", () => {
    const data = example();
    seed(db, data);

    for (const p of data.projects) {
      const opps = data.opportunities.filter((o) => o.project === p.project_name);
      const events = opps.flatMap((o) => o.events);
      const got = activityCounters(db, projectId(p.project_name));
      expect(got).toEqual({
        inquiries: events.filter((e) => e.type === "inquiry").length,
        viewings: events.filter((e) => e.type === "viewing").length,
        offers: events.filter((e) => e.type === "offer").length,
        liveOpportunities: opps.filter(
          (o) => o.stage !== "Συμβόλαιο" && o.stage !== "Fallthrough",
        ).length,
      });
    }
    // the example must exercise the counters non-trivially
    const kypseli = activityCounters(db, projectId("Κυψέλη-Α"));
    expect(kypseli.inquiries).toBeGreaterThan(0);
    expect(kypseli.viewings).toBeGreaterThan(0);
    expect(kypseli.offers).toBeGreaterThan(0);
  });

  test("re-seed: running seed twice does not crash and does not duplicate (insert-if-absent by natural key)", () => {
    const first = seed(db, example());
    const before = tableCounts();
    const second = seed(db, example()); // must not throw
    expect(tableCounts()).toEqual(before);
    expect(second.inserted).toEqual({
      projects: 0,
      units: 0,
      buyers: 0,
      opportunities: 0,
      events: 0,
    });
    expect(second.skipped.opportunities).toBe(first.inserted.opportunities);
  });

  test("Article II: blank opportunity next_action is rejected before any write", () => {
    const bad = tiny();
    bad.opportunities[0]!.next_action = " \t\n ";
    expect(() => seed(db, bad)).toThrow(/Article II/);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("Article II: blank event next_action is rejected before any write", () => {
    const bad = tiny();
    bad.opportunities[0]!.events[0]!.next_action = "";
    expect(() => seed(db, bad)).toThrow(/Article II/);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("Article IV: PII-shaped key on a buyer is rejected — the seed file is pseudonyms-only", () => {
    const bad = tiny();
    (bad.buyers[0] as Record<string, unknown>)["phone"] = "6941234567";
    expect(() => seed(db, bad)).toThrow(/Article IV/);
    expect(count("buyers")).toBe(0);
  });

  test("Article V: blank micro_area is rejected — never coarser than project + micro-area", () => {
    const bad = tiny();
    bad.projects[0]!.micro_area = "   ";
    expect(() => seed(db, bad)).toThrow(/Article V/);
    expect(count("projects")).toBe(0);
  });

  test("validation: unknown stage, temperature, and event type are rejected (Phase B stays dark)", () => {
    const badStage = tiny();
    badStage.opportunities[0]!.stage = "Κλείσιμο";
    expect(() => seed(db, badStage)).toThrow(/stage/);

    const badTemp = tiny();
    badTemp.opportunities[0]!.temperature = "tepid";
    expect(() => seed(db, badTemp)).toThrow(/temperature/);

    const badType = tiny();
    badType.opportunities[0]!.events[0]!.type = "teleport" as never;
    expect(() => seed(db, badType)).toThrow(/event type/);

    // reservation/contract capture is Phase B — a seed file must not smuggle it in
    const phaseB = tiny();
    phaseB.opportunities[0]!.events[0]!.type = "reservation" as never;
    expect(() => seed(db, phaseB)).toThrow(/event type/);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("validation: a viewing requires interest 1..5; an offer requires a positive integer amount", () => {
    const noInterest = tiny();
    noInterest.opportunities[0]!.events[0] = {
      type: "viewing",
      date: "2026-06-21T09:00:00.000Z",
      unit: "Α1",
      handled_by: "Χρήστος",
      next_action: "Δεύτερη επίσκεψη",
    };
    expect(() => seed(db, noInterest)).toThrow(/interest/);

    const badAmount = tiny();
    badAmount.opportunities[0]!.events[0] = {
      type: "offer",
      date: "2026-06-21T09:00:00.000Z",
      unit: "Α1",
      amount: -5,
      handled_by: "Χρήστος",
      next_action: "Αντιπρόταση",
    };
    expect(() => seed(db, badAmount)).toThrow(/amount/);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("validation: unresolved natural-key references and in-file grain violations are rejected", () => {
    const badBuyer = tiny();
    badBuyer.opportunities[0]!.buyer = "#99";
    expect(() => seed(db, badBuyer)).toThrow(/#99/);

    const badProject = tiny();
    badProject.opportunities[0]!.project = "Ανύπαρκτο";
    expect(() => seed(db, badProject)).toThrow(/Ανύπαρκτο/);

    const badUnit = tiny();
    badUnit.opportunities[0]!.focus_unit = "Ζ9";
    expect(() => seed(db, badUnit)).toThrow(/Ζ9/);

    // grain: one opportunity per buyer↔project, also within the file itself
    const dupOpp = tiny();
    dupOpp.opportunities.push(structuredClone(dupOpp.opportunities[0]!));
    expect(() => seed(db, dupOpp)).toThrow(/grain|one opportunity/i);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("atomicity: one invalid record anywhere means NOTHING is written", () => {
    const bad = example();
    bad.opportunities[bad.opportunities.length - 1]!.next_action = "";
    expect(() => seed(db, bad)).toThrow(/Article II/);
    expect(tableCounts()).toEqual({ projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 });
  });

  test("seed.example.json: quickstart names, Article V micro-area precision, spread across stages/operators, no PII keys", () => {
    const data = example();

    // quickstart.md invariants — the report commands must find this builder/project
    const kypseli = data.projects.find((p) => p.project_name === "Κυψέλη-Α");
    expect(kypseli).toBeDefined();
    expect(kypseli!.builder_name).toBe("Παπαδόπουλος");
    expect(kypseli!.micro_area).toBe("Κυψέλη · Πλατεία Κύπρου, block Α");

    // scale: 2 projects, ~6 units, ~8 buyers
    expect(data.projects.length).toBe(2);
    for (const p of data.projects) {
      expect(p.micro_area).toContain("·"); // project + micro-area precision, never coarse
    }
    expect(data.projects.flatMap((p) => p.units).length).toBeGreaterThanOrEqual(6);
    expect(data.buyers.length).toBeGreaterThanOrEqual(8);

    // buyer variety across segments and sources
    expect(new Set(data.buyers.map((b) => b.segment)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(data.buyers.map((b) => b.source_channel)).size).toBeGreaterThanOrEqual(4);

    // stages spread across the live funnel
    const stages = new Set(data.opportunities.map((o) => o.stage));
    for (const s of ["Lead", "Επίσκεψη", "Προσφορά"]) expect(stages.has(s)).toBe(true);

    // operators spread across both next_owner and handled_by
    const owners = new Set(data.opportunities.map((o) => o.next_owner));
    const handlers = new Set(data.opportunities.flatMap((o) => o.events.map((e) => e.handled_by)));
    for (const op of ["Χρήστος", "Λωίδα", "Γιολάντα"]) {
      expect(owners.has(op)).toBe(true);
      expect(handlers.has(op)).toBe(true);
    }

    // Greek next_actions everywhere (FR-11 product surface)
    for (const o of data.opportunities) {
      expect(o.next_action).toMatch(GREEK);
      for (const e of o.events) expect(e.next_action).toMatch(GREEK);
    }

    // NO PII anywhere in buyer/opportunity/event objects (the file is committed)
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          expect(k).not.toMatch(PII_KEY);
          walk(v);
        }
      }
    };
    walk(data.buyers);
    walk(data.opportunities);
  });

  test("CLI: bun src/db/seed.ts <file.json> populates constructor.db and re-running is safe", () => {
    const dir = mkdtempSync(join(tmpdir(), "t011-seed-cli-"));
    try {
      const run = () =>
        Bun.spawnSync({
          cmd: [process.execPath, SEED_TS, EXAMPLE_PATH],
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });

      const first = run();
      expect(first.exitCode).toBe(0);
      expect(first.stdout.toString()).toContain("Seed"); // Greek summary printed

      const seeded = initDb(join(dir, "constructor.db"));
      try {
        const pid = seeded
          .query<{ id: number }, [string]>("SELECT id FROM projects WHERE project_name = ?")
          .get("Κυψέλη-Α")!.id;
        expect(listPipeline(seeded, pid).length).toBeGreaterThan(0);
      } finally {
        seeded.close();
      }

      const second = run(); // idempotent — no crash, exit 0
      expect(second.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
