// T017 — src/report/cli.ts: `bun run report` — name-addressed, period-windowed
// Greek report command (FR-13, Article III reproducibility).
//
// DEFAULT mode = FIXED non-overlapping periods tiled from --anchor (default
// project.listed_at): consecutive reports NEVER double-count an event — an event
// exactly on a window edge appears in exactly one window (pinned below).
// --rolling = last N days ending on as-of (internal). --as-of=DATE computes as
// if run then. Same DB + same flags ⇒ byte-identical stdout (spawned twice,
// bytes compared). Unknown builder/project ⇒ clear Greek error, exit 1.
//
// No wall clock exists anywhere in src/report (Gate 4): when --as-of is omitted
// the reference day comes from the DATA (latest event day, else listed_at), so
// the same DB + same flags stay byte-identical even across days.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { monthlyWindow, previousWindow } from "../src/report/monthly";
import { fixedPeriodEnd, renderReport } from "../src/report/cli";

// ─── Fixture ─────────────────────────────────────────────────────────────────
//
// "Αυλή Κυψέλης" (builder "Κατασκευαστική Άλφα ΑΕ") listed 2026-03-01 → biweekly
// periods tile [Mar 1–14], [Mar 15–28], … Its ONLY event is a viewing dated
// EXACTLY 2026-03-15 — the first day of period 1, i.e. the edge between two
// adjacent fixed windows (FR-13 boundary probe).
//
// "Ήσυχο Έργο" (builder "Δομική Βήτα ΕΕ") has zero events ever → the default
// as-of falls back to listed_at (2026-06-01).

const BUILDER = "Κατασκευαστική Άλφα ΑΕ";
const PROJECT = "Αυλή Κυψέλης";

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: BUILDER,
        project_name: PROJECT,
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Β",
        total_units: 1,
        listed_at: "2026-03-01T00:00:00.000Z",
        units: [{ unit_code: "Β1", asking_initial: 200000, sqm: 75 }],
      },
      {
        builder_name: "Δομική Βήτα ΕΕ",
        project_name: "Ήσυχο Έργο",
        area: "Γκύζη",
        micro_area: "Γκύζη · Πλατεία Γκύζη, block Ε",
        total_units: 1,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [{ unit_code: "Ε1", asking_initial: 210000, sqm: 70 }],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-02-20T09:00:00.000Z" },
    ],
    opportunities: [
      {
        project: PROJECT,
        buyer: "#1",
        focus_unit: "Β1",
        stage: "Επίσκεψη",
        temperature: "warm",
        next_action: "Δεύτερη επίσκεψη με τον αγοραστή",
        next_owner: "Χρήστος",
        updated_at: "2026-03-15T12:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-03-15", // EXACTLY on the period-0 / period-1 edge
            unit: "Β1",
            interest: 3,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη με τον αγοραστή",
          },
        ],
      },
    ],
  };
}

let db: Database;
beforeEach(() => {
  db = initDb(":memory:");
  seed(db, fixture());
});

/** First "- Επίσκεψη: N" line = the period-totals viewing count. */
function totalViewings(report: string): number {
  const m = /- Επίσκεψη: (\d+)/.exec(report);
  if (m === null) throw new Error("no viewing total line found in report");
  return Number(m[1]);
}

// ─── Fixed-period math (pure, tiled from the anchor) ─────────────────────────

describe("fixedPeriodEnd — non-overlapping tiling from the anchor", () => {
  test("as-of on the anchor day → the first period's last day", () => {
    expect(fixedPeriodEnd("2026-01-01", "2026-01-01", 14)).toBe("2026-01-14");
  });

  test("as-of on the period's last day → same period", () => {
    expect(fixedPeriodEnd("2026-01-01", "2026-01-14", 14)).toBe("2026-01-14");
  });

  test("FR-13 edge: the day AFTER a period ends starts the NEXT period", () => {
    expect(fixedPeriodEnd("2026-01-01", "2026-01-15", 14)).toBe("2026-01-28");
  });

  test("as-of before the anchor tiles backwards deterministically", () => {
    // Period −1 = [2025-12-18, 2026-01-01).
    expect(fixedPeriodEnd("2026-01-01", "2025-12-31", 14)).toBe("2025-12-31");
  });

  test("90-day tiling: day 89 is period 0, day 90 is period 1", () => {
    expect(fixedPeriodEnd("2026-03-01", "2026-05-29", 90)).toBe("2026-05-29");
    expect(fixedPeriodEnd("2026-03-01", "2026-05-30", 90)).toBe("2026-08-27");
  });

  test("malformed dates throw RangeError with a Greek message", () => {
    expect(() => fixedPeriodEnd("2026-01-01", "31-12-2025", 14)).toThrow(RangeError);
    expect(() => fixedPeriodEnd("bogus", "2026-01-01", 14)).toThrow(/ημερομηνία/);
  });
});

