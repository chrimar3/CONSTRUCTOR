// T019 — SC-5 separation-test report: `bun run report --separation` prints the
// v_separation view (per-operator handled_by distribution) with Greek headers.
//
// Available from DAY ONE: the command needs no --builder/--project/--period and
// renders a plain Greek statement (never an error) on an empty database.
// Article III: the counts come from queries.ts SQL over v_separation only, with
// a deterministic ORDER BY (the view itself has no order) — same DB ⇒
// byte-identical stdout, pinned by spawning the CLI twice.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { separationCounts } from "../src/db/queries";
import { separationReport } from "../src/report/separation";

// ─── Fixture ─────────────────────────────────────────────────────────────────
//
// One project, one opportunity, SEVEN events split across the three operators:
// Χρήστος 3 · Λωίδα 2 · Γιολάντα 2. The Λωίδα/Γιολάντα tie pins the
// deterministic tie-break (byte-order name: Γιολάντα before Λωίδα).

const NEXT = "Επόμενη επικοινωνία με τον αγοραστή";

function eventsFixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: "Κατασκευαστική Άλφα ΑΕ",
        project_name: "Αυλή Κυψέλης",
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Β",
        total_units: 1,
        listed_at: "2026-03-01T00:00:00.000Z",
        units: [{ unit_code: "Β1", asking_initial: 200000, sqm: 75 }],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-02-20T09:00:00.000Z" },
    ],
    opportunities: [
      {
        project: "Αυλή Κυψέλης",
        buyer: "#1",
        focus_unit: "Β1",
        stage: "Προσφορά",
        temperature: "hot",
        next_action: NEXT,
        next_owner: "Χρήστος",
        updated_at: "2026-03-20T12:00:00.000Z",
        events: [
          { type: "inquiry", date: "2026-03-02", handled_by: "Χρήστος", next_action: NEXT },
          { type: "viewing", date: "2026-03-05", unit: "Β1", interest: 3, handled_by: "Χρήστος", next_action: NEXT },
          { type: "offer", date: "2026-03-20", unit: "Β1", amount: 180000, handled_by: "Χρήστος", next_action: NEXT },
          { type: "viewing", date: "2026-03-08", unit: "Β1", interest: 4, handled_by: "Λωίδα", next_action: NEXT },
          { type: "offer", date: "2026-03-15", unit: "Β1", amount: 175000, handled_by: "Λωίδα", next_action: NEXT },
          { type: "viewing", date: "2026-03-10", unit: "Β1", interest: 4, handled_by: "Γιολάντα", next_action: NEXT },
          { type: "viewing", date: "2026-03-12", unit: "Β1", interest: 5, handled_by: "Γιολάντα", next_action: NEXT },
        ],
      },
    ],
  };
}

let db: Database;
beforeEach(() => {
  db = initDb(":memory:");
});

// ─── Query layer: separationCounts reads v_separation deterministically ──────

describe("separationCounts — v_separation with a deterministic order", () => {
  test("empty database → empty distribution (no throw)", () => {
    expect(separationCounts(db)).toEqual([]);
  });

  test("SC-5: seeded events produce correct per-operator counts", () => {
    seed(db, eventsFixture());
    const rows = separationCounts(db);
    expect(rows).toHaveLength(3);
    const byName = new Map(rows.map((r) => [r.handledBy, r.events]));
    expect(byName.get("Χρήστος")).toBe(3);
    expect(byName.get("Λωίδα")).toBe(2);
    expect(byName.get("Γιολάντα")).toBe(2);
  });

  test("order is busiest-first, ties broken by name (byte order) — Article III determinism", () => {
    seed(db, eventsFixture());
    expect(separationCounts(db).map((r) => r.handledBy)).toEqual([
      "Χρήστος",
      "Γιολάντα",
      "Λωίδα",
    ]);
  });
});

// ─── Renderer: Greek Markdown, total over data ───────────────────────────────

