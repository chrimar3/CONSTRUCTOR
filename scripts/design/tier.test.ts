// IMPACT-LOOP — pins for the tier ladder (spec §3). Each tier requires its hard
// objective gate AND its subjective floor; a tier cannot be claimed while any of
// its objective gates fail.

import { describe, expect, test } from "bun:test";
import { tierFor } from "./tier";

describe("tierFor — T0..T3 with hard objective gates", () => {
  test("baseline generic app is T0", () => {
    expect(
      tierFor({ overall: 5.84, minScreen: 4.8, offPaletteShare: 0.78, anyOffScale: true,
        contrastPass: 0.85, honeyCorrect: false, allGatesPass: false }).tier,
    ).toBe("T0");
  });
  test("coherent (off-palette < 40%, no off-scale, overall ≥ 6.5) is T1", () => {
    expect(
      tierFor({ overall: 6.7, minScreen: 6.0, offPaletteShare: 0.3, anyOffScale: false,
        contrastPass: 0.95, honeyCorrect: false, allGatesPass: false }).tier,
    ).toBe("T1");
  });
  test("branded (palette ≥ 90%, honey ok, AA, overall ≥ 7.5, min ≥ 6.5) is T2", () => {
    expect(
      tierFor({ overall: 7.6, minScreen: 6.6, offPaletteShare: 0.08, anyOffScale: false,
        contrastPass: 1, honeyCorrect: true, allGatesPass: false }).tier,
    ).toBe("T2");
  });
  test("reference-grade needs ALL gates pass + overall ≥ 8.5 + min ≥ 7.5", () => {
    expect(
      tierFor({ overall: 8.6, minScreen: 7.6, offPaletteShare: 0, anyOffScale: false,
        contrastPass: 1, honeyCorrect: true, allGatesPass: true }).tier,
    ).toBe("T3");
  });
  test("high score but a failing gate cannot claim the higher tier", () => {
    // overall 8.6 but honey not correct → cannot be T3 (all-gates-pass false)
    expect(
      tierFor({ overall: 8.6, minScreen: 7.6, offPaletteShare: 0.05, anyOffScale: false,
        contrastPass: 1, honeyCorrect: false, allGatesPass: false }).tier,
    ).not.toBe("T3");
  });
});
