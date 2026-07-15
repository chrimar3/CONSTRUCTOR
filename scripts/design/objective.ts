// IMPACT-LOOP — objective-scorer. Turns the capture harness audit (per frame:
// colors+area, used colors, font sizes, text/bg pairs, interactive/touch counts)
// into the per-screen ObjectiveScreen inputs the honest benchmark consumes
// (spec §2.1). Pure given an audit array. tap_ok is app-wide (SC-1, verified
// separately) and injected.

import {
  HONEY_MAX_SHARE,
  contrastRatio,
  honeyShare,
  isHoneyToken,
  isOnPalette,
  isOnScale,
  normalizeHex,
} from "./palette";
import type { ObjectiveScreen } from "./benchmark";

export interface AuditFrame {
  frame: string;
  paintedByColor: Record<string, number>;
  usedColors: string[];
  fontSizes: number[];
  smallTargets: { tag: string; w: number; h: number; label: string }[];
  textPairs: { color: string; bg: string; size: number }[];
  interactiveCount?: number;
}

/** Share of PAINTED AREA that is on the «Πεύκο & Μέλι» palette. */
function paletteOnTargetShare(paintedByColor: Record<string, number>): number {
  let total = 0;
  let on = 0;
  for (const [color, area] of Object.entries(paintedByColor)) {
    total += area;
    if (isOnPalette(color)) on += area;
  }
  return total === 0 ? 1 : on / total;
}

function contrastPassRate(pairs: AuditFrame["textPairs"]): number {
  if (pairs.length === 0) return 1;
  let pass = 0;
  for (const p of pairs) {
    const threshold = p.size >= 24 ? 3.0 : 4.5;
    if (contrastRatio(p.color, p.bg) >= threshold) pass++;
  }
  return pass / pairs.length;
}

function typeScaleAdherence(fontSizes: number[]): number {
  if (fontSizes.length === 0) return 1;
  const on = fontSizes.filter(isOnScale).length;
  return on / fontSizes.length;
}

function touchOkShare(f: AuditFrame): number {
  const total = f.interactiveCount ?? f.smallTargets.length; // fallback: only-small known
  if (total === 0) return 1;
  return Math.max(0, (total - f.smallTargets.length) / total);
}

/** Score one frame's objective facts. */
export function scoreFrame(f: AuditFrame, tapOk = true): ObjectiveScreen {
  const honey = honeyShare(f.paintedByColor);
  // "honey_correct" = within the painted-pixel budget AND actually present on the
  // money/save surfaces (board + sheets + reports). Presence checks USED colors
  // (incl. text), so the AA-safe honey-ink on € figures counts even though it
  // paints ~no area. Absent on PIN/operator is fine.
  const needsHoney = /board|sheet|report|offer/.test(f.frame);
  const honeyPresent = honey > 0 || f.usedColors.some(isHoneyToken);
  const honey_correct = honey <= HONEY_MAX_SHARE && (!needsHoney || honeyPresent);
  return {
    palette_on_target_share: paletteOnTargetShare(f.paintedByColor),
    contrast_pass_rate: contrastPassRate(f.textPairs),
    type_scale_adherence: typeScaleAdherence(f.fontSizes),
    honey_correct,
    touch_ok_share: touchOkShare(f),
    tap_ok: tapOk,
  };
}

/** audit.json (array of frames) → { screen → ObjectiveScreen }. */
export function scoreAudit(audits: AuditFrame[], tapOk = true): Record<string, ObjectiveScreen> {
  const out: Record<string, ObjectiveScreen> = {};
  for (const f of audits) out[f.frame] = scoreFrame(f, tapOk);
  return out;
}

/** Convenience: also expose distinct off-palette colors for the ledger. */
export function offPaletteColors(audits: AuditFrame[]): string[] {
  const set = new Set<string>();
  for (const f of audits) for (const c of f.usedColors) if (!isOnPalette(c)) set.add(normalizeHex(c));
  return [...set];
}
