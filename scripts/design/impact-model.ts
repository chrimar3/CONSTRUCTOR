// IMPACT-LOOP — the impact-ranking engine (spec §4). Pure and deterministic:
// given the current honest per-screen×per-dimension scores and a catalog of
// candidate levers, compute each lever's ExpectedLift and rank by Priority. This
// is the machinery behind "find each time the most impactful item that would
// raise the score." The research pass augments/reorders the catalog; the math
// here is the ungameable backbone of the choice.

export type Dimension =
  | "hierarchy"
  | "completeness"
  | "warmth"
  | "typography"
  | "responsiveness"
  | "ergonomics"
  | "gravitas";

/** Benchmarks-B rubric weights (verbatim from DESIGN-LOOP.md). */
export const WEIGHTS: Record<Dimension, number> = {
  hierarchy: 0.2,
  completeness: 0.2,
  warmth: 0.15,
  typography: 0.15,
  responsiveness: 0.1,
  ergonomics: 0.1,
  gravitas: 0.1,
};

export type ScreenScores = Record<string, Record<Dimension, number>>;

export interface LeverAffect {
  /** omit when allScreens is true */
  screen?: string;
  dimension: Dimension;
  /** estimated points this lever adds to (screen,dimension), before headroom clamp */
  gain: number;
}

export interface Lever {
  id: string;
  title: string;
  zone: "GREEN" | "YELLOW" | "RED";
  /** relative effort (S=1, M=3, L=6 by convention); Priority = lift/effort */
  effort: number;
  /** when true, each affect applies to EVERY screen in the scores */
  allScreens?: boolean;
  affects: LeverAffect[];
  note?: string;
  /** research provenance / gain justification, filled by the research pass */
  rationale?: string;
}

export interface RankOpts {
  /** score ceiling per dimension (current tier target, else 10) */
  ceiling?: number;
  weights?: Record<Dimension, number>;
}

export interface RankedLever {
  lever: Lever;
  expectedLift: number;
  priority: number;
  /** per-(screen,dimension) contribution, for the ledger's explainability */
  breakdown: { screen: string; dimension: Dimension; headroom: number; gain: number; contribution: number }[];
}

/** ExpectedLift(L) = Σ over affected (s,d) of weight_d · min(headroom_d(s), gain). */
export function expectedLift(lever: Lever, scores: ScreenScores, opts: RankOpts = {}): number {
  return rank1(lever, scores, opts).expectedLift;
}

function rank1(lever: Lever, scores: ScreenScores, opts: RankOpts): RankedLever {
  const ceiling = opts.ceiling ?? 10;
  const weights = opts.weights ?? WEIGHTS;
  const screens = Object.keys(scores);
  const breakdown: RankedLever["breakdown"] = [];
  let expected = 0;

  for (const a of lever.affects) {
    const targetScreens = lever.allScreens ? screens : a.screen ? [a.screen] : [];
    for (const s of targetScreens) {
      const cur = scores[s]?.[a.dimension];
      if (typeof cur !== "number") continue;
      const headroom = Math.max(0, ceiling - cur);
      const applied = Math.min(headroom, a.gain);
      const contribution = weights[a.dimension] * applied;
      expected += contribution;
      breakdown.push({ screen: s, dimension: a.dimension, headroom, gain: a.gain, contribution });
    }
  }

  const expectedLiftRounded = Math.round(expected * 1000) / 1000;
  const effort = lever.effort > 0 ? lever.effort : 1;
  return {
    lever,
    expectedLift: expectedLiftRounded,
    priority: Math.round((expectedLiftRounded / effort) * 1000) / 1000,
    breakdown,
  };
}

/** Rank a catalog by Priority (ExpectedLift / effort), highest first. */
export function rankLevers(levers: Lever[], scores: ScreenScores, opts: RankOpts = {}): RankedLever[] {
  return levers
    .map((l) => rank1(l, scores, opts))
    .sort((a, b) => b.priority - a.priority || b.expectedLift - a.expectedLift);
}
