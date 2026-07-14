// T016 — src/report/monthly.ts: deterministic Greek monthly report extending the
// biweekly with (a) trend vs the previous fixed period, (b) price realization per
// sold unit (v_price_realization), (c) micro-area comparative from own sold units
// + manual comps (T011a merge, each labelled by source — FR-12/FR-11), (d) per-unit
// recommendation() with the comps-based € target computed HERE in the report layer
// (ADR-0011), and (e) an absorption forecast from offer/viewing signals ONLY
// (reservation velocity is Phase B — the report must not read that view).
// All numbers from SQL over a fixture DB with known numbers; as-of injected;
// byte-deterministic (Article III); no naked bad number (Article VI).

import { beforeEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { addComp } from "../src/db/comps";
import { activityInWindow, liveUnitCount, priceRealization } from "../src/db/queries";
import { compSourceLabel } from "../src/domain/labels";
import { recommendation } from "../src/domain/recommend";
import {
  compsBasedTarget,
  monthlyReport,
  monthlyWindow,
  previousWindow,
} from "../src/report/monthly";

// ─── Fixture (known numbers) ──────────────────────────────────────────────────
//
// AS_OF 2026-07-14 → current window [2026-06-15, 2026-07-15),
//                    previous window [2026-05-16, 2026-06-15).
//
// Project "Ρετιρέ Κύπρου" (micro-area "Κυψέλη · Πλατεία Κύπρου, block Α"):
//   Α1 live, 80m², asking 250.000 — current: 3 viewings / 0 offers → price rec.
//   Α2 live, 60m², asking 180.000 — current: 1 viewing / 1 offer (170.000) → hold.
//   Α3 SOLD at 184.000 vs initial 200.000 (80m²) → realization 92%, and an
//      auto own_transaction comp (2.300 €/m²).
//   Manual comp: 100m², 3 rooms, sold 200.000 on 2026-06-15 (2.000 €/m²).
//   → comps €/m² = [2.000, 2.300], median 2.150 → Α1 target 2.150×80 = 172.000.
//   Current totals: 1 inquiry, 4 viewings, 1 offer.
//   Previous totals: 0 inquiries, 2 viewings, 1 offer (deltas +1 / +2 / 0).
//   Live units 2, current offers 1 → absorption ≈ ceil(2/1) = 2 months.
//
// Project "Παγωμένο Έργο": 1 live unit, zero events ever, no comps, no sales.

const AS_OF = "2026-07-14";

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: "Κατασκευαστική Άλφα ΑΕ",
        project_name: "Ρετιρέ Κύπρου",
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου, block Α",
        total_units: 3,
        listed_at: "2026-03-01T00:00:00.000Z",
        units: [
          { unit_code: "Α1", asking_initial: 250000, sqm: 80 },
          { unit_code: "Α2", asking_initial: 180000, sqm: 60 },
          { unit_code: "Α3", asking_initial: 200000, sqm: 80, rooms: 2 },
        ],
      },
      {
        builder_name: "Δομική Βήτα ΕΕ",
        project_name: "Παγωμένο Έργο",
        area: "Γκύζη",
        micro_area: "Γκύζη · Πλατεία Γκύζη, block Ε",
        total_units: 1,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [{ unit_code: "Ε1", asking_initial: 210000, sqm: 70 }],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-05-20T09:00:00.000Z" },
      { pseudonym: "#2", source_channel: "referral", created_at: "2026-06-05T09:00:00.000Z" },
      { pseudonym: "#3", source_channel: "xe", created_at: "2026-06-16T09:00:00.000Z" },
    ],
    opportunities: [
      {
        // Drives the COLD unit Α1: 1 previous-window viewing + 3 current-window
        // viewings (one exactly ON the 2026-06-15 boundary), zero offers.
        project: "Ρετιρέ Κύπρου",
        buyer: "#1",
        focus_unit: "Α1",
        stage: "Επίσκεψη",
        temperature: "cold",
        next_action: "Επανεκτίμηση τιμής με τον κατασκευαστή",
        next_owner: "Χρήστος",
        updated_at: "2026-07-05T18:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-06-01T10:00:00.000Z", // previous window
            unit: "Α1",
            interest: 2,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη",
          },
          {
            type: "viewing",
            date: "2026-06-15", // EXACTLY on the boundary → current window only
            unit: "Α1",
            interest: 2,
            handled_by: "Χρήστος",
            next_action: "Τρίτη επίσκεψη",
          },
          {
            type: "viewing",
            date: "2026-06-25T10:00:00.000Z",
            unit: "Α1",
            interest: 3,
            handled_by: "Λωίδα",
            next_action: "Τηλεφωνική επιβεβαίωση ενδιαφέροντος",
          },
          {
            type: "viewing",
            date: "2026-07-05T10:00:00.000Z",
            unit: "Α1",
            interest: 2,
            handled_by: "Χρήστος",
            next_action: "Συζήτηση τιμής με τον κατασκευαστή",
          },
        ],
      },
      {
        // Drives the healthy unit Α2: previous-window viewing+offer, current-window
        // viewing + LOWER live offer (the current latest is 170.000, prev 165.000
        // must not surface in the monthly window).
        project: "Ρετιρέ Κύπρου",
        buyer: "#2",
        focus_unit: "Α2",
        stage: "Προσφορά",
        temperature: "hot",
        next_action: "Απάντηση στην προσφορά",
        next_owner: "Λωίδα",
        updated_at: "2026-07-08T12:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-06-10T10:00:00.000Z", // previous window
            unit: "Α2",
            interest: 4,
            handled_by: "Λωίδα",
            next_action: "Αναμονή προσφοράς",
          },
          {
            type: "offer",
            date: "2026-06-14T10:00:00.000Z", // previous window
            unit: "Α2",
            amount: 165000,
            handled_by: "Λωίδα",
            next_action: "Αντιπροσφορά προς αγοραστή",
          },
          {
            type: "viewing",
            date: "2026-07-01T10:00:00.000Z",
            unit: "Α2",
            interest: 5,
            handled_by: "Λωίδα",
            next_action: "Αναμονή νέας προσφοράς",
          },
          {
            type: "offer",
            date: "2026-07-08T10:00:00.000Z",
            unit: "Α2",
            amount: 170000,
            handled_by: "Γιολάντα",
            next_action: "Συνάντηση με κατασκευαστή για την προσφορά",
          },
        ],
      },
      {
        // Current-window inquiry only (previous inquiries stay 0 → delta +1).
        project: "Ρετιρέ Κύπρου",
        buyer: "#3",
        stage: "Lead",
        temperature: "warm",
        next_action: "Προγραμματισμός επίσκεψης",
        next_owner: "Γιολάντα",
        updated_at: "2026-06-16T09:00:00.000Z",
        events: [
          {
            type: "inquiry",
            date: "2026-06-16T09:00:00.000Z",
            handled_by: "Γιολάντα",
            next_action: "Προγραμματισμός επίσκεψης",
          },
        ],
      },
    ],
  };
}

