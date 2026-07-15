// IMPACT-LOOP — RED-first pins for the impact-ranking engine (spec §4). The model
// must (a) score a lever's ExpectedLift = Σ weight·min(headroom, gain) over every
// (screen,dimension) it touches, (b) rank by Priority = ExpectedLift/effort, and
// (c) make a palette-wide lever outrank a single-screen contrast fix. Synthetic
// fixtures with asserted preconditions so the pins can't go vacuous.

import { describe, expect, test } from "bun:test";
import { WEIGHTS, expectedLift, rankLevers, type ScreenScores } from "./impact-model";

// A deliberately low baseline: warmth is floored everywhere (headroom high).
const SCORES: ScreenScores = {
  pin: { hierarchy: 6, completeness: 3, warmth: 3, typography: 6, responsiveness: 5, ergonomics: 6, gravitas: 4 },
  board: { hierarchy: 8, completeness: 8, warmth: 3, typography: 6, responsiveness: 7, ergonomics: 8, gravitas: 8 },
  operator: { hierarchy: 6, completeness: 3, warmth: 3, typography: 6, responsiveness: 5, ergonomics: 7, gravitas: 4 },
};

describe("WEIGHTS — the rubric weights sum to 1", () => {
  test("seven dimensions, total weight 1.0", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Object.keys(WEIGHTS)).toHaveLength(7);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe("expectedLift — Σ weight·min(headroom, gain)", () => {
  test("clamps gain to available headroom", () => {
    // precondition: warmth on 'board' is far below the ceiling
    expect(SCORES.board.warmth).toBeLessThan(9);
    // a lever claiming +6 warmth on board, ceiling 9 → headroom 6 → min(6,6)=6
    const lift = expectedLift(
      { id: "x", title: "", zone: "YELLOW", effort: 1, affects: [{ screen: "board", dimension: "warmth", gain: 6 }] },
      SCORES,
      { ceiling: 9 },
    );
    expect(lift).toBeCloseTo(WEIGHTS.warmth * 6, 5);
  });
  test("headroom caps an over-optimistic gain", () => {
    // warmth 3, ceiling 9 → headroom 6; a lever claiming +10 still only earns 6
    const lift = expectedLift(
      { id: "x", title: "", zone: "YELLOW", effort: 1, affects: [{ screen: "board", dimension: "warmth", gain: 10 }] },
      SCORES,
      { ceiling: 9 },
    );
    expect(lift).toBeCloseTo(WEIGHTS.warmth * 6, 5);
  });
  test("an allScreens lever sums across every screen", () => {
    const lift = expectedLift(
      { id: "tokens", title: "", zone: "YELLOW", effort: 3, allScreens: true, affects: [{ dimension: "warmth", gain: 6 }] },
      SCORES,
      { ceiling: 9 },
    );
    // 3 screens × warmth headroom 6 × weight
    expect(lift).toBeCloseTo(WEIGHTS.warmth * 6 * 3, 5);
  });
});

describe("rankLevers — palette-wide beats a single-screen fix", () => {
  const paletteLever = {
    id: "tokens",
    title: "«Πεύκο & Μέλι» token layer",
    zone: "YELLOW" as const,
    effort: 3,
    allScreens: true,
    affects: [
      { dimension: "warmth", gain: 6 },
      { dimension: "typography", gain: 2 },
    ],
  };
  const contrastFix = {
    id: "board-contrast",
    title: "Fix one badge contrast on board",
    zone: "GREEN" as const,
    effort: 1,
    affects: [{ screen: "board", dimension: "hierarchy", gain: 1 }],
  };

  test("token lever outranks the single-screen contrast fix on ExpectedLift and Priority", () => {
    const ranked = rankLevers([contrastFix, paletteLever], SCORES, { ceiling: 9 });
    expect(ranked[0].lever.id).toBe("tokens");
    expect(ranked[0].expectedLift).toBeGreaterThan(ranked[1].expectedLift);
    // ranking is by priority (lift/effort); token still wins despite higher effort
    expect(ranked[0].priority).toBeGreaterThan(ranked[1].priority);
  });

  test("priority = expectedLift / effort", () => {
    const [top] = rankLevers([paletteLever], SCORES, { ceiling: 9 });
    expect(top.priority).toBeCloseTo(top.expectedLift / paletteLever.effort, 5);
  });
});
