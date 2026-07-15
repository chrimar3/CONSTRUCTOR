// IMPACT-LOOP — pins for the reference ladder + calibration gate (spec §2.2).

import { describe, expect, test } from "bun:test";
import { LADDER, CALIBRATION, calibrationOk } from "./ladder";

describe("reference ladder", () => {
  test("four anchored levels 2/5/8/10, each with a cited source", () => {
    expect(LADDER.map((l) => l.level)).toEqual([2, 5, 8, 10]);
    for (const l of LADDER) {
      expect(l.source.length).toBeGreaterThan(0);
      expect(l.descriptor.length).toBeGreaterThan(20);
    }
  });

  test("calibrationOk accepts a well-calibrated judge", () => {
    const good = CALIBRATION.map((c) => ({ id: c.id, score: c.expected }));
    expect(calibrationOk(good)).toBe(true);
  });

  test("calibrationOk discards a judge who under-rates the known-high anchor", () => {
    const bad = CALIBRATION.map((c) => ({ id: c.id, score: c.expected >= 8 ? 5 : c.expected }));
    expect(calibrationOk(bad)).toBe(false);
  });

  test("calibrationOk discards a judge who over-rates the known-low anchor", () => {
    const bad = CALIBRATION.map((c) => ({ id: c.id, score: c.expected <= 2 ? 6 : c.expected }));
    expect(calibrationOk(bad)).toBe(false);
  });
});
