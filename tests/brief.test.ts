// T018 — src/report/brief.ts + `--brief`: deterministic structured insight
// brief (Article III: the app NEVER calls an LLM — the brief emits RAW SIGNALS
// as structured JSON; the 2–3 Greek insight sentences are produced by a HUMAN
// running the interactive /insights command and pasted in afterwards).
//
// Signals (task brief): cold units (zero in-window offers, with their viewing
// counts + paired recommendation()), activity deltas vs the adjacent previous
// fixed period, offers-vs-asking gaps (latest offer below asking → € gap + %
// below). Same DB + same flags ⇒ byte-identical output (pinned in-process AND
// across two spawned CLI runs).
//
// Also pinned: the Markdown report is COMPLETE and sendable WITHOUT any insight
// content — placeholders only, no AI step in the path (Article III / FR-8).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { addComp } from "../src/db/comps";
import { recommendation } from "../src/domain/recommend";
import { insightBrief, renderBrief } from "../src/report/brief";
import { renderReport } from "../src/report/cli";

// ─── Fixture ─────────────────────────────────────────────────────────────────
//
// "Αυλή Κυψέλης" listed 2026-03-01 → biweekly tiles [Mar 1–14], [Mar 15–28], …
// Current tile (as-of inside [Mar 15–28]): 6 viewings (3 on Β1, 3 on Β2) and
// ONE offer (270.000 € on Β1, asking 300.000 € → gap 30.000 €, 10% below).
// Previous tile: 1 inquiry + 1 viewing → deltas −1 / +5 / +1.
// Β2 (3 viewings, 0 offers) and Β3 (silent) are the cold units; Β9 is sold and
// must not appear in the active-unit signals. One micro-area comp (240.000 €,
// 80 m² → 3.000 €/m²) grounds the comps-based € targets.

const BUILDER = "Κατασκευαστική Άλφα ΑΕ";
const PROJECT = "Αυλή Κυψέλης";
const MICRO_AREA = "Κυψέλη · Πλατεία Κύπρου, block Β";

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: BUILDER,
        project_name: PROJECT,
        area: "Κυψέλη",
        micro_area: MICRO_AREA,
        total_units: 4,
        listed_at: "2026-03-01T00:00:00.000Z",
        units: [
          { unit_code: "Β1", asking_initial: 300000, sqm: 75 },
          { unit_code: "Β2", asking_initial: 200000, sqm: 60 },
          { unit_code: "Β3", asking_initial: 180000 },
          { unit_code: "Β9", asking_initial: 250000, sqm: 70, status: "sold" },
        ],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-03-01T09:00:00.000Z" },
      { pseudonym: "#2", source_channel: "referral", created_at: "2026-03-10T09:00:00.000Z" },
    ],
    opportunities: [
      {
        project: PROJECT,
        buyer: "#1",
        focus_unit: "Β1",
        stage: "Προσφορά",
        temperature: "hot",
        next_action: "Αντιπρόταση στον αγοραστή",
        next_owner: "Χρήστος",
        updated_at: "2026-03-20T12:00:00.000Z",
        events: [
          // Previous tile [Mar 1–14]:
          {
            type: "inquiry",
            date: "2026-03-02",
            handled_by: "Χρήστος",
            next_action: "Κλείσιμο πρώτης επίσκεψης",
          },
          {
            type: "viewing",
            date: "2026-03-05",
            unit: "Β1",
            interest: 3,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη",
          },
          // Current tile [Mar 15–28]:
          {
            type: "viewing",
            date: "2026-03-16",
            unit: "Β1",
            interest: 4,
            handled_by: "Χρήστος",
            next_action: "Τρίτη επίσκεψη με σύζυγο",
          },
          {
            type: "viewing",
            date: "2026-03-17",
            unit: "Β1",
            interest: 4,
            handled_by: "Λωίδα",
            next_action: "Αναμονή απόφασης",
          },
          {
            type: "viewing",
            date: "2026-03-18",
            unit: "Β1",
            interest: 5,
            handled_by: "Χρήστος",
            next_action: "Πρόσκληση για προσφορά",
          },
          {
            type: "offer",
            date: "2026-03-20",
            unit: "Β1",
            amount: 270000,
            handled_by: "Χρήστος",
            next_action: "Αντιπρόταση στον αγοραστή",
          },
        ],
      },
      {
        project: PROJECT,
        buyer: "#2",
        focus_unit: "Β2",
        stage: "Επίσκεψη",
        temperature: "warm",
        next_action: "Επανάκληση σε 3 ημέρες",
        next_owner: "Λωίδα",
        updated_at: "2026-03-21T12:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-03-16",
            unit: "Β2",
            interest: 3,
            handled_by: "Λωίδα",
            next_action: "Αποστολή κάτοψης",
          },
          {
            type: "viewing",
            date: "2026-03-19",
            unit: "Β2",
            interest: 2,
            handled_by: "Γιολάντα",
            next_action: "Επανάκληση",
          },
          {
            type: "viewing",
            date: "2026-03-21",
            unit: "Β2",
            interest: 3,
            handled_by: "Λωίδα",
            next_action: "Επανάκληση σε 3 ημέρες",
          },
        ],
      },
    ],
  };
}

