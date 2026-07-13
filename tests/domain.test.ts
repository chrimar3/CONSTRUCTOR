// T004 — derived logic: temperature(interest) per data-model.md
// "interest >= 4 → hot, =3 → warm, <=2 → cold"; interest is 1..5 integer.
import { describe, expect, test } from "bun:test";
import { counter } from "../src/domain/counter";
import { temperature, type Temperature } from "../src/domain/temperature";

describe("temperature(interest) — data-model derived logic", () => {
  test("interest 4 and 5 → hot", () => {
    expect(temperature(4)).toBe("hot");
    expect(temperature(5)).toBe("hot");
  });

  test("interest 3 → warm", () => {
    expect(temperature(3)).toBe("warm");
  });

  test("interest 1 and 2 → cold", () => {
    expect(temperature(1)).toBe("cold");
    expect(temperature(2)).toBe("cold");
  });

  test("out-of-range interest throws RangeError", () => {
    expect(() => temperature(0)).toThrow(RangeError);
    expect(() => temperature(6)).toThrow(RangeError);
    expect(() => temperature(-1)).toThrow(RangeError);
  });

  test("non-integer interest throws RangeError", () => {
    expect(() => temperature(3.5)).toThrow(RangeError);
    expect(() => temperature(Number.NaN)).toThrow(RangeError);
    expect(() => temperature(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test("Temperature type is exported and matches return values", () => {
    // Compile-time check: assignment fails to typecheck if the export drifts.
    const t: Temperature = temperature(5);
    expect(["hot", "warm", "cold"]).toContain(t);
  });
});

// T005 — derived logic: counter(asking, offer) per data-model.md + ADR-0003 locked weight.
// suggested = round((offer + (asking - offer) * 0.6) / 500) * 500 — deterministic (Article III).
describe("counter(asking, offer) — data-model derived logic", () => {
  test("offer at or above asking → null (no counter needed)", () => {
    expect(counter(300000, 300000)).toBeNull();
    expect(counter(300000, 310000)).toBeNull();
  });

  test("pinned vector: (300000, 270000) → pctBelow 0.1, suggested 288000", () => {
    const result = counter(300000, 270000);
    expect(result).not.toBeNull();
    expect(result!.pctBelow).toBe(0.1);
    expect(result!.suggested).toBe(288000);
  });

  test("pinned vector: (250000, 231300) → suggested 242500 (rounded to €500)", () => {
    const result = counter(250000, 231300);
    expect(result).not.toBeNull();
    expect(result!.pctBelow).toBe((250000 - 231300) / 250000);
    expect(result!.suggested).toBe(242500);
  });

  test("suggested is always a multiple of 500", () => {
    const result = counter(199999, 180001);
    expect(result).not.toBeNull();
    expect(result!.suggested % 500).toBe(0);
  });

  test("non-positive asking throws RangeError", () => {
    expect(() => counter(0, 100)).toThrow(RangeError);
    expect(() => counter(-300000, 270000)).toThrow(RangeError);
  });

  test("non-positive offer throws RangeError", () => {
    expect(() => counter(300000, 0)).toThrow(RangeError);
    expect(() => counter(300000, -270000)).toThrow(RangeError);
  });
});
