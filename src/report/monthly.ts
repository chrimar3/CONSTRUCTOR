// T016 — deterministic Greek monthly report: extends the biweekly (T014) with
// (a) trend vs the previous fixed 30-day period, (b) price realization per sold
// unit (v_price_realization), (c) the micro-area comparative from own sold units
// + manual comps (T011a merge — every comparable labelled by source, FR-12), (d)
// per-unit recommendation() with the comps-based € target computed HERE in the
// report layer (ADR-0011), and (e) an absorption forecast from offer/viewing
// signals ONLY — the Phase-B reservation-velocity view is never read (ADR-0026).
//
// Article III: every number comes from queries.ts / comps.ts SQL; the as-of date
// is INJECTED (no wall clock — Gate 4 greps for it); money via formatEuro, the
// realization percent via integer arithmetic (no ICU). Same DB + same args ⇒
// byte-identical output.
//
// Article VI: every section that renders a zero/negative figure carries a
// recommendation() line in the SAME Markdown block (ADR-0025 adjacency), and
// every active unit's block always carries one.
//
// Error contract (matches T014): rendering is total over DATA; only CALLER
// errors throw — unparseable as-of (RangeError), unknown project (Error).

import type { Database } from "bun:sqlite";
import { compSourceLabel, eventTypeLabel } from "../domain/labels";
import { formatEuro, recommendation } from "../domain/recommend";
import {
  activityInWindow,
  getProject,
  liveUnitCount,
  priceRealization,
  unitActivityInWindow,
} from "../db/queries";
import { compsForMicroArea, type CompRow } from "../db/comps";

// ─── Window computation (FR-13: fixed 30-day periods, half-open, injected as-of) ─

export interface MonthlyWindow {
  /** First calendar day of the period (inclusive), "YYYY-MM-DD". */
  start: string;
  /** Last calendar day of the period (inclusive), "YYYY-MM-DD". */
  end: string;
  /** Exclusive upper bound (the day AFTER `end`) — SQL compares [start, endExclusive). */
  endExclusive: string;
}

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 30;