describe("separationReport — Greek Markdown of the distribution", () => {
  test("renders Greek headers and one row per operator with the correct count", () => {
    seed(db, eventsFixture());
    const report = separationReport(db);
    expect(report).toStartWith("# Έλεγχος διαχωρισμού");
    expect(report).toContain("| Χειριστής | Γεγονότα |");
    expect(report).toContain("| Χρήστος | 3 |");
    expect(report).toContain("| Λωίδα | 2 |");
    expect(report).toContain("| Γιολάντα | 2 |");
  });

  test("rows follow the deterministic query order", () => {
    seed(db, eventsFixture());
    const report = separationReport(db);
    const idx = (name: string) => report.indexOf(`| ${name} |`);
    expect(idx("Χρήστος")).toBeGreaterThan(-1);
    expect(idx("Χρήστος")).toBeLessThan(idx("Γιολάντα"));
    expect(idx("Γιολάντα")).toBeLessThan(idx("Λωίδα"));
  });

  test("day-one empty database → plain Greek statement + concrete action, no table, no throw", () => {
    const report = separationReport(db);
    expect(report).toContain("Δεν έχουν καταγραφεί ακόμη γεγονότα");
    expect(report).toContain("**Σύσταση:**");
    expect(report).not.toContain("| Χειριστής |");
  });

  test("ends with a trailing newline (stdout hygiene, matches the other renderers)", () => {
    expect(separationReport(db)).toEndWith("\n");
  });
});

// ─── Process level: bun run report --separation ──────────────────────────────

describe("CLI --separation — standalone, exit codes, byte determinism", () => {
  const CLI_PATH = join(import.meta.dir, "..", "src", "report", "cli.ts");
  let seededDir: string;
  let emptyDir: string;

  beforeAll(() => {
    seededDir = mkdtempSync(join(tmpdir(), "constructor-sep-"));
    const seededDb = initDb(join(seededDir, "constructor.db"));
    seed(seededDb, eventsFixture());
    seededDb.close();

    emptyDir = mkdtempSync(join(tmpdir(), "constructor-sep-empty-"));
    const emptyDb = initDb(join(emptyDir, "constructor.db"));
    emptyDb.close();
  });

  afterAll(() => {
    rmSync(seededDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  function run(cwd: string, args: string[]) {
    return Bun.spawnSync({
      cmd: [process.execPath, CLI_PATH, ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("SC-5: --separation alone (no builder/project/period) prints the distribution, exit 0", () => {
    const result = run(seededDir, ["--separation"]);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toStartWith("# Έλεγχος διαχωρισμού");
    expect(out).toContain("| Χειριστής | Γεγονότα |");
    expect(out).toContain("| Χρήστος | 3 |");
    expect(out).toContain("| Λωίδα | 2 |");
    expect(out).toContain("| Γιολάντα | 2 |");
  });

  test("Article III: same DB ⇒ byte-identical stdout (run twice)", () => {
    const first = run(seededDir, ["--separation"]);
    const second = run(seededDir, ["--separation"]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(Buffer.compare(Buffer.from(first.stdout), Buffer.from(second.stdout))).toBe(0);
  });

  test("day one: empty database still prints a complete Greek page, exit 0", () => {
    const result = run(emptyDir, ["--separation"]);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("Δεν έχουν καταγραφεί ακόμη γεγονότα");
    expect(out).toContain("**Σύσταση:**");
    expect(result.stderr.toString()).toBe("");
  });

  test("--separation takes precedence over report flags (documented standalone semantics)", () => {
    const result = run(seededDir, [
      "--separation",
      "--builder=Κατασκευαστική Άλφα ΑΕ",
      "--project=Αυλή Κυψέλης",
      "--period=biweekly",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toStartWith("# Έλεγχος διαχωρισμού");
  });

  test("--help mentions --separation", () => {
    const result = run(seededDir, ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("--separation");
  });
});
