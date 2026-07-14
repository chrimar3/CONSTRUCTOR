// T015 — Article VI enforcement: "no naked bad number" in the biweekly report.
//
// The rule (constitution Article VI / SC-3): every zero/negative ("bad") figure
// in a client-facing report MUST be paired with an adjacent recommendation()
// output — and a fully-zero period must state it plainly AND recommend a
// concrete action (never blank, never a bare 0).
//
// Enforcement here is STRUCTURAL, not spot-check: a scanner walks every rendered
// line of the report, extracts numeric figure tokens (ignoring dot-grouped euro
// amounts and DD.MM.YYYY dates by grammar, not by allowlist), and asserts that
// every zero/negative token sits inside a Markdown block (heading → next
// heading) that carries a "Σύσταση:" line. Adjacency = same block (ADR-0025).
// The scanner's own teeth are pinned by synthetic-markdown tests below, so a
// future report change cannot pass by breaking the scanner.

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { recommendation } from "../src/domain/recommend";
import { biweeklyReport } from "../src/report/biweekly";

// ─── The scanner (test infrastructure — the executable form of the rule) ──────

interface FigureLine {
  /** The heading of the Markdown block the line belongs to. */
  heading: string;
  /** The full rendered line containing the figure. */
  line: string;
  /** The zero/negative numeric tokens found on the line. */
  badTokens: number[];
}

interface NakedNumberScan {
  /** Bad-figure lines whose block carries a recommendation — the GOOD outcome. */
  paired: FigureLine[];
  /** Bad-figure lines with NO recommendation in their block — Article VI violations. */
  naked: FigureLine[];
}

/**
 * Standalone integer tokens, excluding digits glued to `.` or `,` on either
 * side — that grammar removes dot-grouped euro figures ("250.000 €") and
 * DD.MM.YYYY dates without any content allowlist, so a NEW zero metric added
 * to the template later is scanned automatically.
 */
const FIGURE_TOKEN = /(?<![\d.,])-?\d+(?![\d.,])/g;

function scanForNakedBadNumbers(markdown: string): NakedNumberScan {
  // Group lines into blocks: a block is a heading line plus everything until
  // the next heading (content before the first heading forms its own block).
  const blocks: { heading: string; lines: string[] }[] = [];
  let current = { heading: "(preamble)", lines: [] as string[] };
  blocks.push(current);
  for (const line of markdown.split("\n")) {
    if (/^#{1,6} /.test(line)) {
      current = { heading: line, lines: [line] };
      blocks.push(current);
    } else {
      current.lines.push(line);
    }
  }

  const scan: NakedNumberScan = { paired: [], naked: [] };
  for (const block of blocks) {
    const hasRecommendation = block.lines.some((l) => l.includes("Σύσταση:"));
    for (const line of block.lines) {
      const badTokens = [...line.matchAll(FIGURE_TOKEN)]
        .map((m) => Number(m[0]))
        .filter((n) => n <= 0);
      if (badTokens.length === 0) continue;
      const finding: FigureLine = { heading: block.heading, line, badTokens };
      (hasRecommendation ? scan.paired : scan.naked).push(finding);
    }
  }
  return scan;
}

// ─── Scanner teeth (synthetic markdown — proves the rule detector detects) ────

describe("Article VI scanner: the detector itself has teeth", () => {
  test("a zero figure in a block WITHOUT a recommendation is flagged naked", () => {
    const md = "## Ενότητα\n\n- Προσφορές: 0\n";
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked.length).toBe(1);
    expect(scan.naked[0]!.badTokens).toEqual([0]);
  });

  test("a negative figure without a recommendation is flagged naked", () => {
    const md = "## Τάση\n\n- Μεταβολή επισκέψεων: -3\n";
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked.length).toBe(1);
    expect(scan.naked[0]!.badTokens).toEqual([-3]);
  });

  test("the same zero figure with a Σύσταση line in the same block counts as paired", () => {
    const md = "## Ενότητα\n\n- Προσφορές: 0\n\n**Σύσταση:** Επανεξέταση τιμής.\n";
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]);
    expect(scan.paired.length).toBe(1);
  });

  test("a recommendation in a DIFFERENT block does not excuse a naked zero", () => {
    const md =
      "## Α\n\n- Προσφορές: 0\n\n## Β\n\n**Σύσταση:** Κάτι άσχετο.\n";
    expect(scanForNakedBadNumbers(md).naked.length).toBe(1);
  });

  test("euro amounts, dates and positive counts are not bad figures", () => {
    const md =
      "## Υγιές\n\n**Περίοδος:** 01.07.2026 – 14.07.2026 (14 ημέρες)\n" +
      "- Επίσκεψη: 4\n- τιμή 250.000 €\n";
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]);
    expect(scan.paired).toEqual([]);
  });
});