function loadFixture(db: Database): void {
  seed(db, fixture());
  addComp(db, {
    area: "Κυψέλη",
    microArea: MICRO_AREA,
    salePrice: 240000,
    sqm: 80,
    source: "manual_known_sale",
    enteredBy: "Χρήστος",
    saleDate: "2026-01-15",
  });
}

let db: Database;
beforeEach(() => {
  db = initDb(":memory:");
  loadFixture(db);
});

// The current fixed tile, framed at its boundaries (as the CLI hands it over).
const OPTS = { projectId: 1, asOf: "2026-03-28", periodDays: 14, cadence: "biweekly" };

// ─── Pure signals: insightBrief() ────────────────────────────────────────────

describe("insightBrief — project identity and period frame", () => {
  test("Article V: project identity carries micro-area precision", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.project).toEqual({
      builderName: BUILDER,
      projectName: PROJECT,
      microArea: MICRO_AREA,
    });
  });

  test("period frames the injected window (14 days ending on asOf)", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.period).toEqual({
      cadence: "biweekly",
      start: "2026-03-15",
      end: "2026-03-28",
      days: 14,
    });
  });
});

describe("insightBrief — activity deltas vs the adjacent previous period", () => {
  test("totals come from SQL for the current window", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.totals).toEqual({ inquiries: 0, viewings: 6, offers: 1 });
  });

  test("previous period is the adjacent equally-long window with its own totals", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.previousPeriod).toEqual({
      start: "2026-03-01",
      end: "2026-03-14",
      inquiries: 1,
      viewings: 1,
      offers: 0,
    });
  });

  test("deltas = current minus previous, signed", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.deltas).toEqual({ inquiries: -1, viewings: 5, offers: 1 });
  });
});

describe("insightBrief — cold units (zero in-window offers)", () => {
  test("cold units are flagged and listed with their viewing counts", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.coldUnits).toEqual(["Β2", "Β3"]);
    const b2 = brief.units.find((u) => u.unitCode === "Β2")!;
    const b3 = brief.units.find((u) => u.unitCode === "Β3")!;
    expect(b2.cold).toBe(true);
    expect(b2.viewings).toBe(3);
    expect(b3.cold).toBe(true);
    expect(b3.viewings).toBe(0);
  });

  test("a unit with an in-window offer is not cold", () => {
    const brief = insightBrief(db, OPTS);
    const b1 = brief.units.find((u) => u.unitCode === "Β1")!;
    expect(b1.cold).toBe(false);
  });

  test("Article VI: every unit signal carries the verbatim data-derived recommendation()", () => {
    const brief = insightBrief(db, OPTS);
    const b2 = brief.units.find((u) => u.unitCode === "Β2")!;
    // 3 viewings, 0 offers, comps target 3.000 €/m² × 60 m² = 180.000 €.
    expect(b2.compsTarget).toBe(180000);
    expect(b2.recommendation).toBe(
      recommendation({ viewings: 3, offers: 0, compsTarget: 180000 }),
    );
    const b3 = brief.units.find((u) => u.unitCode === "Β3")!;
    // No sqm → no defensible comps target → presentation branch without a figure.
    expect(b3.compsTarget).toBeNull();
    expect(b3.recommendation).toBe(recommendation({ viewings: 0, offers: 0, compsTarget: null }));
    const b1 = brief.units.find((u) => u.unitCode === "Β1")!;
    expect(b1.recommendation).toBe(
      recommendation({ viewings: 3, offers: 1, compsTarget: b1.compsTarget }),
    );
  });
});

describe("insightBrief — offers-vs-asking gaps", () => {
  test("latest in-window offer below asking → € gap + percent below asking", () => {
    const brief = insightBrief(db, OPTS);
    const b1 = brief.units.find((u) => u.unitCode === "Β1")!;
    expect(b1.latestOfferAmount).toBe(270000);
    expect(b1.askingCurrent).toBe(300000);
    expect(b1.offerGap).toEqual({ amount: 30000, pctBelowAsking: 10 });
  });

  test("units without an in-window offer have offerGap null", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.units.find((u) => u.unitCode === "Β2")!.offerGap).toBeNull();
    expect(brief.units.find((u) => u.unitCode === "Β3")!.offerGap).toBeNull();
  });
});

