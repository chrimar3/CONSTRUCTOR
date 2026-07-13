// T004 — derived logic: temperature(interest) per data-model.md
// "interest >= 4 → hot, =3 → warm, <=2 → cold"; interest is 1..5 integer.
import { describe, expect, test } from "bun:test";
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