// ─── Fixture: one project with a cold unit + a zero-activity unit + a healthy
//     control unit; one project with a fully-zero period ──────────────────────

const AS_OF = "2026-07-14"; // window = [2026-07-01, 2026-07-15)

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: "Κατασκευαστική Δέλτα ΑΕ",
        project_name: "Δοκιμαστικό Έργο",
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Δ",
        total_units: 3,
        listed_at: "2026-05-01T00:00:00.000Z",
        units: [
          // Δ1: the COLD unit — heavy traffic, zero offers (price-signal case).
          { unit_code: "Δ1", asking_initial: 250000 },
          // Δ2: the ZERO-ACTIVITY unit — no viewings, no offers at all.
          { unit_code: "Δ2", asking_initial: 180000 },
          // Δ3: healthy control — has an offer; its block must not false-flag.
          { unit_code: "Δ3", asking_initial: 320000 },
        ],
      },
      {
        // Fully-zero period: units exist, but NOTHING happened in the window.
        builder_name: "Δομική Έψιλον ΕΕ",
        project_name: "Παγωμένο Έργο",
        area: "Γκύζη",
        micro_area: "Γκύζη · Πλατεία Γκύζη, block Ε",
        total_units: 2,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [
          { unit_code: "Ε1", asking_initial: 210000 },
          { unit_code: "Ε2", asking_initial: 195000 },
        ],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-07-01T09:00:00.000Z" },
      { pseudonym: "#2", source_channel: "referral", created_at: "2026-07-02T09:00:00.000Z" },
      { pseudonym: "#3", source_channel: "xe", created_at: "2026-07-03T09:00:00.000Z" },
    ],
    opportunities: [
      {
        // Drives the COLD unit Δ1: 4 in-window viewings, zero offers.
        project: "Δοκιμαστικό Έργο",
        buyer: "#1",
        focus_unit: "Δ1",
        stage: "Επίσκεψη",
        temperature: "cold",
        next_action: "Επανεκτίμηση τιμής με τον κατασκευαστή",
        next_owner: "Χρήστος",
        updated_at: "2026-07-12T18:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-07-02T10:00:00.000Z",
            unit: "Δ1",
            interest: 2,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη",
          },
          {
            type: "viewing",
            date: "2026-07-05T11:00:00.000Z",
            unit: "Δ1",
            interest: 2,
            handled_by: "Λωίδα",
            next_action: "Επόμενη επίσκεψη",
          },
          {
            type: "viewing",
            date: "2026-07-09T17:00:00.000Z",
            unit: "Δ1",
            interest: 3,
            handled_by: "Γιολάντα",
            next_action: "Τηλεφωνική επιβεβαίωση ενδιαφέροντος",
          },
          {
            type: "viewing",
            date: "2026-07-12T17:30:00.000Z",
            unit: "Δ1",
            interest: 2,
            handled_by: "Χρήστος",
            next_action: "Συζήτηση τιμής με κατασκευαστή",
          },
        ],
      },
      {
        // Drives the healthy control unit Δ3: viewing + live offer.
        project: "Δοκιμαστικό Έργο",
        buyer: "#2",
        focus_unit: "Δ3",
        stage: "Προσφορά",
        temperature: "hot",
        next_action: "Απάντηση στην προσφορά",
        next_owner: "Λωίδα",
        updated_at: "2026-07-10T12:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-07-06T10:00:00.000Z",
            unit: "Δ3",
            interest: 5,
            handled_by: "Λωίδα",
            next_action: "Αναμονή προσφοράς",
          },
          {
            type: "offer",
            date: "2026-07-10T12:00:00.000Z",
            unit: "Δ3",
            amount: 300000,
            handled_by: "Λωίδα",
            next_action: "Αντιπροσφορά προς αγοραστή",
          },
        ],
      },
      {
        // In-window inquiry only — keeps the totals section non-degenerate
        // (inquiries > 0 while offers land at a project level that still
        // contains zero-figure unit rows).
        project: "Δοκιμαστικό Έργο",
        buyer: "#3",
        stage: "Lead",
        temperature: "warm",
        next_action: "Προγραμματισμός επίσκεψης",
        next_owner: "Γιολάντα",
        updated_at: "2026-07-11T09:00:00.000Z",
        events: [
          {
            type: "inquiry",
            date: "2026-07-11T09:00:00.000Z",
            handled_by: "Γιολάντα",
            next_action: "Προγραμματισμός επίσκεψης",
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

// ─── Article VI: the rule, enforced over the real rendered report ─────────────

describe("Article VI (T015): no zero/negative figure renders without an adjacent recommendation", () => {
  test("zero-activity unit + cold unit fixture: full-report scan finds ZERO naked bad numbers", () => {
    const md = biweeklyReport(db, { projectId: projectId("Δοκιμαστικό Έργο"), asOf: AS_OF });
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]); // the rule itself
    // Anti-vacuous guard: the fixture MUST have produced zero figures to pair —
    // a scan that found nothing to check would prove nothing.
    expect(scan.paired.length).toBeGreaterThan(0);
  });

  test("the cold unit's zero offers are paired with the price recommendation in the SAME block", () => {
    const md = biweeklyReport(db, { projectId: projectId("Δοκιμαστικό Έργο"), asOf: AS_OF });
    const block = md.split("### Μονάδα Δ1")[1]!.split("###")[0]!;
    expect(block).toContain("Προσφορά: 0");
    expect(block).toContain(`Σύσταση:** ${recommendation({ viewings: 4, offers: 0 })}`);
  });

  test("the zero-activity unit's zeros are paired with the presentation recommendation in the SAME block", () => {
    const md = biweeklyReport(db, { projectId: projectId("Δοκιμαστικό Έργο"), asOf: AS_OF });
    const block = md.split("### Μονάδα Δ2")[1]!.split("###")[0]!;
    expect(block).toContain("Επίσκεψη: 0");
    expect(block).toContain("Προσφορά: 0");
    expect(block).toContain(`Σύσταση:** ${recommendation({ viewings: 0, offers: 0 })}`);
  });

  test("a fully-zero period states it plainly AND recommends a concrete action (never blank, never a bare 0)", () => {
    const md = biweeklyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });

    // Stated plainly — an explicit sentence, not an empty section:
    expect(md).toContain("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");

    // Never blank: the zero totals still render as figures…
    expect(md).toContain("- Εκδήλωση ενδιαφέροντος: 0\n- Επίσκεψη: 0\n- Προσφορά: 0");

    // …and never bare: the totals' zeros carry the concrete data-derived action
    // (recommendation() output verbatim — the pairing is with real output, not
    // any decorative "Σύσταση:" text).
    expect(md).toContain(`**Σύσταση:** ${recommendation({ viewings: 0, offers: 0 })}`);

    // And structurally: not a single naked bad number anywhere in the report.
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]);
    expect(scan.paired.length).toBeGreaterThan(0);
  });

  test("healthy control: the offer-bearing unit's block carries no naked figure and states the hold position", () => {
    const md = biweeklyReport(db, { projectId: projectId("Δοκιμαστικό Έργο"), asOf: AS_OF });
    const block = md.split("### Μονάδα Δ3")[1]!.split("###")[0]!;
    expect(block).toContain(`Σύσταση:** ${recommendation({ viewings: 1, offers: 1 })}`);
    expect(scanForNakedBadNumbers(block).naked).toEqual([]);
  });
});
