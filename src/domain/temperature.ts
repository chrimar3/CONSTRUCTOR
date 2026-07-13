export type Temperature = "hot" | "warm" | "cold";

/**
 * Deterministic temperature from the latest viewing interest rating (1..5).
 * ≥4 hot, =3 warm, ≤2 cold (data-model.md). Offers set temperature hot at
 * the capture layer, not here.
 */
export function temperature(interest: number): Temperature {
  if (!Number.isInteger(interest) || interest < 1 || interest > 5) {
    throw new RangeError(`interest must be an integer 1..5, got ${interest}`);
  }
  if (interest >= 4) return "hot";
  if (interest === 3) return "warm";
  return "cold";
}
