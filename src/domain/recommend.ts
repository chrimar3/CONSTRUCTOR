/**
 * Deterministic per-unit recommendation for reports (Articles III & VI).
 * Thresholds are PINNED (spec clarification): viewings ≥ 3 with 0 offers →
 * price signal; viewings < 3 → presentation/channel; otherwise hold.
 * Total function: returns a non-empty Greek string for ANY input — a report
 * may never show a bad number without a recommendation (Article VI).
 */

export const PRICE_SIGNAL_MIN_VIEWINGS = 3;

export interface UnitSignals {
  viewings: number;
  offers: number;
  /** Comps-derived price target in € (computed by the report layer from `comps`). */
  compsTarget?: number;
}

/** €-format with dot thousands separators (el-GR style), no locale/ICU dependence. */
function euro(n: number): string {
  return "€" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function recommendation({ viewings, offers, compsTarget }: UnitSignals): string {
  const v = Number.isFinite(viewings) ? viewings : 0;
  const o = Number.isFinite(offers) ? offers : 0;

  if (v >= PRICE_SIGNAL_MIN_VIEWINGS && o === 0) {
    return compsTarget !== undefined && Number.isFinite(compsTarget) && compsTarget > 0
      ? `Η τιμή δείχνει ψηλή για τη ζήτηση — προτεινόμενη προσαρμογή σε ${euro(compsTarget)} (βάσει comps).`
      : `Η τιμή δείχνει ψηλή για τη ζήτηση — προτείνεται επανεξέταση τιμής βάσει comps.`;
  }
  if (v < PRICE_SIGNAL_MIN_VIEWINGS && o === 0) {
    return `Χαμηλή προβολή — προτείνεται ανανέωση παρουσίασης (staging) ή αλλαγή καναλιού προβολής.`;
  }
  return `Διατήρηση τιμής και στρατηγικής — η μονάδα παρουσιάζει υγιή δραστηριότητα.`;
}
