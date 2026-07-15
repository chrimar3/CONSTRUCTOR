// IMPACT-LOOP — pins for the seed lever catalog after the 2026-07-15 research
// correction: the token layer must not double-count hierarchy (contrast-driven)
// or the full type scale (the type-scale lever collapses to the tabular-nums
// remnant). Guards the correction against silent regression.

import { describe, expect, test } from "bun:test";
import { SEED_LEVERS } from "./levers";

const byId = (id: string) => SEED_LEVERS.find((l) => l.id === id)!;
const dimsOf = (id: string) => new Set(byId(id).affects.map((a) => a.dimension));

describe("seed lever catalog — no cross-lever double-counting", () => {
  test("the token layer affects warmth + typography, NOT hierarchy", () => {
    const dims = dimsOf("tokens-pinemeli");
    expect(dims.has("warmth")).toBe(true);
    expect(dims.has("typography")).toBe(true);
    expect(dims.has("hierarchy")).toBe(false); // hierarchy is contrast-driven → contrast-aa owns it
  });

  test("contrast-aa owns the hierarchy gain", () => {
    expect(dimsOf("contrast-aa").has("hierarchy")).toBe(true);
  });

  test("the type-scale gain collapses to the small tabular-nums remnant", () => {
    const tab = byId("tabular-numerals");
    const typo = tab.affects.find((a) => a.dimension === "typography")!;
    expect(typo.gain).toBeLessThanOrEqual(1); // the scale itself lives in the token layer
    // the old full-scale lever id must be gone (folded in)
    expect(SEED_LEVERS.find((l) => l.id === "type-scale-snap")).toBeUndefined();
  });
});
