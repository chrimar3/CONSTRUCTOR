// T012 — pure web helpers, extracted so the capture-sheet logic is unit-testable
// without a DOM. The live counter preview delegates to the SAME domain counter()
// the API uses (ADR-0003 locked math) — the web never re-implements pricing math,
// it only guards user-input parsing around it. Formatting is manual (Greek decimal
// comma, dot thousands via formatEuro) — never toLocaleString/Intl.

import { counter, type CounterSuggestion } from "../domain/counter";
import { isValidPinFormat } from "../domain/pin";
import { formatEuro } from "../domain/recommend";

/**
 * B0a (RULING 2026-07-14b) — PIN-gate submit predicate: the trimmed input must
 * be a well-formed team PIN (domain policy, 4-12 digits). Pure — headlessly
 * testable; the gate component both disables the button and guards submit().
 */
export function pinSubmittable(raw: string): boolean {
  return isValidPinFormat(raw.trim());
}

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

// ─── T013 — the ONE submit predicate for all three capture sheets ────────────
// Article II at the UI: a blank/whitespace-only next_action can never submit,
// on any sheet. Per-sheet required fields gate alongside it (lead: source;
// viewing: buyer + interest; offer: buyer + parseable amount) so the extracted
// predicate is exactly as strict as the sheets it drives. Pure — no DOM, no
// I/O — so it is unit-testable headlessly; the sheets both disable the button
// visually AND guard submit() with it (disabled attribute alone is advisory).

export type SheetSubmitInput =
  | { kind: "lead"; source: string | null; nextAction: string }
  | { kind: "viewing"; buyerId: number | null; interest: number | null; nextAction: string }
  | { kind: "offer"; buyerId: number | null; amount: string; nextAction: string };

export function canSubmit(input: SheetSubmitInput): boolean {
  // Article II first: JS trim() strips tabs/newlines/CR too (stricter than
  // SQLite's space-only trim — same all-whitespace bar as the CHECK + guards).
  if (input.nextAction.trim().length === 0) return false;
  switch (input.kind) {
    case "lead":
      return input.source !== null;
    case "viewing":
      return input.buyerId !== null && input.interest !== null;
    case "offer":
      return input.buyerId !== null && parseAmount(input.amount) !== null;
  }
}
