// T005 — pure derived logic per data-model.md "Derived logic" + ADR-0003 (locked 0.6 weight).
// Deterministic money math (Article III): never randomized, never estimated.

export interface CounterSuggestion {
  /** Fraction the offer sits below asking: (asking - offer) / asking. */
  pctBelow: number;
  /** Counter price weighted 0.6 toward asking, rounded to the nearest €500. */
  suggested: number;
}

/**
 * counter(asking, offer):
 * - null when offer >= asking (no counter needed);
 * - otherwise { pctBelow, suggested } with
 *   suggested = round((offer + (asking - offer) * 0.6) / 500) * 500.
 * Throws RangeError on non-positive (or non-finite) inputs.
 */
export function counter(asking: number, offer: number): CounterSuggestion | null {
  if (!Number.isFinite(asking) || asking <= 0) {
    throw new RangeError(`asking must be a positive number, got ${asking}`);
  }
  if (!Number.isFinite(offer) || offer <= 0) {
    throw new RangeError(`offer must be a positive number, got ${offer}`);
  }
  if (offer >= asking) return null;

  const gap = asking - offer;
  return {
    pctBelow: gap / asking,
    suggested: Math.round((offer + gap * 0.6) / 500) * 500,
  };
}