/** Builds the full fixture DB: seed + Α3 sale (no Phase-A capture path sets
 *  sale_price, so the test sets the migrated fact directly) + one manual comp. */
function buildFixtureDb(): Database {
  const db = initDb(":memory:");
  seed(db, fixture());
  db.run(
    `UPDATE units SET sale_price = 184000, status = 'sold'
     WHERE unit_code = 'Α3'
       AND project_id = (SELECT id FROM projects WHERE project_name = 'Ρετιρέ Κύπρου')`,
  );
  addComp(db, {
    area: "Κυψέλη",
    microArea: "Κυψέλη · Πλατεία Κύπρου, block Α",
    salePrice: 200000,
    sqm: 100,
    rooms: 3,
    saleDate: "2026-06-15",
    source: "manual_known_sale",
    enteredBy: "Χρήστος",
    note: "γνωστή πώληση στο διπλανό οικοδομικό τετράγωνο",
  });
  return db;
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
  db = buildFixtureDb();
});

// ─── Article VI scanner (same grammar + block adjacency as T015 / ADR-0025) ───

const FIGURE_TOKEN = /(?<![\d.,])-?\d+(?![\d.,])/g;

function scanForNakedBadNumbers(markdown: string): { paired: number; naked: string[] } {
  const blocks: { hasRec: boolean; lines: string[] }[] = [];
  let current = { hasRec: false, lines: [] as string[] };
  blocks.push(current);
  for (const line of markdown.split("\n")) {
    if (/^#{1,6} /.test(line)) {
      current = { hasRec: false, lines: [line] };
      blocks.push(current);
    } else {
      current.lines.push(line);
    }
    if (line.includes("Σύσταση:")) current.hasRec = true;
  }
  let paired = 0;
  const naked: string[] = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      const bad = [...line.matchAll(FIGURE_TOKEN)].map((m) => Number(m[0])).filter((n) => n <= 0);
      if (bad.length === 0) continue;
      if (block.hasRec) paired++;
      else naked.push(line);
    }
  }
  return { paired, naked };
}