/** Renders a UTC epoch-day timestamp back to "YYYY-MM-DD" (argful Date only). */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses a "YYYY-MM-DD"(-prefixed) string to a UTC epoch-day timestamp. */
function parseIsoDay(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(iso);
  if (match === null) {
    throw new RangeError(
      `as-of date must be ISO "YYYY-MM-DD" (optionally with a time part), got "${iso}"`,
    );
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * The monthly period for an injected as-of date: the 30 calendar days ending on
 * the as-of day, half-open [start, endExclusive). Same tiling semantics as the
 * biweekly window (T014/ADR-0024): adjacent periods share exactly one boundary
 * string, so any event lands in exactly one period (FR-13).
 */
export function monthlyWindow(asOf: string): MonthlyWindow {
  const ms = parseIsoDay(asOf);
  return {
    start: isoDay(ms - (PERIOD_DAYS - 1) * DAY_MS),
    end: isoDay(ms),
    endExclusive: isoDay(ms + DAY_MS),
  };
}

/** The fixed 30-day period immediately before `window` — adjacent, no gap/overlap. */
export function previousWindow(window: MonthlyWindow): MonthlyWindow {
  const startMs = parseIsoDay(window.start);
  return {
    start: isoDay(startMs - PERIOD_DAYS * DAY_MS),
    end: isoDay(startMs - DAY_MS),
    endExclusive: window.start,
  };
}

// ─── Comps-based € target (report layer owns this per ADR-0011/ADR-0026) ──────

/**
 * Deterministic comps-based price target for one unit: the MEDIAN €/m² across
 * the micro-area comparables that carry both sqm and sale price, times the
 * unit's own m², rounded to the €500 grid (the counter() convention). Returns
 * null when no defensible figure exists (no usable comps, or the unit has no
 * sqm) — recommendation() then renders the price branch without a figure.
 */
export function compsBasedTarget(comps: CompRow[], unitSqm: number | null): number | null {
  if (unitSqm === null || !(unitSqm > 0)) return null;
  const perSqm = comps
    .filter((c) => c.sqm !== null && c.sqm > 0 && c.salePrice > 0)
    .map((c) => c.salePrice / (c.sqm as number))
    .sort((a, b) => a - b);
  if (perSqm.length === 0) return null;
  const mid = Math.floor(perSqm.length / 2);
  const median =
    perSqm.length % 2 === 1 ? perSqm[mid]! : (perSqm[mid - 1]! + perSqm[mid]!) / 2;
  const target = Math.round((median * unitSqm) / 500) * 500;
  return target > 0 ? target : null;
}

// ─── Rendering helpers (byte-deterministic, Greek surface) ───────────────────

/** "YYYY-MM-DD" → "DD.MM.YYYY" (pure string reshuffle — no ICU, Article III). */
function greekDate(isoDate: string): string {
  const d = isoDate.slice(0, 10);
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

/** Signed delta: +N for growth, plain 0/-N otherwise (ASCII minus — scanner-visible). */
function signedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

// ─── Report builder ──────────────────────────────────────────────────────────

export interface MonthlyReportOptions {
  projectId: number;
  /** Injected reference date (ISO) — never read from the wall clock (Article III). */
  asOf: string;
}

export function monthlyReport(db: Database, options: MonthlyReportOptions): string {
  const window = monthlyWindow(options.asOf);
  const prev = previousWindow(window);
  const project = getProject(db, options.projectId);
  if (project === null) {
    throw new Error(`project ${options.projectId} not found`);
  }

  const totals = activityInWindow(db, project.id, window.start, window.endExclusive);
  const prevTotals = activityInWindow(db, project.id, prev.start, prev.endExclusive);
  const units = unitActivityInWindow(db, project.id, window.start, window.endExclusive);
  const sold = priceRealization(db, project.id);
  const comps = compsForMicroArea(db, project.microArea);
  const liveUnits = liveUnitCount(db, project.id);

  const projectRecommendation = recommendation({
    viewings: totals.viewings,
    offers: totals.offers,
  });

  const lines: string[] = [];

  // ── Header (Article V: micro-area precision always) ──
  lines.push(`# Μηνιαία αναφορά προόδου πωλήσεων — ${project.projectName}`);
  lines.push("");
  lines.push(`**Κατασκευαστής:** ${project.builderName}`);
  lines.push(`**Τοποθεσία:** ${project.microArea}`);
  lines.push(
    `**Περίοδος αναφοράς:** ${greekDate(window.start)} – ${greekDate(window.end)} (${PERIOD_DAYS} ημέρες)`,
  );
  lines.push("");

  // ── Activity totals (FR-11: captions via labels.ts) ──
  lines.push("## Δραστηριότητα περιόδου");
  lines.push("");
  if (totals.inquiries === 0 && totals.viewings === 0 && totals.offers === 0) {
    lines.push("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    lines.push("");
  }
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
  if (totals.inquiries === 0 || totals.viewings === 0 || totals.offers === 0) {
    // Article VI: a zero total never stands alone in its block.
    lines.push("");
    lines.push(`**Σύσταση:** ${projectRecommendation}`);
  }
  lines.push("");

  // ── (a) Trend vs the previous fixed period ──
  lines.push(
    `## Τάση έναντι προηγούμενης περιόδου (${greekDate(prev.start)} – ${greekDate(prev.end)})`,
  );
  lines.push("");
  const trendRows: [string, number, number][] = [
    [eventTypeLabel("inquiry"), totals.inquiries, prevTotals.inquiries],
    [eventTypeLabel("viewing"), totals.viewings, prevTotals.viewings],
    [eventTypeLabel("offer"), totals.offers, prevTotals.offers],
  ];
  let trendHasBadFigure = false;
  for (const [caption, current, previous] of trendRows) {
    const delta = current - previous;
    if (current <= 0 || previous <= 0 || delta <= 0) trendHasBadFigure = true;
    lines.push(
      `- ${caption}: ${current} (προηγούμενη περίοδος: ${previous}, μεταβολή: ${signedDelta(delta)})`,
    );
  }
  if (trendHasBadFigure) {
    // Article VI: zero counts / non-positive deltas pair with the period's
    // data-derived recommendation in the SAME block (ADR-0025 adjacency).
    lines.push("");
    lines.push(`**Σύσταση:** ${projectRecommendation}`);
  }
  lines.push("");

  // ── (d) Per-unit breakdown: active inventory with recommendation() ──
  lines.push("## Ανά μονάδα");
  lines.push("");
  const activeUnits = units.filter((u) => u.status !== "sold" && u.status !== "withdrawn");
  if (units.length === 0) {
    lines.push("Δεν έχουν καταχωρηθεί μονάδες για το έργο.");
    lines.push("");
    lines.push(
      "**Σύσταση:** Καταχωρήστε τις μονάδες του έργου ώστε η δραστηριότητα να αποδίδεται ανά μονάδα.",
    );
    lines.push("");
  } else if (activeUnits.length === 0) {
    lines.push("Όλες οι μονάδες του έργου έχουν πωληθεί ή αποσυρθεί από τη διάθεση.");
    lines.push("");
  }
  for (const unit of activeUnits) {
    lines.push(`### Μονάδα ${unit.unitCode} — ζητούμενη τιμή ${formatEuro(unit.askingCurrent)}`);
    lines.push("");
    lines.push(`- ${eventTypeLabel("viewing")}: ${unit.viewings}`);
    const latest =
      unit.latestOfferAmount === null
        ? ""
        : ` (τελευταία: ${formatEuro(unit.latestOfferAmount)})`;
    lines.push(`- ${eventTypeLabel("offer")}: ${unit.offers}${latest}`);
    // Article VI: EVERY active unit block carries a recommendation; the comps-
    // based € target is computed here in the report layer (ADR-0011).
    lines.push(
      `- **Σύσταση:** ${recommendation({
        viewings: unit.viewings,
        offers: unit.offers,
        compsTarget: compsBasedTarget(comps, unit.sqm),
      })}`,
    );
    lines.push("");
  }

  // ── (b) Price realization per sold unit (v_price_realization) ──
  lines.push("## Υλοποίηση τιμής πώλησης");
  lines.push("");
  if (sold.length === 0) {
    lines.push("Δεν έχουν καταγραφεί πωλήσεις μονάδων του έργου ακόμη.");
    lines.push("");
  } else {
    let realizationHasBadFigure = false;
    for (const s of sold) {
      const percent = Math.round(s.realization * 100);
      if (percent <= 0) realizationHasBadFigure = true;
      lines.push(
        `- Μονάδα ${s.unitCode}: πώληση ${formatEuro(s.salePrice)} έναντι αρχικής ζητούμενης ${formatEuro(s.askingInitial)} — υλοποίηση ${percent}%`,
      );
    }
    if (realizationHasBadFigure) {
      lines.push("");
      lines.push(`**Σύσταση:** ${projectRecommendation}`);
    }
    lines.push("");
  }

  // ── (c) Micro-area comparative: T011a merge, every comparable labelled ──
  lines.push(`## Συγκριτικά πωλήσεων περιοχής — ${project.microArea}`);
  lines.push("");
  if (comps.length === 0) {
    lines.push("Δεν υπάρχουν καταγεγραμμένα συγκριτικά πώλησης για την περιοχή.");
    lines.push("");
    lines.push(
      "**Σύσταση:** Καταχώρηση γνωστών πωλήσεων της περιοχής στο σύστημα, ώστε οι προτάσεις τιμής να τεκμηριώνονται σε πραγματικά συγκριτικά.",
    );
    lines.push("");
  } else {
    for (const comp of comps) {
      const details: string[] = [compSourceLabel(comp.source)];
      if (comp.sqm !== null && comp.sqm > 0) details.push(`${comp.sqm} τ.μ.`);
      if (comp.rooms !== null && comp.rooms > 0) details.push(`${comp.rooms} υ/δ`);
      if (comp.saleDate !== null) details.push(greekDate(comp.saleDate));
      lines.push(`- ${formatEuro(comp.salePrice)} — ${details.join(", ")}`);
    }
    lines.push("");
  }

  // ── (e) Absorption forecast — offer/viewing signals ONLY (Phase B stays dark) ──
  lines.push("## Πρόβλεψη απορρόφησης");
  lines.push("");
  lines.push(`- Διαθέσιμες μονάδες: ${liveUnits}`);
  lines.push(
    `- Επισκέψεις περιόδου: ${totals.viewings} · Προσφορές περιόδου: ${totals.offers}`,
  );
  if (liveUnits === 0) {
    lines.push("- Εκτίμηση: δεν υπάρχουν διαθέσιμες μονάδες προς απορρόφηση.");
  } else if (totals.offers === 0) {
    // No offers ⇒ no invented pace: state it, never fabricate a figure.
    lines.push(
      "- Εκτίμηση: χωρίς προσφορές στην περίοδο, δεν τεκμηριώνεται αριθμητική πρόβλεψη απορρόφησης από τα καταγεγραμμένα σήματα.",
    );
  } else {
    const months = Math.ceil(liveUnits / totals.offers);
    lines.push(
      `- Εκτίμηση: με τον τρέχοντα ρυθμό προσφορών, εκτιμώμενη απορρόφηση των διαθέσιμων μονάδων σε ~${months} ${months === 1 ? "μήνα" : "μήνες"}.`,
    );
  }
  if (liveUnits <= 0 || totals.viewings <= 0 || totals.offers <= 0) {
    // Article VI: any zero signal in this block pairs with the recommendation.
    lines.push("");
    lines.push(`**Σύσταση:** ${projectRecommendation}`);
  }
  lines.push("");

  // ── Insight placeholders (FR-8: filled by the human-run /insights step) ──
  lines.push("## Επισημάνσεις συμβούλου");
  lines.push("");
  lines.push(
    "<!-- INSIGHTS:START — επικολλήστε εδώ 2–3 επισημάνσεις από το βήμα /insights. " +
      "Η αναφορά είναι πλήρης και αποστέλλεται και χωρίς αυτές. -->",
  );
  lines.push("- _[Επισήμανση 1 — προς συμπλήρωση από το βήμα /insights]_");
  lines.push("- _[Επισήμανση 2 — προς συμπλήρωση από το βήμα /insights]_");
  lines.push("- _[Επισήμανση 3 — προς συμπλήρωση, προαιρετική]_");
  lines.push("<!-- INSIGHTS:END -->");
  lines.push("");

  // ── Footer ──
  lines.push(
    `_Η αναφορά παράχθηκε ντετερμινιστικά από τα καταγεγραμμένα στοιχεία της περιόδου (ημερομηνία αναφοράς: ${greekDate(window.end)})._`,
  );
  lines.push("");

  return lines.join("\n");
}
