// T014 — src/report/biweekly.ts: deterministic Greek Markdown report for the last
// 14 days of a project (US-5 / FR-8 / FR-11 / FR-13 / Articles III & VI).
// Every number comes from queries.ts SQL over a seeded fixture DB; the as-of date
// is INJECTED (no wall clock anywhere in the report path); same DB + same args
// must produce byte-identical output. Tests are named after the requirement they
// pin so a failure reads as a violation.

import { beforeEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { activityInWindow } from "../src/db/queries";
import { biweeklyReport, biweeklyWindow } from "../src/report/biweekly";

// ─── Fixture: a seeded pipeline with in-window, boundary and out-of-window events ─

const AS_OF = "2026-07-14"; // window = [2026-07-01, 2026-07-15) — 14 calendar days

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: "Κατασκευαστική Άλφα ΑΕ",
        project_name: "Ρετιρέ Κύπρου",
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Α",
        total_units: 3,
        listed_at: "2026-05-01T00:00:00.000Z",
        units: [
          { unit_code: "Α1", asking_initial: 250000 },
          { unit_code: "Α2", asking_initial: 180000 },
          { unit_code: "Β1", asking_initial: 320000 },
        ],
      },
      {
        // A second project with units but zero activity — the "quiet period" edge case.
        builder_name: "Δομική Βήτα ΕΕ",
        project_name: "Ήσυχο Έργο",
        area: "Γκύζη",
        micro_area: "Γκύζη · Πλατεία Γκύζη, block Γ",
        total_units: 1,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [{ unit_code: "Γ1", asking_initial: 210000 }],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-06-25T09:00:00.000Z" },
      { pseudonym: "#2", source_channel: "referral", created_at: "2026-07-03T10:00:00.000Z" },
      { pseudonym: "#3", source_channel: "xe", created_at: "2026-07-14T23:59:59.000Z" },
    ],
    opportunities: [
      {
        project: "Ρετιρέ Κύπρου",
        buyer: "#1",
        focus_unit: "Α1",
        stage: "Επίσκεψη",
        temperature: "hot",
        next_action: "Κλείσιμο τρίτης επίσκεψης με σύζυγο",
        next_owner: "Χρήστος",
        updated_at: "2026-07-10T18:00:00.000Z",
        events: [
          // OUT of window (before start):
          {
            type: "inquiry",
            date: "2026-06-25T09:00:00.000Z",
            handled_by: "Χρήστος",
            next_action: "Τηλεφώνημα για ραντεβού",
          },
          // EXACTLY on the window start boundary (date-only string):
          {
            type: "viewing",
            date: "2026-07-01",
            unit: "Α1",
            interest: 4,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη",
          },
          {
            type: "viewing",
            date: "2026-07-05T11:00:00.000Z",
            unit: "Α1",
            interest: 3,
            handled_by: "Λωίδα",
            next_action: "Τρίτη επίσκεψη με σύζυγο",
          },
          {
            type: "viewing",
            date: "2026-07-10T17:30:00.000Z",
            unit: "Α1",
            interest: 4,
            handled_by: "Χρήστος",
            next_action: "Αναμονή απόφασης έως Παρασκευή",
          },
        ],
      },
      {
        project: "Ρετιρέ Κύπρου",
        buyer: "#2",
        focus_unit: "Α2",
        stage: "Προσφορά",
        temperature: "hot",
        next_action: "Απάντηση στην αντιπροσφορά",
        next_owner: "Λωίδα",
        updated_at: "2026-07-12T12:00:00.000Z",
        events: [
          {
            type: "inquiry",
            date: "2026-07-03T10:00:00.000Z",
            handled_by: "Λωίδα",
            next_action: "Προγραμματισμός επίσκεψης",
          },
          {
            type: "viewing",
            date: "2026-07-08T10:00:00.000Z",
            unit: "Α2",
            interest: 5,
            handled_by: "Λωίδα",
            next_action: "Αναμονή προσφοράς",
          },
          {
            type: "offer",
            date: "2026-07-09T09:00:00.000Z",
            unit: "Α2",
            amount: 200000,
            handled_by: "Λωίδα",
            next_action: "Αντιπροσφορά προς αγοραστή",
          },
          // The LATEST offer is LOWER than the first — the report must show the
          // latest position (by event id), never MAX(amount).
          {
            type: "offer",
            date: "2026-07-12T12:00:00.000Z",
            unit: "Α2",
            amount: 190000,
            handled_by: "Γιολάντα",
            next_action: "Συνάντηση με κατασκευαστή για την προσφορά",
          },
        ],
      },
      {
        project: "Ρετιρέ Κύπρου",
        buyer: "#3",
        focus_unit: "Β1",
        stage: "Επίσκεψη",
        temperature: "cold",
        next_action: "Επιβεβαίωση επίσκεψης",
        next_owner: "Γιολάντα",
        updated_at: "2026-07-14T23:59:59.000Z",
        events: [
          // Last instant of the as-of day — still inside the window:
          {
            type: "inquiry",
            date: "2026-07-14T23:59:59.000Z",
            handled_by: "Γιολάντα",
            next_action: "Προγραμματισμός επίσκεψης",
          },
          // EXACTLY on the exclusive end boundary — must be OUTSIDE the window:
          {
            type: "viewing",
            date: "2026-07-15",
            unit: "Β1",
            interest: 2,
            handled_by: "Γιολάντα",
            next_action: "Επανεκτίμηση ενδιαφέροντος",
          },
        ],
      },
    ],
  };
}