// ─── FR-13: monthly window + previous fixed period ────────────────────────────

describe("FR-13: monthlyWindow — 30 calendar days ending on the as-of day, half-open", () => {
  test("window for an as-of DATE covers the 30 calendar days ending on it", () => {
    expect(monthlyWindow("2026-07-14")).toEqual({
      start: "2026-06-15",
      end: "2026-07-14",
      endExclusive: "2026-07-15",
    });
  });

  test("a full ISO timestamp as-of normalizes to its calendar day", () => {
    expect(monthlyWindow("2026-07-14T10:30:00.000Z")).toEqual(monthlyWindow("2026-07-14"));
  });

  test("window arithmetic crosses month/year boundaries correctly", () => {
    expect(monthlyWindow("2026-01-10")).toEqual({
      start: "2025-12-12",
      end: "2026-01-10",
      endExclusive: "2026-01-11",
    });
  });

  test("an unparseable as-of date throws RangeError (caller error, not data)", () => {
    expect(() => monthlyWindow("not-a-date")).toThrow(RangeError);
  });

  test("previousWindow is the 30 days immediately before — adjacent, no gap, no overlap", () => {
    const cur = monthlyWindow(AS_OF);
    const prev = previousWindow(cur);
    expect(prev).toEqual({
      start: "2026-05-16",
      end: "2026-06-14",
      endExclusive: "2026-06-15",
    });
    expect(prev.endExclusive).toBe(cur.start);
  });

  test("an event exactly on the period boundary lands in exactly ONE period", () => {
    const pid = projectId("Ρετιρέ Κύπρου");
    const cur = monthlyWindow(AS_OF);
    const prev = previousWindow(cur);
    const a1 = activityInWindow(db, pid, prev.start, prev.endExclusive);
    const a2 = activityInWindow(db, pid, cur.start, cur.endExclusive);
    expect(a1.viewings).toBe(2); // the 2026-06-15 boundary viewing is NOT here
    expect(a2.viewings).toBe(4); // …it belongs to the window that starts on its date
    expect(a1.viewings + a2.viewings).toBe(6); // never double-counted
  });
});

// ─── (a) Trend vs previous fixed period ───────────────────────────────────────

describe("T016(a): trend vs previous fixed period (known deltas from SQL)", () => {
  test("header shows the 30-day period and the trend section names the previous one", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("**Περίοδος αναφοράς:** 15.06.2026 – 14.07.2026 (30 ημέρες)");
    expect(md).toContain("(16.05.2026 – 14.06.2026)");
  });

  test("trend lines carry current, previous and signed delta with the exact known numbers", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("- Εκδήλωση ενδιαφέροντος: 1 (προηγούμενη περίοδος: 0, μεταβολή: +1)");
    expect(md).toContain("- Επίσκεψη: 4 (προηγούμενη περίοδος: 2, μεταβολή: +2)");
    expect(md).toContain("- Προσφορά: 1 (προηγούμενη περίοδος: 1, μεταβολή: 0)");
  });

  test("activity totals count only current-window events", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("- Εκδήλωση ενδιαφέροντος: 1\n- Επίσκεψη: 4\n- Προσφορά: 1");
  });
});

// ─── (b) Price realization per unit (v_price_realization) ─────────────────────

