// IMPACT-LOOP — pins for panel v2: the calibration-gated, neutral→real de-shuffle
// that turns raw judge outputs into the subjective ScreenScores the benchmark
// consumes. A miscalibrated judge is dropped before the median.

import { describe, expect, test } from "bun:test";
import { deshuffle } from "./panel";

const mk = (warmth: number, calOk: boolean) => ({
  deck: { "frame-a": "board" } as Record<string, string>,
  result: {
    calibration: calOk
      ? [{ id: "cal-8", score: 8 }, { id: "cal-2", score: 2 }]
      : [{ id: "cal-8", score: 4 }, { id: "cal-2", score: 2 }], // under-rates the known-8
    frames: [
      { frame: "frame-a", hierarchy: 7, completeness: 7, warmth, typography: 7, responsiveness: 7, ergonomics: 7, gravitas: 7 },
    ],
  },
});

describe("deshuffle — neutral→real, median per dimension, calibration-gated", () => {
  test("drops the miscalibrated judge, medians the rest", () => {
    // judges warmth {8, 6, 2}; the warmth-2 judge is miscalibrated → dropped
    const scores = deshuffle([mk(8, true), mk(6, true), mk(2, false)]);
    expect(scores.board.warmth).toBe(7); // median of {8, 6}
  });

  test("maps the neutral frame id back to the real screen", () => {
    const scores = deshuffle([mk(8, true)]);
    expect(scores.board).toBeDefined();
    expect(Object.keys(scores)).toEqual(["board"]);
  });
});
