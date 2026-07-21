// T014 — deterministic Greek Markdown report for the last 14 days of a project
// (US-5 / FR-8 / FR-11 / FR-13, Articles III & VI).
//
// Article III: every number comes from queries.ts SQL; NO LLM call anywhere; the
// as-of date is INJECTED (no wall clock in this file — verify-gates Gate 4 greps
// for it); money renders via formatEuro (no ICU). Same DB + same args ⇒
// byte-identical output.
//
// Article VI: every per-unit block carries a recommendation() line, so a zero or
// cold figure can never appear naked; a zero-activity period is stated plainly
// with a concrete recommendation. The 2–3 insight sentences are NOT generated
// here — the report emits clearly-marked placeholders the operator fills via the
// interactive /insights step (FR-8); the report is complete and sendable without
// them.
//
// Error contract: rendering is total over DATA (recommendation never throws);
// only CALLER errors throw — unparseable as-of (RangeError) and unknown project
// (Error), both surfaced before any rendering starts.

import type { Database } from "bun:sqlite";
import { eventTypeLabel } from "../domain/labels";
import { formatEuro, recommendation } from "../domain/recommend";
import {
  activityInWindow,
  getProject,
  unitActivityInWindow,
} from "../db/queries";

// ─── Window computation (FR-13: half-open, injected as-of) ───────────────────

export interface BiweeklyWindow {
  /** First calendar day of the window (inclusive), "YYYY-MM-DD". */
  start: string;
  /** Last calendar day of the window (inclusive) = the as-of day, "YYYY-MM-DD". */
  end: string;
  /** Exclusive upper bound (the day AFTER `end`) — SQL compares [start, endExclusive). */
  endExclusive: string;
}

const DAY_MS = 86_400_000;

/** Renders a UTC epoch-day timestamp back to "YYYY-MM-DD" (argful Date only). */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The last-14-days window for an injected as-of date: the 14 calendar days ending
 * on the as-of day, as a half-open interval [start, endExclusive). Two adjacent
 * windows (as-of D and as-of D+14) share exactly one boundary string, so any
 * event lands in exactly one of them (FR-13 — consecutive reports never
 * double-count). Bounds are plain "YYYY-MM-DD" strings: lexicographic comparison
 * puts both date-only and full-ISO event_date values on the correct side.
 */
export function biweeklyWindow(asOf: string): BiweeklyWindow {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(asOf);
  if (match === null) {
    throw new RangeError(
      `as-of date must be ISO "YYYY-MM-DD" (optionally with a time part), got "${asOf}"`,
    );
  }
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return {
    start: isoDay(ms - 13 * DAY_MS),
    end: isoDay(ms),
    endExclusive: isoDay(ms + DAY_MS),
  };
}

// ─── Rendering helpers (byte-deterministic, Greek surface) ───────────────────

/** "YYYY-MM-DD" → "DD.MM.YYYY" (pure string reshuffle — no ICU, Article III). */
function greekDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
}

// ─── Report builder ──────────────────────────────────────────────────────────

export interface BiweeklyReportOptions {
  projectId: number;
  /** Injected reference date (ISO) — never read from the wall clock (Article III). */
  asOf: string;
  /** Data cutoff (real as-of) when the fixed tile extends past it — display-only suffix. */
  dataThrough?: string;
}

/** "· στοιχεία έως D" suffix when the tile's end is past the data cutoff (display only). */
export function dataThroughSuffix(windowEnd: string, dataThrough?: string): string {
  return dataThrough !== undefined && dataThrough < windowEnd
    ? ` · στοιχεία έως ${greekDate(dataThrough)}`
    : "";
}

export function biweeklyReport(db: Database, options: BiweeklyReportOptions): string {
  const window = biweeklyWindow(options.asOf);
  const project = getProject(db, options.projectId);
  if (project === null) {
    throw new Error(`project ${options.projectId} not found`);
  }

  const totals = activityInWindow(db, project.id, window.start, window.endExclusive);
  const units = unitActivityInWindow(db, project.id, window.start, window.endExclusive);

  const lines: string[] = [];

  // ── Header (Article V: micro-area precision always) ──
  lines.push(`# Αναφορά προόδου πωλήσεων — ${project.projectName}`);
  lines.push("");
  lines.push(`**Κατασκευαστής:** ${project.builderName}`);
  lines.push(`**Τοποθεσία:** ${project.microArea}`);
  lines.push(
    `**Περίοδος αναφοράς:** ${greekDate(window.start)} – ${greekDate(window.end)} (14 ημέρες)${dataThroughSuffix(window.end, options.dataThrough)}`,
  );
  lines.push("");

  // ── Activity totals (FR-11: captions via labels.ts) ──
  lines.push("## Δραστηριότητα περιόδου");
  lines.push("");
  if (totals.inquiries === 0 && totals.viewings === 0 && totals.offers === 0) {
    lines.push("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    lines.push("");
  }
  // ```funnel wrapper: html.ts renders these exact "- label: N" lines as
  // proportional bars. The lines stay byte-identical, so every report/cli/
  // naked-numbers assertion that matches them still holds.
  lines.push("```funnel");
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
  lines.push("```");
  if (totals.inquiries === 0 || totals.viewings === 0 || totals.offers === 0) {
    // Article VI: a zero total never stands alone — pair it with the
    // deterministic, data-derived recommendation for the period's signals.
    lines.push("");
    lines.push(
      `**Σύσταση:** ${recommendation({ viewings: totals.viewings, offers: totals.offers })}`,
    );
  }
  lines.push("");

  // ── Per-unit breakdown (every unit; silent units are the cold metrics) ──
  lines.push("## Ανά μονάδα");
  lines.push("");
  if (units.length === 0) {
    lines.push("Δεν έχουν καταχωρηθεί μονάδες για το έργο.");
    lines.push("");
    lines.push(
      "**Σύσταση:** Καταχωρήστε τις μονάδες του έργου ώστε η δραστηριότητα να αποδίδεται ανά μονάδα.",
    );
    lines.push("");
  }
  for (const unit of units) {
    lines.push(`### Μονάδα ${unit.unitCode} — ζητούμενη τιμή ${formatEuro(unit.askingCurrent)}`);
    lines.push("");
    lines.push(`- ${eventTypeLabel("viewing")}: ${unit.viewings}`);
    const latest =
      unit.latestOfferAmount === null
        ? ""
        : ` (τελευταία: ${formatEuro(unit.latestOfferAmount)})`;
    lines.push(`- ${eventTypeLabel("offer")}: ${unit.offers}${latest}`);
    // Article VI: EVERY unit block carries a recommendation — a zero row can
    // never render naked, and healthy rows state "hold" explicitly.
    lines.push(
      `- **Σύσταση:** ${recommendation({ viewings: unit.viewings, offers: unit.offers })}`,
    );
    lines.push("");
  }

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