describe("T016(b): price realization per sold unit", () => {
  test("priceRealization query returns the sold unit with the view's ratio", () => {
    const rows = priceRealization(db, projectId("Ρετιρέ Κύπρου"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.unitCode).toBe("Α3");
    expect(rows[0]!.askingInitial).toBe(200000);
    expect(rows[0]!.salePrice).toBe(184000);
    expect(rows[0]!.realization).toBeCloseTo(0.92);
  });

  test("the report states sale vs initial asking and the realization percentage", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain(
      "- Μονάδα Α3: πώληση 184.000 € έναντι αρχικής ζητούμενης 200.000 € — υλοποίηση 92%",
    );
  });

  test("a project with no sales states it plainly (no figures, no fake percentages)", () => {
    const md = monthlyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });
    expect(md).toContain("Δεν έχουν καταγραφεί πωλήσεις μονάδων του έργου ακόμη.");
    expect(md).not.toContain("%");
  });
});

// ─── (c) Micro-area comparative (T011a merge, sources labelled) ───────────────

describe("T016(c): micro-area comparative merges own sold units + manual comps, each labelled by source", () => {
  test("the own sold unit auto-counts (Article VII) and is labelled as our own sale", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain(`- 184.000 € — ${compSourceLabel("own_transaction")}, 80 τ.μ., 2 υ/δ`);
  });

  test("the manual comp is labelled as a known area sale and shows its sale date", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain(
      `- 200.000 € — ${compSourceLabel("manual_known_sale")}, 100 τ.μ., 3 υ/δ, 15.06.2026`,
    );
  });

  test("FR-11: comp source keys have Greek labels via labels.ts; unknown key throws", () => {
    expect(/\p{Script=Greek}/u.test(compSourceLabel("own_transaction"))).toBe(true);
    expect(/\p{Script=Greek}/u.test(compSourceLabel("manual_known_sale"))).toBe(true);
    expect(() => compSourceLabel("portal_scrape")).toThrow(RangeError);
  });

  test("a micro-area with no comparables states it plainly with a concrete action", () => {
    const md = monthlyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });
    expect(md).toContain("Δεν υπάρχουν καταγεγραμμένα συγκριτικά πώλησης για την περιοχή.");
    const section = md.split("## Συγκριτικά πωλήσεων περιοχής")[1]!.split("\n## ")[0]!;
    expect(section).toContain("Σύσταση:");
  });
});

// ─── (d) Per-unit recommendation with report-layer comps target ───────────────

describe("T016(d): per-unit recommendation() with the comps-based € target computed in the report layer", () => {
  test("compsBasedTarget: median €/m² × unit m², rounded to €500", () => {
    const comps = [
      { area: "α", microArea: "μ", sqm: 80, rooms: 2, salePrice: 184000, saleDate: null, source: "own_transaction" as const },
      { area: "α", microArea: "μ", sqm: 100, rooms: 3, salePrice: 200000, saleDate: "2026-06-15", source: "manual_known_sale" as const },
    ];
    // €/m² = [2300, 2000] → median 2150 → ×80 = 172.000 (already on the €500 grid)
    expect(compsBasedTarget(comps, 80)).toBe(172000);
    // odd count → middle value: [2000, 2300, 3000] → 2300 → ×60 = 138.000
    const three = [...comps, { area: "α", microArea: "μ", sqm: 50, rooms: 1, salePrice: 150000, saleDate: null, source: "manual_known_sale" as const }];
    expect(compsBasedTarget(three, 60)).toBe(138000);
  });

  test("compsBasedTarget rounds to the €500 grid (counter() convention)", () => {
    const comps = [
      { area: "α", microArea: "μ", sqm: 100, rooms: null, salePrice: 210300, saleDate: null, source: "manual_known_sale" as const },
    ];
    // 2.103 €/m² × 77m² = 161.931 → 162.000
    expect(compsBasedTarget(comps, 77)).toBe(162000);
  });

  test("compsBasedTarget is null without usable data (no comps / no sqm on comps / no unit sqm)", () => {
    const noSqm = [
      { area: "α", microArea: "μ", sqm: null, rooms: null, salePrice: 200000, saleDate: null, source: "manual_known_sale" as const },
    ];
    expect(compsBasedTarget([], 80)).toBeNull();
    expect(compsBasedTarget(noSqm, 80)).toBeNull();
    expect(compsBasedTarget(noSqm, null)).toBeNull();
    expect(compsBasedTarget([{ ...noSqm[0]!, sqm: 100 }], 0)).toBeNull();
  });

  test("the cold unit's block carries the price recommendation WITH the comps-derived € figure", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const block = md.split("### Μονάδα Α1")[1]!.split("###")[0]!;
    expect(block).toContain("- Επίσκεψη: 3");
    expect(block).toContain("- Προσφορά: 0");
    // Verbatim recommendation() output — real data-derived pairing, not decoration:
    expect(block).toContain(
      `**Σύσταση:** ${recommendation({ viewings: 3, offers: 0, compsTarget: 172000 })}`,
    );
    expect(block).toContain("172.000 €");
  });

  test("the offer-bearing unit holds and shows the LATEST in-window offer (never the older one)", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const block = md.split("### Μονάδα Α2")[1]!.split("###")[0]!;
    expect(block).toContain("- Προσφορά: 1 (τελευταία: 170.000 €)");
    expect(block).toContain(
      `**Σύσταση:** ${recommendation({ viewings: 1, offers: 1, compsTarget: compsBasedTarget([], 60) ?? undefined })}`,
    );
    expect(md).not.toContain("165.000 €"); // previous-window offer never surfaces
  });

  test("sold units are not sales work items: no per-unit block, story told in realization section", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).not.toContain("### Μονάδα Α3");
    expect(md).toContain("- Μονάδα Α3: πώληση");
  });

  test("a zero-activity live unit carries the presentation recommendation", () => {
    const md = monthlyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });
    const block = md.split("### Μονάδα Ε1")[1]!.split("###")[0]!;
    expect(block).toContain("- Επίσκεψη: 0");
    expect(block).toContain(`**Σύσταση:** ${recommendation({ viewings: 0, offers: 0 })}`);
  });
});

