// DESIGN-LOOP Round 0 — RED-first pins for the pure mechanical-gate logic.
// These check the *checkers*, not the app: contrast math, palette membership,
// type-scale discipline, and the honey-budget share. The live-browser audit
// (harness.ts) is exercised end-to-end in design-gates.sh; here we pin the
// deterministic logic it depends on with synthetic fixtures whose preconditions
// are asserted, so a fixture that stops exercising the rule fails loudly.

import { describe, expect, test } from "bun:test";
import {
  PALETTE,
  TYPE_SCALE,
  contrastRatio,
  honeyShare,
  isHoneyToken,
  isOnPalette,
  isOnScale,
  normalizeHex,
} from "./palette";

describe("contrastRatio — WCAG relative-luminance ratio", () => {
  test("black on white is the maximum 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });
  test("identical colors are 1:1 (no contrast)", () => {
    expect(contrastRatio("#14555A", "#14555A")).toBeCloseTo(1, 5);
  });
  test("order-independent", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#000000"),
      5,
    );
  });
  test("Aegean-pine ink on alabaster ground clears AA body text (>=4.5)", () => {
    // precondition: these two ARE the intended text/ground pairing
    expect(isOnPalette("#14555A")).toBe(true);
    expect(contrastRatio("#14555A", PALETTE.grounds.alabaster)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("normalizeHex — canonical lowercase 6-digit", () => {
  test("uppercases, shorthand, and rgb() all fold to one form", () => {
    expect(normalizeHex("#14555A")).toBe("#14555a");
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("rgb(20, 85, 90)")).toBe("#14555a");
  });
});

describe("isOnPalette — 0 off-palette colors is the bar", () => {
  test("the two Aegean-pine accents are on-palette", () => {
    expect(isOnPalette("#14555A")).toBe(true);
    expect(isOnPalette("#4FA3A8")).toBe(true);
  });
  test("both honey signals are on-palette", () => {
    expect(isOnPalette("#C89B3C")).toBe(true);
    expect(isOnPalette("#D9AE55")).toBe(true);
  });
  test("generic Tailwind grays/blue the CURRENT app uses are OFF-palette", () => {
    // precondition: these are exactly colors grep found in App.tsx today — the
    // baseline must flag them, or the gate proves nothing.
    for (const c of ["#111827", "#6b7280", "#1d4ed8", "#d1d5db", "#f4f4f5"]) {
      expect(isOnPalette(c)).toBe(false);
    }
  });
});

describe("isOnScale — pinned type scale 13/15/17/20/24", () => {
  test("the scale itself is exactly these five sizes", () => {
    expect(TYPE_SCALE).toEqual([13, 15, 17, 20, 24]);
  });
  test("on-scale sizes pass, off-scale sizes fail", () => {
    expect(isOnScale(13)).toBe(true);
    expect(isOnScale(24)).toBe(true);
    expect(isOnScale(14)).toBe(false); // App.tsx uses 14 heavily today → baseline fail
    expect(isOnScale(18)).toBe(false);
  });
});

describe("honeyShare — honey <=5% of painted pixels", () => {
  test("isHoneyToken recognizes both honey hexes only", () => {
    expect(isHoneyToken("#C89B3C")).toBe(true);
    expect(isHoneyToken("#D9AE55")).toBe(true);
    expect(isHoneyToken("#14555A")).toBe(false);
  });
  test("share is honey painted area over total painted area", () => {
    // synthetic fixture: 40 honey px out of 1000 painted = 4% → within budget
    const painted = { "#c89b3c": 40, "#14555a": 600, "#f7f5f0": 360 };
    expect(honeyShare(painted)).toBeCloseTo(0.04, 5);
    expect(honeyShare(painted)).toBeLessThanOrEqual(0.05);
  });
  test("over-budget honey is detectable (fixture precondition: it IS over 5%)", () => {
    const overused = { "#c89b3c": 200, "#14555a": 800 };
    expect(honeyShare(overused)).toBeGreaterThan(0.05); // 20% → must trip the gate
  });
});
