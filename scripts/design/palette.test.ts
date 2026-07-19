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
  test("the accent on the white ground clears AA body text (>=4.5)", () => {
    // precondition: these two ARE the intended text/ground pairing
    expect(isOnPalette(PALETTE.accent.base)).toBe(true);
    expect(contrastRatio(PALETTE.accent.base, PALETTE.grounds.white)).toBeGreaterThanOrEqual(4.5);
  });
  test("secondary ink clears AA on BOTH grounds (white and the inset field)", () => {
    // the pairing most likely to slip below AA when a ground is tinted
    expect(contrastRatio(PALETTE.ink.secondary, PALETTE.grounds.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.ink.secondary, PALETTE.grounds.field)).toBeGreaterThanOrEqual(4.5);
  });
  test("every temperature colour clears AA on both grounds", () => {
    for (const c of Object.values(PALETTE.temp)) {
      expect(contrastRatio(c, PALETTE.grounds.white)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c, PALETTE.grounds.field)).toBeGreaterThanOrEqual(4.5);
    }
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
  test("the accent family and both grounds are on-palette", () => {
    expect(isOnPalette(PALETTE.accent.base)).toBe(true);
    expect(isOnPalette(PALETTE.accent.press)).toBe(true);
    expect(isOnPalette(PALETTE.grounds.white)).toBe(true);
  });
  test("the RETIRED honey/gold money signals are OFF-palette (they must not return)", () => {
    // The exact hexes the rejected «Πεύκο & Μέλι» pass painted € figures with.
    // Variant A sets money as bold ink; if gold reappears the token gate trips.
    for (const c of ["#c89b3c", "#d9ae55", "#7a5a1e"]) {
      expect(isOnPalette(c)).toBe(false);
    }
  });
  test("the retired cream/beige grounds are OFF-palette (no warm tint may creep back)", () => {
    for (const c of ["#f7f3ea", "#fffdf8", "#f1ebdd"]) {
      expect(isOnPalette(c)).toBe(false);
    }
  });
  test("generic Tailwind grays/blue are OFF-palette", () => {
    for (const c of ["#111827", "#6b7280", "#1d4ed8", "#d1d5db", "#f4f4f5"]) {
      expect(isOnPalette(c)).toBe(false);
    }
  });
});

describe("isOnScale — pinned type scale 13/15/17/22/26 (variant A)", () => {
  test("the scale itself is exactly these five sizes", () => {
    expect(TYPE_SCALE).toEqual([13, 15, 17, 22, 26]);
  });
  test("on-scale sizes pass, off-scale sizes fail", () => {
    expect(isOnScale(13)).toBe(true);
    expect(isOnScale(26)).toBe(true);
    expect(isOnScale(14)).toBe(false);
    expect(isOnScale(20)).toBe(false); // retired with the old scale
  });
});

describe("honeyShare — the retired gold money signal must read 0%", () => {
  test("isHoneyToken recognizes both honey hexes only", () => {
    expect(isHoneyToken("#C89B3C")).toBe(true);
    expect(isHoneyToken("#D9AE55")).toBe(true);
    expect(isHoneyToken(PALETTE.accent.base)).toBe(false);
  });
  test("share is honey painted area over total painted area", () => {
    // synthetic fixture: 40 honey px out of 1000 painted = 4% → within budget
    const painted = { "#c89b3c": 40, "#0f7a6c": 600, "#ffffff": 360 };
    expect(honeyShare(painted)).toBeCloseTo(0.04, 5);
    expect(honeyShare(painted)).toBeLessThanOrEqual(0.05);
  });
  test("over-budget honey is detectable (fixture precondition: it IS over 5%)", () => {
    const overused = { "#c89b3c": 200, "#0f7a6c": 800 };
    expect(honeyShare(overused)).toBeGreaterThan(0.05); // 20% → must trip the gate
  });
});