// ─── (e) Absorption forecast from offer/viewing signals ONLY ──────────────────

describe("T016(e): absorption forecast uses offer/viewing signals only (Phase B velocity stays dark)", () => {
  test("live-unit count and period signals come from SQL", () => {
    expect(liveUnitCount(db, projectId("Ρετιρέ Κύπρου"))).toBe(2); // Α3 sold
    expect(liveUnitCount(db, projectId("Παγωμένο Έργο"))).toBe(1);
  });

  test("forecast: remaining units at the current offer pace, with the known numbers", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const section = md.split("## Πρόβλεψη απορρόφησης")[1]!.split("\n## ")[0]!;
    expect(section).toContain("- Διαθέσιμες μονάδες: 2");
    expect(section).toContain("- Επισκέψεις περιόδου: 4 · Προσφορές περιόδου: 1");
    expect(section).toContain("~2 μήνες"); // ceil(2 live / 1 offer per 30 days)
  });

  test("zero offers → no numeric forecast is fabricated; stated plainly + recommendation", () => {
    const md = monthlyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });
    const section = md.split("## Πρόβλεψη απορρόφησης")[1]!.split("\n## ")[0]!;
    expect(section).toContain("Προσφορές περιόδου: 0");
    expect(section).toContain("δεν τεκμηριώνεται αριθμητική πρόβλεψη απορρόφησης");
    expect(section).not.toContain("μήνες"); // no invented months figure
    expect(section).toContain(`**Σύσταση:** ${recommendation({ viewings: 0, offers: 0 })}`);
  });

  test("Phase B stays dark: monthly.ts never references the reservation-velocity view or marketing assets", async () => {
    const src = await Bun.file(
      fileURLToPath(new URL("../src/report/monthly.ts", import.meta.url)),
    ).text();
    expect(src).not.toContain("v_velocity");
    expect(src).not.toContain("marketing_assets");
  });
});

// ─── Article VI: no naked bad number anywhere in the monthly report ───────────

