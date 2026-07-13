// Derived logic (data-model.md): temperature(interest) — deterministic, pure.
// interest >= 4 → hot · = 3 → warm · <= 2 → cold. Valid domain: integer 1..5.

export type Temperature = "hot" | "warm" | "cold";

export function temperature(interest: number): Temperature {
  if (!Number.isInteger(interest) || interest < 1 || interest > 5) {
    throw new RangeError(
      `interest must be an integer in 1..5, got ${interest}`,
    );
  }
  if (interest >= 4) return "hot";
  if (interest === 3) return "warm";
  return "cold";
}
