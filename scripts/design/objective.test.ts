// IMPACT-LOOP — pins for the objective-scorer (spec §2.1): audit facts →
// ObjectiveScreen. Synthetic frames with asserted preconditions.

import { describe, expect, test } from "bun:test";
import { scoreFrame, scoreAudit, offPaletteColors, type AuditFrame } from "./objective";

// Variant-A on-brand frame: white ground, teal accent, money as ink — and NO
// gold anywhere (precondition asserted in the test below).
const onBrand: AuditFrame = {
  frame: "board",
  paintedByColor: { "#0f7a6c": 600, "#f4f4f4": 30, "#ffffff": 370 },
  usedColors: ["#0f7a6c", "#1c1c1c", "#ffffff"],
  fontSizes: [13, 15, 17],
  smallTargets: [],
  textPairs: [{ color: "#0f7a6c", bg: "#ffffff", size: 15 }],
  interactiveCount: 4,
};
// A relapse frame: identical to onBrand except € figures are painted gold again.
const goldRelapse: AuditFrame = {
  ...onBrand,
  usedColors: [...onBrand.usedColors, "#7a5a1e"],
};
const offBrand: AuditFrame = {
  frame: "board",
  paintedByColor: { "#111827": 500, "#6b7280": 500 }, // tailwind grays
  usedColors: ["#111827", "#6b7280", "#1d4ed8"],
  fontSizes: [14, 18], // off-scale
  smallTargets: [{ tag: "button", w: 30, h: 30, label: "x" }],
  textPairs: [{ color: "#6b7280", bg: "#6b7280", size: 14 }], // fails AA
  interactiveCount: 4,
};

describe("scoreFrame — audit facts → ObjectiveScreen", () => {
  test("on-brand frame scores high on palette + type, and is gold-free", () => {
    // precondition: the fixture really does contain no retired gold token —
    // otherwise honey_correct would prove nothing.
    expect(onBrand.usedColors.some((c) => c === "#7a5a1e" || c === "#c89b3c")).toBe(false);
    const o = scoreFrame(onBrand);
    expect(o.palette_on_target_share).toBeCloseTo(1, 5); // all colors on-palette
    expect(o.type_scale_adherence).toBeCloseTo(1, 5);
    expect(o.honey_correct).toBe(true); // the retired gold signal is absent
    expect(o.touch_ok_share).toBeCloseTo(1, 5);
  });
  test("a gold-money relapse is caught even though gold paints almost no area", () => {
    // precondition: the ONLY difference from onBrand is the gold € text colour.
    expect(goldRelapse.paintedByColor).toEqual(onBrand.paintedByColor);
    expect(scoreFrame(onBrand).honey_correct).toBe(true);
    expect(scoreFrame(goldRelapse).honey_correct).toBe(false);
  });
  test("off-brand frame scores low + flags small targets + failing contrast", () => {
    const o = scoreFrame(offBrand);
    expect(o.palette_on_target_share).toBeCloseTo(0, 5); // tailwind grays off-palette
    expect(o.type_scale_adherence).toBeCloseTo(0, 5); // 14,18 off-scale
    expect(o.contrast_pass_rate).toBeCloseTo(0, 5); // grey-on-grey fails
    expect(o.touch_ok_share).toBeCloseTo(0.75, 5); // 1 of 4 interactive too small
    expect(o.honey_correct).toBe(true); // no gold present — the one thing it gets right
  });
});

describe("offPaletteColors — distinct off-palette used across frames", () => {
  test("collects the tailwind colors, not the on-palette ones", () => {
    const cs = offPaletteColors([onBrand, offBrand]);
    expect(cs).toContain("#111827");
    expect(cs).toContain("#1d4ed8");
    expect(cs).not.toContain("#0f7a6c");
  });
});