let db: Database;

function projectId(name: string): number {
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM projects WHERE project_name = ?")
    .get(name);
  if (row === null) throw new Error(`fixture project missing: ${name}`);
  return Number(row.id);
}

beforeEach(() => {
  db = initDb(":memory:");
  seed(db, fixture());
});

// ─── FR-13: window computation (injected as-of, half-open [start, end)) ─────────

describe("FR-13: biweeklyWindow — last 14 days as a half-open window from an injected as-of date", () => {
  test("window for an as-of DATE covers the 14 calendar days ending on it (half-open)", () => {
    expect(biweeklyWindow("2026-07-14")).toEqual({
      start: "2026-07-01",
      end: "2026-07-14",
      endExclusive: "2026-07-15",
    });
  });

  test("a full ISO timestamp as-of normalizes to its calendar day", () => {
    expect(biweeklyWindow("2026-07-14T10:30:00.000Z")).toEqual(biweeklyWindow("2026-07-14"));
  });

  test("window arithmetic crosses month boundaries correctly", () => {
    expect(biweeklyWindow("2026-03-05")).toEqual({
      start: "2026-02-20",
      end: "2026-03-05",
      endExclusive: "2026-03-06",
    });
  });

  test("an unparseable as-of date throws RangeError (caller error, not data)", () => {
    expect(() => biweeklyWindow("not-a-date")).toThrow(RangeError);
  });
});

describe("FR-13: an event exactly on a window boundary lands in exactly ONE window", () => {
  test("the 2026-07-01 viewing counts in [07-01, 07-15) and NOT in the adjacent [06-17, 07-01)", () => {
    const pid = projectId("Ρετιρέ Κύπρου");
    const w1 = biweeklyWindow("2026-06-30"); // [2026-06-17, 2026-07-01)
    const w2 = biweeklyWindow("2026-07-14"); // [2026-07-01, 2026-07-15)
    expect(w1.endExclusive).toBe(w2.start); // adjacent, no gap, no overlap

    const a1 = activityInWindow(db, pid, w1.start, w1.endExclusive);
    const a2 = activityInWindow(db, pid, w2.start, w2.endExclusive);
    expect(a1.viewings).toBe(0); // boundary viewing NOT double-counted here
    expect(a2.viewings).toBe(4); // …it belongs to the window that starts on its date
    // Consecutive reports never double-count (spec clarification, locked):
    expect(a1.viewings + a2.viewings).toBe(4);
  });
});

// ─── US-5: content — totals, per-unit breakdown, placeholders ───────────────────

describe("US-5: biweekly report content (Greek Markdown, numbers from SQL only)", () => {
  test("activity totals count only in-window events (labels.ts wording)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    // inquiries: 07-03 + 07-14T23:59:59 (the 06-25 one is out of window) = 2
    // viewings: 07-01 (boundary, in) + 07-05 + 07-10 + 07-08 = 4 (07-15 is out)
    // offers: 07-09 + 07-12 = 2
    expect(md).toContain(
      "- Εκδήλωση ενδιαφέροντος: 2\n- Επίσκεψη: 4\n- Προσφορά: 2",
    );
  });

  test("header carries builder, project and micro-area precision (Article V)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("Ρετιρέ Κύπρου");
    expect(md).toContain("Κατασκευαστική Άλφα ΑΕ");
    expect(md).toContain("Κυψέλη · Πλατεία Κύπρου, block Α");
    expect(md).toContain("01.07.2026 – 14.07.2026");
  });

  test("per-unit breakdown lists every unit of the project", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("### Μονάδα Α1");
    expect(md).toContain("### Μονάδα Α2");
    expect(md).toContain("### Μονάδα Β1");
  });

  test("offer figure shown is the LATEST offer by event id, never MAX(amount)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("190.000 €"); // latest (lower) re-offer is the live position
    expect(md).not.toContain("200.000 €"); // the earlier higher offer must not surface
  });

  test("money renders via formatEuro (dot-grouped, € suffix)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("250.000 €"); // Α1 asking
    expect(md).toContain("320.000 €"); // Β1 asking
  });

  test("clearly-marked placeholders for 2–3 insight lines are present (pasted later from /insights — FR-8)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("<!-- INSIGHTS:START");
    expect(md).toContain("<!-- INSIGHTS:END -->");
    const placeholders = md.match(/Επισήμανση \d — προς συμπλήρωση/g) ?? [];
    expect(placeholders.length).toBe(3);
  });
});

