// IMPACT-LOOP — RED-first pins for the honest benchmark (spec §2). The composite
// must (a) cap a subjective dimension by objective reality — a 0%-on-palette
// screen cannot score "warm 8"; (b) blend O and S per the α weights; (c) pass
// uncapped dimensions (completeness/gravitas) straight through; (d) raise a DRIFT
// flag when the raw panel sits far above the capped composite. Synthetic fixtures
// with asserted preconditions.

import { describe, expect, test } from "bun:test";
import { ALPHA, capWarmth, computeBenchmark, type ObjectiveScreen } from "./benchmark";

const S_HIGH = { hierarchy: 8, completeness: 8, warmth: 9, typography: 8, responsiveness: 7, ergonomics: 8, gravitas: 8 };

// Objective reality that CONTRADICTS the high panel: nothing on-palette, type off-scale.
const O_OFFBRAND: ObjectiveScreen = {
  palette_on_target_share: 0,
  contrast_pass_rate: 0.5,
  type_scale_adherence: 0,
  honey_correct: false,
  touch_ok_share: 1,
  tap_ok: true,
};

describe("capWarmth — only a realized palette permits a high warmth score", () => {
  test("0% on-palette caps warmth at 3", () => {
    expect(capWarmth(0)).toBeCloseTo(3, 5);
  });
  test("100% on-palette lifts the cap to 9", () => {
    expect(capWarmth(1)).toBeCloseTo(9, 5);
  });
});

describe("computeBenchmark — objective caps bind the subjective score", () => {
  const b = computeBenchmark({ board: O_OFFBRAND }, { board: S_HIGH }, undefined);
  const screen = b.perScreen.board;

  test("a panel warmth of 9 on a 0%-on-palette screen cannot survive", () => {
    // precondition: the panel really did score warmth 9
    expect(S_HIGH.warmth).toBe(9);
    // 0% on-palette → cap = capWarmth(0, honey=false) = 2.7; O_warmth 0, α .5
    //   → 0.5·0 + 0.5·min(9, 2.7) = 1.35 — the panel's 9 cannot survive the facts.
    expect(screen.dims.warmth).toBeCloseTo(ALPHA.warmth * 0 + (1 - ALPHA.warmth) * capWarmth(0, false), 2);
    expect(screen.dims.warmth).toBeLessThanOrEqual(3);
  });

  test("uncapped dimensions (completeness) pass the panel through", () => {
    expect(screen.dims.completeness).toBeCloseTo(8, 5);
  });

  test("the capped composite sits well below the raw panel composite", () => {
    expect(screen.composite).toBeLessThan(screen.sComposite);
  });

  test("the DRIFT flag fires when the panel floats above the facts", () => {
    // S_composite − capped composite should exceed the default threshold here
    expect(screen.drift).toBeGreaterThan(1.5);
    expect(screen.driftFlagged).toBe(true);
    expect(b.driftFlagged).toBe(true);
  });
});

describe("computeBenchmark — an honestly on-brand screen does NOT drift", () => {
  const O_ONBRAND: ObjectiveScreen = {
    palette_on_target_share: 1,
    contrast_pass_rate: 1,
    type_scale_adherence: 1,
    honey_correct: true,
    touch_ok_share: 1,
    tap_ok: true,
  };
  test("caps are slack, composite ≈ panel, no drift flag", () => {
    const b = computeBenchmark({ board: O_ONBRAND }, { board: S_HIGH });
    expect(b.perScreen.board.driftFlagged).toBe(false);
    expect(b.perScreen.board.composite).toBeGreaterThan(7.5);
  });
});
