import { describe, test, expect } from "bun:test";
import { temperature } from "../src/domain/temperature";

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