// ─── Article VI: no naked bad number ────────────────────────────────────────────

describe("Article VI: every zero/cold metric is paired with an adjacent recommendation", () => {
  test("a unit with 3+ viewings and 0 offers carries the price recommendation", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const a1Block = md.split("### Μονάδα Α1")[1]!.split("###")[0]!;
    expect(a1Block).toContain("Σύσταση:");
    expect(a1Block).toContain("Η τιμή δείχνει υψηλή — 3 επισκέψεις χωρίς προσφορά.");
  });

  test("a unit with zero activity carries the presentation/channel recommendation", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const b1Block = md.split("### Μονάδα Β1")[1]!.split("###")[0]!;
    expect(b1Block).toContain("Σύσταση:");
    expect(b1Block).toContain("Χαμηλή επισκεψιμότητα (0 επισκέψεις)");
  });

  test("every per-unit block carries a recommendation line (healthy units included)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const blocks = md.split("### Μονάδα ").slice(1);
    expect(blocks.length).toBe(3);
    for (const block of blocks) {
      expect(block).toContain("Σύσταση:");
    }
  });

  test("a zero-activity period states it plainly AND recommends a concrete action (spec edge case)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Ήσυχο Έργο"), asOf: AS_OF });
    expect(md).toContain("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    expect(md).toContain("Σύσταση:");
    expect(md).toContain("- Εκδήλωση ενδιαφέροντος: 0\n- Επίσκεψη: 0\n- Προσφορά: 0");
  });
});

// ─── FR-11: Greek surface, no raw stored keys ───────────────────────────────────

describe("FR-11: the report renders Greek only — no raw stored enum key leaks", () => {
  test("no English stored key (event types, stages, temperatures) appears in the output", () => {
    for (const project of ["Ρετιρέ Κύπρου", "Ήσυχο Έργο"]) {
      const md = biweeklyReport(db, { projectId: projectId(project), asOf: AS_OF });
      expect(md).not.toMatch(
        /\b(inquiry|viewing|offer|reservation|contract|fallthrough|Lead|Fallthrough|hot|warm|cold|live|reserved|sold|withdrawn)\b/,
      );
    }
  });
});

// ─── Article III: byte-determinism, injected time, no PII ───────────────────────

describe("Article III: deterministic report — same DB + same args ⇒ byte-identical", () => {
  test("two runs over the same DB are byte-identical", () => {
    const pid = projectId("Ρετιρέ Κύπρου");
    const first = biweeklyReport(db, { projectId: pid, asOf: AS_OF });
    const second = biweeklyReport(db, { projectId: pid, asOf: AS_OF });
    expect(second).toBe(first);
  });

  test("a fresh DB seeded from the same fixture produces byte-identical output", () => {
    const first = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const db2 = initDb(":memory:");
    try {
      seed(db2, fixture());
      const pid2 = Number(
        (db2
          .query<{ id: number }, [string]>("SELECT id FROM projects WHERE project_name = ?")
          .get("Ρετιρέ Κύπρου"))!.id,
      );
      const second = biweeklyReport(db2, { projectId: pid2, asOf: AS_OF });
      expect(second).toBe(first);
    } finally {
      db2.close();
    }
  });

  test("report generation for an unknown project throws (caller error at the boundary)", () => {
    expect(() => biweeklyReport(db, { projectId: 999, asOf: AS_OF })).toThrow(/999/);
  });

  test("src/report/biweekly.ts contains no wall-clock call (as-of is injected)", async () => {
    const src = await Bun.file(
      fileURLToPath(new URL("../src/report/biweekly.ts", import.meta.url)),
    ).text();
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    expect(src).not.toMatch(/toLocaleString|Intl\./);
  });
});

describe("polish 2026-07-14: future-tile transparency (dataThrough)", () => {
  test("when the fixed tile extends past the data cutoff, the header carries 'στοιχεία έως'", () => {
    // Tile ends 2026-08-01 but data only runs to 2026-07-14.
    const md = biweeklyReport(db, {
      projectId: projectId("Ρετιρέ Κύπρου"),
      asOf: "2026-08-01",
      dataThrough: "2026-07-14",
    });
    expect(md).toContain("στοιχεία έως 14.07.2026");
  });

  test("no suffix when dataThrough is absent or not before the window end", () => {
    const plain = biweeklyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(plain).not.toContain("στοιχεία έως");
    const capped = biweeklyReport(db, {
      projectId: projectId("Ρετιρέ Κύπρου"),
      asOf: AS_OF,
      dataThrough: AS_OF,
    });
    expect(capped).not.toContain("στοιχεία έως");
  });
});
