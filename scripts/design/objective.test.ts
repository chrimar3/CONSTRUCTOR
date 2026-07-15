// IMPACT-LOOP — pins for the objective-scorer (spec §2.1): audit facts →
// ObjectiveScreen. Synthetic frames with asserted preconditions.

import { describe, expect, test } from "bun:test";
import { scoreFrame, scoreAudit, offPaletteColors, type AuditFrame } from "./objective";

const onBrand: AuditFrame = {
  frame: "board",
  paintedByColor: { "#14555a": 600, "#c89b3c": 30, "#ffffff": 370 }, // pine + honey + white
  usedColors: ["#14555a", "#c89b3c", "#ffffff"],
  fontSizes: [13, 15, 17],
  smallTargets: [],
  textPairs: [{ color: "#14555a", bg: "#ffffff", size: 15 }],
  interactiveCount: 4,
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
  test("on-brand frame scores high on palette + type + honey", () => {
    const o = scoreFrame(onBrand);
    expect(o.palette_on_target_share).toBeCloseTo(1, 5); // all colors on-palette
    expect(o.type_scale_adherence).toBeCloseTo(1, 5);
    expect(30 / 1000).toBeLessThanOrEqual(0.05); // precondition: honey within budget
    expect(o.honey_correct).toBe(true); // honey present, ≤5%
    expect(o.touch_ok_share).toBeCloseTo(1, 5);
  });
  test("off-brand frame scores low + flags small targets + failing contrast", () => {
    const o = scoreFrame(offBrand);
    expect(o.palette_on_target_share).toBeCloseTo(0, 5); // tailwind grays off-palette
    expect(o.type_scale_adherence).toBeCloseTo(0, 5); // 14,18 off-scale
    expect(o.contrast_pass_rate).toBeCloseTo(0, 5); // grey-on-grey fails
    expect(o.touch_ok_share).toBeCloseTo(0.75, 5); // 1 of 4 interactive too small
    expect(o.honey_correct).toBe(false); // board needs honey, none present
  });
});

describe("offPaletteColors — distinct off-palette used across frames", () => {
  test("collects the tailwind colors, not the on-palette ones", () => {
    const cs = offPaletteColors([onBrand, offBrand]);
    expect(cs).toContain("#111827");
    expect(cs).toContain("#1d4ed8");
    expect(cs).not.toContain("#14555a");
  });
});