describe("monthlyWindow periodDays parameter (quarterly = 90-day tiles)", () => {
  test("90-day window ends on as-of and spans 90 calendar days", () => {
    const w = monthlyWindow("2026-05-29", 90);
    expect(w.start).toBe("2026-03-01");
    expect(w.end).toBe("2026-05-29");
    expect(w.endExclusive).toBe("2026-05-30");
  });

  test("previousWindow of a 90-day window is the adjacent previous 90 days", () => {
    const prev = previousWindow(monthlyWindow("2026-05-29", 90));
    expect(prev.start).toBe("2025-12-01");
    expect(prev.end).toBe("2026-02-28");
    expect(prev.endExclusive).toBe("2026-03-01");
  });
});

// ─── Fixed mode (DEFAULT): FR-13 boundary event lands in exactly ONE window ──

describe("renderReport — fixed non-overlapping periods (default mode)", () => {
  const flags = { builder: BUILDER, project: PROJECT, period: "biweekly" };

  test("period-0 report (as-of inside period 0) frames the full period and excludes the edge event", () => {
    const report = renderReport(db, { ...flags, asOf: "2026-03-14" });
    expect(report).toContain("**Περίοδος αναφοράς:** 01.03.2026 – 14.03.2026 (14 ημέρες)");
    expect(totalViewings(report)).toBe(0);
  });

  test("period-1 report includes the edge event", () => {
    const report = renderReport(db, { ...flags, asOf: "2026-03-15" });
    expect(report).toContain("**Περίοδος αναφοράς:** 15.03.2026 – 28.03.2026 (14 ημέρες)");
    expect(totalViewings(report)).toBe(1);
  });

  test("FR-13: the boundary event appears in exactly ONE of two consecutive reports", () => {
    const period0 = renderReport(db, { ...flags, asOf: "2026-03-14" });
    const period1 = renderReport(db, { ...flags, asOf: "2026-03-15" });
    expect(totalViewings(period0) + totalViewings(period1)).toBe(1);
  });

  test("any as-of inside the same fixed period renders byte-identical output", () => {
    const a = renderReport(db, { ...flags, asOf: "2026-03-15" });
    const b = renderReport(db, { ...flags, asOf: "2026-03-20" });
    expect(b).toBe(a);
  });

  test("--anchor overrides the tiling origin", () => {
    // Anchor 2026-03-08 → period [Mar 8, Mar 22) contains the Mar 15 event.
    const report = renderReport(db, { ...flags, asOf: "2026-03-14", anchor: "2026-03-08" });
    expect(report).toContain("**Περίοδος αναφοράς:** 08.03.2026 – 21.03.2026 (14 ημέρες)");
    expect(totalViewings(report)).toBe(1);
  });
});

// ─── Rolling mode (internal): last N days ending on as-of ────────────────────

describe("renderReport — --rolling (last N days from as-of)", () => {
  test("rolling biweekly window ends on the as-of day itself", () => {
    const report = renderReport(db, {
      builder: BUILDER,
      project: PROJECT,
      period: "biweekly",
      rolling: true,
      asOf: "2026-03-16",
    });
    expect(report).toContain("**Περίοδος αναφοράς:** 03.03.2026 – 16.03.2026 (14 ημέρες)");
    expect(totalViewings(report)).toBe(1);
  });

  test("rolling monthly window is the last 30 days from as-of", () => {
    const report = renderReport(db, {
      builder: BUILDER,
      project: PROJECT,
      period: "monthly",
      rolling: true,
      asOf: "2026-03-16",
    });
    expect(report).toContain("**Περίοδος αναφοράς:** 15.02.2026 – 16.03.2026 (30 ημέρες)");
  });
});

// ─── Period dispatch: biweekly / monthly / quarterly renderers ───────────────

describe("renderReport — period dispatch", () => {
  test("monthly renders the monthly template over the fixed 30-day period", () => {
    const report = renderReport(db, {
      builder: BUILDER,
      project: PROJECT,
      period: "monthly",
      asOf: "2026-03-20",
    });
    expect(report).toContain(`# Μηνιαία αναφορά προόδου πωλήσεων — ${PROJECT}`);
    expect(report).toContain("**Περίοδος αναφοράς:** 01.03.2026 – 30.03.2026 (30 ημέρες)");
    expect(totalViewings(report)).toBe(1);
  });

  test("quarterly renders the extended template over the fixed 90-day period (US-6)", () => {
    const report = renderReport(db, {
      builder: BUILDER,
      project: PROJECT,
      period: "quarterly",
      asOf: "2026-03-20",
    });
    expect(report).toContain(`# Τριμηνιαία αναφορά προόδου πωλήσεων — ${PROJECT}`);
    expect(report).toContain("**Περίοδος αναφοράς:** 01.03.2026 – 29.05.2026 (90 ημέρες)");
    // Trend section compares the adjacent previous 90-day tile.
    expect(report).toContain("Τάση έναντι προηγούμενης περιόδου (01.12.2025 – 28.02.2026)");
  });
});

