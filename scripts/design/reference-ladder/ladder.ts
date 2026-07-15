// IMPACT-LOOP — reference ladder + calibration gate (spec §2.2). Real best-in-
// class product surfaces anchor what each score LEVEL looks like, so "10" stays
// expensive: a judge sees a genuine 8 beside the work. Descriptors are grounded
// in canonical, recognizable products (the research floor per spec §9); sourcing
// representative anchor IMAGES where licensing allows is a YELLOW follow-up.
//
// The ladder ships in every judge deck; each judge scores the CALIBRATION anchors
// first, and a judge whose calibration is off is discarded (extends the Round-0
// transcript-audit discard).

export interface LadderLevel {
  level: 2 | 5 | 8 | 10;
  descriptor: string;
  source: string;
}

export const LADDER: LadderLevel[] = [
  {
    level: 2,
    descriptor:
      "Rough / unstyled. Default framework output: flat system-font text on plain white, no considered colour, uneven ad-hoc spacing, controls that look like raw HTML. Reads as a wireframe or an internal CRUD admin — nothing about it was designed.",
    source: "e.g. an unstyled Bootstrap/CRUD admin scaffold",
  },
  {
    level: 5,
    descriptor:
      "Functional but anonymous SaaS. A consistent neutral palette (framework greys + one stock blue), rounded cards, legible type, adequate touch targets — competent and usable, but with no brand personality: you could not name the product from a screenshot, and money/data read as plain text rather than as considered information.",
    source: "e.g. a generic Tailwind-UI / Material dashboard",
  },
  {
    level: 8,
    descriptor:
      "A considered product with a distinct visual language. A restrained brand palette used with discipline, a real type scale with tabular figures for numbers, purposeful hierarchy (the eye lands on the right thing unprompted), one confident accent used sparingly, density that respects one-handed use. A professional would forward it to a client without embarrassment.",
    source: "e.g. Linear mobile issue view · Attio deal record · Pipedrive deal card",
  },
  {
    level: 10,
    descriptor:
      "Best-in-class. Every detail intentional: motion that clarifies rather than decorates, typography that feels authored, colour that carries meaning, spacing on a felt grid, a signature moment or two — indistinguishable from the very top of the category. Nothing to add, nothing to remove.",
    source: "e.g. Superhuman · Linear at their best",
  },
];

export interface CalibrationAnchor {
  id: string;
  expected: number;
  descriptor: string;
}

/** The anchors a judge must score BEFORE the real deck (calibration gate). */
export const CALIBRATION: CalibrationAnchor[] = LADDER.map((l) => ({
  id: `cal-${l.level}`,
  expected: l.level,
  descriptor: l.descriptor,
}));

/**
 * A judge is well-calibrated iff they do not badly misread the extreme anchors:
 * a known-high (≥8) anchor scored ≤6, or a known-low (≤2) anchor scored ≥5,
 * fails calibration → the judge's real scores are discarded.
 */
export function calibrationOk(scored: { id: string; score: number }[]): boolean {
  const byId = new Map(CALIBRATION.map((c) => [c.id, c.expected]));
  for (const s of scored) {
    const expected = byId.get(s.id);
    if (expected === undefined) continue;
    if (expected >= 8 && s.score <= 6) return false;
    if (expected <= 2 && s.score >= 5) return false;
  }
  return true;
}