describe("insightBrief — unit universe and comps context", () => {
  test("active inventory only: sold/withdrawn units excluded, deterministic order", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.units.map((u) => u.unitCode)).toEqual(["Β1", "Β2", "Β3"]);
  });

  test("compsCount reflects the micro-area comps merge (so the AI step never invents comps)", () => {
    const brief = insightBrief(db, OPTS);
    expect(brief.compsCount).toBe(1);
  });
});

describe("insightBrief — determinism and caller errors", () => {
  test("Article III: same DB + same options ⇒ identical serialized output", () => {
    expect(renderBrief(db, OPTS)).toBe(renderBrief(db, OPTS));
  });

  test("renderBrief output is well-formed JSON ending in a newline", () => {
    const out = renderBrief(db, OPTS);
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).toEqual([
      "project",
      "period",
      "totals",
      "previousPeriod",
      "deltas",
      "units",
      "coldUnits",
      "compsCount",
    ]);
  });

  test("unknown project throws (caller error, matches report renderers)", () => {
    expect(() => insightBrief(db, { ...OPTS, projectId: 99 })).toThrow(/not found/);
  });

  test("malformed asOf throws RangeError before any rendering", () => {
    expect(() => insightBrief(db, { ...OPTS, asOf: "28-03-2026" })).toThrow(RangeError);
  });
});

// ─── renderReport integration: --brief shares the report's window machinery ──

describe("renderReport — brief flag", () => {
  const flags = { builder: BUILDER, project: PROJECT, period: "biweekly" };

  test("brief covers the SAME fixed tile the report would (any as-of inside the tile)", () => {
    const out = renderReport(db, { ...flags, asOf: "2026-03-20", brief: true });
    const parsed = JSON.parse(out);
    expect(parsed.period).toEqual({
      cadence: "biweekly",
      start: "2026-03-15",
      end: "2026-03-28",
      days: 14,
    });
  });

  test("brief respects --rolling (last N days ending on as-of)", () => {
    const out = renderReport(db, { ...flags, asOf: "2026-03-20", rolling: true, brief: true });
    const parsed = JSON.parse(out);
    expect(parsed.period.start).toBe("2026-03-07");
    expect(parsed.period.end).toBe("2026-03-20");
  });

  test("Article III / FR-8: the Markdown report is complete WITHOUT any insight content", () => {
    const md = renderReport(db, { ...flags, asOf: "2026-03-20" });
    // Full report renders: header, totals, per-unit blocks, placeholder section.
    expect(md).toStartWith("# Αναφορά προόδου πωλήσεων");
    expect(md).toContain("## Επισημάνσεις συμβούλου");
    expect(md).toContain("<!-- INSIGHTS:START");
    expect(md).toContain("- _[Επισήμανση 1 — προς συμπλήρωση από το βήμα /insights]_");
    // No brief/JSON content leaks into the client-facing Markdown.
    expect(md).not.toContain("coldUnits");
    expect(md).not.toContain("offerGap");
  });
});

// ─── Process-level: bun run report --brief ───────────────────────────────────

describe("CLI process — --brief output well-formed and byte-deterministic", () => {
  const CLI_PATH = join(import.meta.dir, "..", "src", "report", "cli.ts");
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "constructor-brief-"));
    const fileDb = initDb(join(workDir, "constructor.db"));
    loadFixture(fileDb);
    fileDb.close();
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    return Bun.spawnSync({
      cmd: [process.execPath, CLI_PATH, ...args],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  const BRIEF_ARGS = [
    `--builder=${BUILDER}`,
    `--project=${PROJECT}`,
    "--period=biweekly",
    "--as-of=2026-03-20",
    "--brief",
  ];

  test("--brief → well-formed JSON on stdout, exit 0", () => {
    const result = run(BRIEF_ARGS);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.project.projectName).toBe(PROJECT);
    expect(parsed.totals).toEqual({ inquiries: 0, viewings: 6, offers: 1 });
    expect(parsed.coldUnits).toEqual(["Β2", "Β3"]);
  });

  test("Article III: same DB + same flags ⇒ byte-identical --brief stdout (run twice)", () => {
    const first = run(BRIEF_ARGS);
    const second = run(BRIEF_ARGS);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(Buffer.compare(Buffer.from(first.stdout), Buffer.from(second.stdout))).toBe(0);
  });

  test("without --brief the full Greek Markdown report still generates (no AI dependency)", () => {
    const result = run(BRIEF_ARGS.slice(0, -1));
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toStartWith("# Αναφορά προόδου πωλήσεων");
    expect(out).toContain("<!-- INSIGHTS:START");
  });

  test("--brief with unknown builder → Greek error on stderr, exit 1", () => {
    const result = run([
      "--builder=Ανύπαρκτη ΑΕ",
      `--project=${PROJECT}`,
      "--period=biweekly",
      "--brief",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("Άγνωστος κατασκευαστής");
  });
});