// ─── Default as-of: data-derived, never the wall clock (Article III) ─────────

describe("renderReport — default as-of comes from the data", () => {
  test("without --as-of the latest event day picks the period", () => {
    const explicit = renderReport(db, {
      builder: BUILDER,
      project: PROJECT,
      period: "biweekly",
      asOf: "2026-03-15",
    });
    const defaulted = renderReport(db, { builder: BUILDER, project: PROJECT, period: "biweekly" });
    expect(defaulted).toBe(explicit);
  });

  test("a project with zero events falls back to listed_at", () => {
    const report = renderReport(db, {
      builder: "Δομική Βήτα ΕΕ",
      project: "Ήσυχο Έργο",
      period: "biweekly",
    });
    expect(report).toContain("**Περίοδος αναφοράς:** 01.06.2026 – 14.06.2026 (14 ημέρες)");
  });
});

// ─── Caller errors: clear Greek messages ─────────────────────────────────────

describe("renderReport — Greek caller errors", () => {
  test("unknown builder names the builder in Greek", () => {
    expect(() =>
      renderReport(db, { builder: "Ανύπαρκτη ΑΕ", project: PROJECT, period: "biweekly" }),
    ).toThrow(/Άγνωστος κατασκευαστής «Ανύπαρκτη ΑΕ»/);
  });

  test("known builder + unknown project names both in Greek", () => {
    expect(() =>
      renderReport(db, { builder: BUILDER, project: "Ανύπαρκτο Έργο", period: "biweekly" }),
    ).toThrow(/Άγνωστο έργο «Ανύπαρκτο Έργο»/);
  });

  test("invalid period lists the allowed values in Greek", () => {
    expect(() =>
      renderReport(db, { builder: BUILDER, project: PROJECT, period: "weekly" }),
    ).toThrow(/Μη έγκυρη περίοδος/);
  });

  test("malformed --as-of throws a Greek RangeError", () => {
    expect(() =>
      renderReport(db, { builder: BUILDER, project: PROJECT, period: "biweekly", asOf: "15-03-2026" }),
    ).toThrow(/ημερομηνία/);
  });
});

// ─── Process-level: bun run report — stdout bytes, exit codes ────────────────

describe("CLI process — stdout, exit codes, byte determinism", () => {
  const CLI_PATH = join(import.meta.dir, "..", "src", "report", "cli.ts");
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "constructor-cli-"));
    const fileDb = initDb(join(workDir, "constructor.db"));
    seed(fileDb, fixture());
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

  const GOOD_ARGS = [
    `--builder=${BUILDER}`,
    `--project=${PROJECT}`,
    "--period=biweekly",
    "--as-of=2026-03-16",
  ];

  test("valid flags → Greek Markdown on stdout, exit 0", () => {
    const result = run(GOOD_ARGS);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toStartWith("# Αναφορά προόδου πωλήσεων");
    expect(out).toContain("**Περίοδος αναφοράς:** 15.03.2026 – 28.03.2026 (14 ημέρες)");
  });

  test("Article III: same DB + same flags ⇒ byte-identical stdout (run twice)", () => {
    const first = run(GOOD_ARGS);
    const second = run(GOOD_ARGS);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(Buffer.compare(Buffer.from(first.stdout), Buffer.from(second.stdout))).toBe(0);
  });

  test("unknown builder → Greek error on stderr, empty stdout, exit 1", () => {
    const result = run([
      "--builder=Ανύπαρκτη ΑΕ",
      `--project=${PROJECT}`,
      "--period=biweekly",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("Άγνωστος κατασκευαστής «Ανύπαρκτη ΑΕ»");
  });

  test("invalid --period → Greek error, exit 1", () => {
    const result = run([`--builder=${BUILDER}`, `--project=${PROJECT}`, "--period=weekly"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Μη έγκυρη περίοδος");
  });

  test("unknown flag → error, exit 1 (strict parsing)", () => {
    const result = run([...GOOD_ARGS, "--bogus=1"]);
    expect(result.exitCode).toBe(1);
  });

  test("missing required flag → Greek error, exit 1", () => {
    const result = run([`--builder=${BUILDER}`, "--period=biweekly"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--project");
  });

  test("--help → usage on stdout, exit 0", () => {
    const result = run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Χρήση");
  });

  test("no arguments → usage, exit 1", () => {
    const result = run([]);
    expect(result.exitCode).toBe(1);
  });
});
