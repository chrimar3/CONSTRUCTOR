import { describe, test, expect } from "bun:test";
import { temperature } from "../src/domain/temperature";
import { counter } from "../src/domain/counter";

describe("temperature(interest)", () => {
  test("interest ≥ 4 → hot", () => {
    expect(temperature(4)).toBe("hot");
    expect(temperature(5)).toBe("hot");
  });

  test("interest = 3 → warm", () => {
    expect(temperature(3)).toBe("warm");
  });

  test("interest ≤ 2 → cold", () => {
    expect(temperature(1)).toBe("cold");
    expect(temperature(2)).toBe("cold");
  });

  test("rejects out-of-range interest (valid range is 1..5)", () => {
    expect(() => temperature(0)).toThrow();
    expect(() => temperature(6)).toThrow();
    expect(() => temperature(2.5)).toThrow();
  });
});

describe("counter(asking, offer)", () => {
  test("offer ≥ asking → null (no counter suggested; spec edge case)", () => {
    expect(counter(300_000, 300_000)).toBeNull();
    expect(counter(300_000, 310_000)).toBeNull();
  });

  test("offer below asking → pctBelow + suggested weighted 0.6 toward asking", () => {
    // asking 300k, offer 270k: 10% below; 270k + 30k*0.6 = 288k (already on €500 grid)
    const r = counter(300_000, 270_000);
    expect(r).not.toBeNull();
    expect(r!.pctBelow).toBeCloseTo(0.1, 10);
    expect(r!.suggested).toBe(288_000);
  });

  test("suggested is rounded to the nearest €500", () => {
    // asking 250k, offer 231.3k: 231300 + 18700*0.6 = 242520 → 242500
    expect(counter(250_000, 231_300)!.suggested).toBe(242_500);
    // asking 200k, offer 180.4k: 180400 + 19600*0.6 = 192160 → 192000
    expect(counter(200_000, 180_400)!.suggested).toBe(192_000);
  });

  test("deterministic: same inputs ⇒ same output (Article III)", () => {
    expect(counter(287_000, 251_000)).toEqual(counter(287_000, 251_000));
  });

  test("rejects non-positive amounts", () => {
    expect(() => counter(0, 100)).toThrow();
    expect(() => counter(300_000, 0)).toThrow();
    expect(() => counter(300_000, -5)).toThrow();
  });
});
