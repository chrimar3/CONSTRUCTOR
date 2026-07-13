export interface CounterSuggestion {
  /** Fraction below asking, e.g. 0.1 = 10% below. */
  pctBelow: number;
  /** Suggested counter-offer in €, weighted 0.6 toward asking, rounded to €500 (ADR-0003). */
  suggested: number;
}

/**
 * Deterministic counter-offer math (Article III). Only applies when the offer
 * is below asking; at-or-above asking there is nothing to counter (spec edge case).
 */
export function counter(asking: number, offer: number): CounterSuggestion | null {
  if (asking <= 0 || offer <= 0) {
    throw new RangeError(`asking and offer must be positive, got asking=${asking} offer=${offer}`);
  }
  if (offer >= asking) return null;

  const pctBelow = (asking - offer) / asking;
  const suggested = Math.round((offer + (asking - offer) * 0.6) / 500) * 500;
  return { pctBelow, suggested };
}
