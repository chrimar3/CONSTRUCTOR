// IMPACT-LOOP — tier ladder (spec §3). Each tier requires its hard objective gate
// AND its subjective floor; a tier cannot be claimed while any objective gate
// fails (as un-fakeable as the score). Thresholds are YELLOW — ratified after the
// first calibrated run.

export interface TierInput {
  overall: number;
  minScreen: number;
  /** share of painted area NOT on the «Πεύκο & Μέλι» palette, 0..1 */
  offPaletteShare: number;
  anyOffScale: boolean;
  /** overall text-pair AA pass rate 0..1 */
  contrastPass: number;
  honeyCorrect: boolean;
  /** every mechanical design gate green */
  allGatesPass: boolean;
}

export type Tier = "T0" | "T1" | "T2" | "T3";

export function tierFor(i: TierInput): { tier: Tier; label: string; nextGate: string } {
  if (i.allGatesPass && i.overall >= 8.5 && i.minScreen >= 7.5)
    return { tier: "T3", label: "Reference-grade", nextGate: "— (exit)" };
  if (i.offPaletteShare <= 0.1 && i.honeyCorrect && i.contrastPass >= 1 && i.overall >= 7.5 && i.minScreen >= 6.5)
    return { tier: "T2", label: "Branded", nextGate: "all objective gates PASS · overall ≥ 8.5 · no screen < 7.5" };
  if (i.offPaletteShare < 0.4 && !i.anyOffScale && i.overall >= 6.5)
    return { tier: "T1", label: "Coherent", nextGate: "palette ≥ 90% · honey correct · AA everywhere · overall ≥ 7.5 · no screen < 6.5" };
  return { tier: "T0", label: "Functional", nextGate: "off-palette < 40% · 0 off-scale type · overall ≥ 6.5" };
}
