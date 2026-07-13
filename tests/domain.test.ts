// T004 — derived logic: temperature(interest) per data-model.md
// "interest >= 4 → hot, =3 → warm, <=2 → cold"; interest is 1..5 integer.
import { describe, expect, test } from "bun:test";
import { counter } from "../src/domain/counter";
import { formatEuro, recommendation } from "../src/domain/recommend";
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

// T006 — recommendation(signals) → Greek string. PINNED thresholds (locked, data-model.md):
// viewings >= 3 AND offers = 0 → price-too-high; viewings < 3 → presentation/channel; else hold.
// Article VI: total function — non-empty Greek output for ANY input, never throws.
// Article III: euro formatting byte-deterministic, no host-ICU dependence.
describe("recommendation(signals) — pinned thresholds, total function (Article VI)", () => {
  const GREEK = /[Α-Ωα-ωΆΈΉΊΌΎΏάέήίόύώϊϋΐΰ]/;

  test("viewings >= 3 & offers = 0 with compsTarget → price recommendation with exact euro figure", () => {
    const out = recommendation({ viewings: 5, offers: 0, compsTarget: 285000 });
    expect(out).toContain("285.000 €");
    expect(out).toContain("comps");
    expect(GREEK.test(out)).toBe(true);
  });

  test("viewings >= 3 & offers = 0 without compsTarget → complete price recommendation, no number artifacts", () => {
    const out = recommendation({ viewings: 4, offers: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(GREEK.test(out)).toBe(true);
    expect(out).toContain("comps");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("€"); // no euro figure fabricated without a comps target
  });

  test("boundary: exactly 3 viewings & 0 offers → price branch (pinned >= 3)", () => {
    const out = recommendation({ viewings: 3, offers: 0 });
    expect(out).toContain("comps");
  });

  test("viewings < 3 & offers = 0 → presentation/channel suggestion", () => {
    const out = recommendation({ viewings: 2, offers: 0 });
    expect(GREEK.test(out)).toBe(true);
    expect(out).toMatch(/παρουσίασ|καναλ/);
    expect(out).not.toContain("comps");
  });

  test("offers present → hold, regardless of viewing count (ADR precedence over literal rule order)", () => {
    const holdHigh = recommendation({ viewings: 6, offers: 2 });
    const holdLow = recommendation({ viewings: 1, offers: 1 });
    expect(GREEK.test(holdHigh)).toBe(true);
    expect(GREEK.test(holdLow)).toBe(true);
    // a unit with live offers must never be told "staging refresh" or "price too high"
    expect(holdLow).not.toMatch(/παρουσίασ|καναλ/);
    expect(holdLow).not.toContain("comps");
    expect(holdHigh).not.toContain("comps");
  });

  test("total function: NaN / negative / non-finite inputs never throw and yield non-empty Greek", () => {
    const garbage: Array<{ viewings: number; offers: number; compsTarget?: number }> = [
      { viewings: Number.NaN, offers: Number.NaN },
      { viewings: -5, offers: -2 },
      { viewings: Number.POSITIVE_INFINITY, offers: 0 },
      { viewings: 4, offers: 0, compsTarget: Number.NaN },
      { viewings: 4, offers: 0, compsTarget: -100000 },
      { viewings: 2.7, offers: 0.4 },
    ];
    for (const signals of garbage) {
      const out = recommendation(signals);
      expect(out.length).toBeGreaterThan(0);
      expect(GREEK.test(out)).toBe(true);
      expect(out).not.toContain("NaN");
      expect(out).not.toContain("Infinity");
      expect(out).not.toContain("undefined");
    }
  });

  test("total function: absent/null signals object never throws, yields non-empty Greek", () => {
    // deliberately violates the compile-time type — Article VI must hold at runtime too
    const outNull = recommendation(null as unknown as Parameters<typeof recommendation>[0]);
    const outEmpty = recommendation({} as Parameters<typeof recommendation>[0]);
    expect(outNull.length).toBeGreaterThan(0);
    expect(GREEK.test(outNull)).toBe(true);
    expect(outEmpty.length).toBeGreaterThan(0);
    expect(GREEK.test(outEmpty)).toBe(true);
  });

  test("no-data garbage normalizes to the action branch, not a complacent hold", () => {
    // NaN counts = no data; Article VI spirit: bad data prompts action, never 'all fine'
    const out = recommendation({ viewings: Number.NaN, offers: Number.NaN });
    expect(out).toMatch(/παρουσίασ|καναλ/);
  });

  test("determinism: same input → byte-identical output", () => {
    const a = recommendation({ viewings: 3, offers: 0, compsTarget: 217300 });
    const b = recommendation({ viewings: 3, offers: 0, compsTarget: 217300 });
    expect(a).toBe(b);
  });
});

describe("formatEuro — byte-deterministic, no host-ICU dependence (Article III)", () => {
  test("dot thousands separators, trailing € sign", () => {
    expect(formatEuro(285000)).toBe("285.000 €");
    expect(formatEuro(1234567)).toBe("1.234.567 €");
    expect(formatEuro(500)).toBe("500 €");
    expect(formatEuro(0)).toBe("0 €");
  });

  test("non-integer amounts round to whole euros", () => {
    expect(formatEuro(217300.6)).toBe("217.301 €");
  });
});
