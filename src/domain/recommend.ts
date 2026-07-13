// T006 — recommendation(signals) → Greek recommendation string for builder reports.
// PINNED thresholds (locked, data-model.md / CLAUDE.md): viewings >= 3 AND offers = 0 → price;
// viewings < 3 (and offers = 0) → presentation/channel; otherwise (offers exist) → hold.
// Input shape + branch precedence per ADR-0011 (adopts archived v1 ADR-0006).
//
// Article VI: TOTAL function — non-empty Greek output for ANY input (NaN, negatives,
// Infinity, missing fields, null object). It never throws: a naked bad number must
// never be able to lack a recommendation.
// Article III: euro formatting is byte-deterministic (manual dot separators, never
// toLocaleString/Intl — no dependence on the host's ICU build).

export interface RecommendationSignals {
  /** Viewings in the report period for this unit. */
  viewings: number;
  /** Offers in the report period for this unit. */
  offers: number;
  /**
   * Optional comps-based € target, computed by the report layer (T016) which owns
   * the comps queries. Absent/invalid → the price branch still emits a complete
   * recommendation without a figure (ADR-0011).
   */
  compsTarget?: number | null;
}

/**
 * Deterministic euro formatting: dot thousands separators, trailing € sign,
 * rounded to whole euros. No Intl/ICU (Article III byte-determinism).
 */
export function formatEuro(amount: number): string {
  const n = Math.round(amount);
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(n).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped} €`;
}

/** Non-finite or negative counts normalize to 0 = "no data" (ADR-0011). */
function normalizeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** compsTarget is used only when it is a finite, positive number. */
function normalizeTarget(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function recommendation(signals: RecommendationSignals): string {
  const viewings = normalizeCount(signals?.viewings);
  const offers = normalizeCount(signals?.offers);
  const target = normalizeTarget(signals?.compsTarget);

  if (offers === 0 && viewings >= 3) {
    const lead = `Η τιμή δείχνει υψηλή — ${viewings} επισκέψεις χωρίς προσφορά.`;
    return target !== null
      ? `${lead} Προτεινόμενη προσαρμογή στα ${formatEuro(target)} βάσει comps της περιοχής.`
      : `${lead} Προτείνεται επανεξέταση της τιμής βάσει comps της περιοχής.`;
  }

  if (offers === 0) {
    const noun = viewings === 1 ? "επίσκεψη" : "επισκέψεις";
    return (
      `Χαμηλή επισκεψιμότητα (${viewings} ${noun}) — προτείνεται ανανέωση της ` +
      `παρουσίασης (staging, φωτογραφίες) ή αλλαγή καναλιού προβολής.`
    );
  }

  // Offers exist → healthy, regardless of viewing count (ADR-0011 precedence).
  return "Υγιής πορεία — διατήρηση τιμής και συνέχιση της τρέχουσας προσέγγισης.";
}
