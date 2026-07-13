// T012 — pure web helpers, extracted so the capture-sheet logic is unit-testable
// without a DOM. The live counter preview delegates to the SAME domain counter()
// the API uses (ADR-0003 locked math) — the web never re-implements pricing math,
// it only guards user-input parsing around it. Formatting is manual (Greek decimal
// comma, dot thousands via formatEuro) — never toLocaleString/Intl.

import { counter, type CounterSuggestion } from "../domain/counter";
import { formatEuro } from "../domain/recommend";

/**
 * Parses an operator-typed € amount ("250.000", "250000", " 1.250.500 ") to a
 * positive integer. Anything empty, zero or non-numeric → null (no preview,
 * submit stays disabled).
 */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Live counter preview for the offer sheet: the domain counter() over the
 * effective unit's asking price and the amount as typed. Null when the amount
 * is unparseable, the asking is unknown/non-positive, or the offer is at/above
 * asking — the preview is advisory and must never throw mid-typing.
 */
export function counterPreview(
  asking: number | null | undefined,
  rawAmount: string,
): CounterSuggestion | null {
  const amount = parseAmount(rawAmount);
  if (amount === null) return null;
  if (asking === null || asking === undefined || !Number.isFinite(asking) || asking <= 0) {
    return null;
  }
  return counter(asking, amount);
}

/** 0.125 → "12,5%" — Greek decimal comma, at most one decimal, no ICU. */
export function formatPct(p: number): string {
  const pct = Math.round(p * 1000) / 10;
  const s = Number.isInteger(pct) ? String(pct) : String(pct).replace(".", ",");
  return `${s}%`;
}

/** One-tap "set as next action" text for a suggested counter (Article II filler). */
export function counterNextAction(suggested: number, pseudonym: string): string {
  return `Αντιπρόταση ${formatEuro(suggested)} στον αγοραστή ${pseudonym}`;
}
