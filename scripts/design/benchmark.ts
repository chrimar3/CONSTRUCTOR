// IMPACT-LOOP — the honest benchmark (spec §2). The composite that CANNOT drift:
// the blind panel's subjective scores are capped by objective, machine-measured
// reality and blended with it per-dimension, and a drift flag fires when the raw
// panel floats above the capped truth. This is what turns "6.29 that flatters us"
// into a number that has to be earned against the facts.
//
// Config (ALPHA, cap coefficients, thresholds) is YELLOW — ratified after the
// first calibrated run, reviewed against the O/S split (spec §9).

import { WEIGHTS, type Dimension, type ScreenScores } from "./impact-model";

/** Per-screen objective inputs, all in [0,1] except the booleans. */
export interface ObjectiveScreen {
  palette_on_target_share: number;
  contrast_pass_rate: number;
  type_scale_adherence: number;
  honey_correct: boolean;
  touch_ok_share: number;
  tap_ok: boolean;
}

/** Per-dimension objective weight: score = α·O + (1−α)·min(S, cap). */
export const ALPHA: Record<Dimension, number> = {
  hierarchy: 0.3,
  completeness: 0.0, // no machine proxy — pure ladder-anchored S
  warmth: 0.5,
  typography: 0.5,
  responsiveness: 0.0, // no static proxy for motion/save-moment yet
  ergonomics: 0.6,
  gravitas: 0.0,
};

export interface BenchConfig {
  driftThreshold: number;
}
export const DEFAULT_CONFIG: BenchConfig = { driftThreshold: 1.5 };

// ── Cap functions: the best score the facts permit (spec §2.2) ──
export const capWarmth = (paletteShare: number, honeyOk = true) =>
  (3 + 6 * clamp01(paletteShare)) * (honeyOk ? 1 : 0.9);
export const capTypography = (typeAdherence: number) => 3 + 6 * clamp01(typeAdherence);
export const capHierarchy = (contrastRate: number) => 4 + 6 * clamp01(contrastRate);
export const capErgonomics = (touchShare: number) => 4 + 6 * clamp01(touchShare);

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Objective sub-score per dimension (0 where no machine proxy exists → α is 0 there). */
function objective(o: ObjectiveScreen): Record<Dimension, number> {
  return {
    hierarchy: 10 * clamp01(o.contrast_pass_rate),
    completeness: 0,
    warmth: 10 * clamp01(o.palette_on_target_share) * (o.honey_correct ? 1 : 0.9),
    typography: 10 * clamp01(o.type_scale_adherence),
    responsiveness: 0,
    ergonomics: 10 * (0.5 * clamp01(o.touch_ok_share) + 0.5 * (o.tap_ok ? 1 : 0)),
    gravitas: 0,
  };
}

/** Cap per dimension (10 = uncapped). */
function caps(o: ObjectiveScreen): Record<Dimension, number> {
  return {
    hierarchy: capHierarchy(o.contrast_pass_rate),
    completeness: 10,
    warmth: capWarmth(o.palette_on_target_share, o.honey_correct),
    typography: capTypography(o.type_scale_adherence),
    responsiveness: 10,
    ergonomics: capErgonomics(o.touch_ok_share),
    gravitas: 10,
  };
}

const DIMS = Object.keys(WEIGHTS) as Dimension[];
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface ScreenBenchmark {
  dims: Record<Dimension, number>;
  composite: number; // capped/blended honest composite
  sComposite: number; // raw panel composite (uncapped) — for the drift split
  drift: number; // sComposite − composite
  driftFlagged: boolean;
}

export interface Benchmark {
  perScreen: Record<string, ScreenBenchmark>;
  overall: number;
  minScreen: { screen: string; composite: number };
  overallDrift: number;
  driftFlagged: boolean;
}

/**
 * The honest composite. `objectiveByScreen` = machine facts; `subjectiveByScreen`
 * = ladder-anchored panel medians. Screens present in BOTH are scored.
 */
export function computeBenchmark(
  objectiveByScreen: Record<string, ObjectiveScreen>,
  subjectiveByScreen: ScreenScores,
  config: BenchConfig = DEFAULT_CONFIG,
): Benchmark {
  const perScreen: Record<string, ScreenBenchmark> = {};

  for (const screen of Object.keys(subjectiveByScreen)) {
    const o = objectiveByScreen[screen];
    const S = subjectiveByScreen[screen];
    if (!o || !S) continue;
    const O = objective(o);
    const cap = caps(o);
    const dims = {} as Record<Dimension, number>;
    let composite = 0;
    let sComposite = 0;
    for (const d of DIMS) {
      const cappedS = Math.min(S[d], cap[d]);
      const score = ALPHA[d] * O[d] + (1 - ALPHA[d]) * cappedS;
      dims[d] = r2(score);
      composite += WEIGHTS[d] * score;
      sComposite += WEIGHTS[d] * S[d];
    }
    const drift = sComposite - composite;
    perScreen[screen] = {
      dims,
      composite: r2(composite),
      sComposite: r2(sComposite),
      drift: r2(drift),
      driftFlagged: drift > config.driftThreshold,
    };
  }

  const screens = Object.keys(perScreen);
  const overall = r2(screens.reduce((s, k) => s + perScreen[k]!.composite, 0) / (screens.length || 1));
  const overallDrift = r2(screens.reduce((s, k) => s + perScreen[k]!.drift, 0) / (screens.length || 1));
  const minScreen = screens
    .map((k) => ({ screen: k, composite: perScreen[k]!.composite }))
    .sort((a, b) => a.composite - b.composite)[0] ?? { screen: "", composite: 0 };

  return {
    perScreen,
    overall,
    minScreen,
    overallDrift,
    driftFlagged: overallDrift > config.driftThreshold || screens.some((k) => perScreen[k]!.driftFlagged),
  };
}