describe("Article VI: the monthly report never renders a naked zero/negative figure", () => {
  test("active project: full-report scan finds zero naked bad numbers (and had bad figures to pair)", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]);
    expect(scan.paired).toBeGreaterThan(0); // anti-vacuous guard (ADR-0025)
  });

  test("fully-frozen project: zeros everywhere, all paired, stated plainly", () => {
    const md = monthlyReport(db, { projectId: projectId("Παγωμένο Έργο"), asOf: AS_OF });
    expect(md).toContain("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    const scan = scanForNakedBadNumbers(md);
    expect(scan.naked).toEqual([]);
    expect(scan.paired).toBeGreaterThan(0);
  });

  test("the trend section pairs its zero/zero-delta figures with a recommendation in the SAME block", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const section = md.split("## Τάση έναντι προηγούμενης περιόδου")[1]!.split("\n## ")[0]!;
    expect(section).toContain("μεταβολή: 0");
    expect(section).toContain(
      `**Σύσταση:** ${recommendation({ viewings: 4, offers: 1 })}`,
    );
  });
});

// ─── FR-11 / Article V: Greek surface, micro-area precision ───────────────────

describe("FR-11 + Article V: Greek-only surface at micro-area precision", () => {
  test("no raw stored enum key (incl. comp sources and unit statuses) leaks into the output", () => {
    for (const project of ["Ρετιρέ Κύπρου", "Παγωμένο Έργο"]) {
      const md = monthlyReport(db, { projectId: projectId(project), asOf: AS_OF });
      expect(md).not.toMatch(
        /\b(inquiry|viewing|offer|reservation|contract|fallthrough|Lead|Fallthrough|hot|warm|cold|live|reserved|sold|withdrawn|own_transaction|manual_known_sale)\b/,
      );
    }
  });

  test("header and comparative section carry the micro-area, never a coarse location", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).toContain("Κυψέλη · Πλατεία Κύπρου, block Α");
  });
});

// ─── Article III: byte-determinism, injected time, caller errors ──────────────

describe("Article III: deterministic monthly report", () => {
  test("two runs over the same DB are byte-identical", () => {
    const pid = projectId("Ρετιρέ Κύπρου");
    const first = monthlyReport(db, { projectId: pid, asOf: AS_OF });
    const second = monthlyReport(db, { projectId: pid, asOf: AS_OF });
    expect(second).toBe(first);
  });

  test("a fresh DB built from the same fixture produces byte-identical output", () => {
    const first = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    const db2 = buildFixtureDb();
    try {
      const pid2 = Number(
        (db2
          .query<{ id: number }, [string]>("SELECT id FROM projects WHERE project_name = ?")
          .get("Ρετιρέ Κύπρου"))!.id,
      );
      expect(monthlyReport(db2, { projectId: pid2, asOf: AS_OF })).toBe(first);
    } finally {
      db2.close();
    }
  });

  test("unknown project throws (caller error at the boundary, before rendering)", () => {
    expect(() => monthlyReport(db, { projectId: 999, asOf: AS_OF })).toThrow(/999/);
  });

  test("src/report/monthly.ts contains no wall-clock call and no ICU formatting", async () => {
    const src = await Bun.file(
      fileURLToPath(new URL("../src/report/monthly.ts", import.meta.url)),
    ).text();
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    expect(src).not.toMatch(/toLocaleString|Intl\./);
  });
});

describe("polish 2026-07-14: trend decline note + dataThrough", () => {
  test("a declining metric gets a targeted 'Σύσταση (τάση)' note naming it, alongside the verbatim project recommendation", () => {
    // asOf far past the data: current window has 0 events, previous has many →
    // all three metrics decline.
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: "2026-08-20" });
    expect(md).toContain("**Σύσταση (τάση):** Μείωση σε");
    expect(md).toContain("Εκδήλωση ενδιαφέροντος");
    // The verbatim Article VI pairing line is still present in the trend block.
    expect(md).toContain("**Σύσταση:**");
  });

  test("no decline note when all deltas are non-negative", () => {
    const md = monthlyReport(db, { projectId: projectId("Ρετιρέ Κύπρου"), asOf: AS_OF });
    expect(md).not.toContain("Σύσταση (τάση)");
  });

  test("header carries 'στοιχεία έως' when the tile end is past the data cutoff", () => {
    const md = monthlyReport(db, {
      projectId: projectId("Ρετιρέ Κύπρου"),
      asOf: "2026-08-01",
      dataThrough: "2026-07-14",
    });
    expect(md).toContain("στοιχεία έως 14.07.2026");
  });
});
