// IMPACT-LOOP — panel v2 (spec §2.2). Builds the ladder-anchored, calibration-
// gated judge prompt + structured schema, and de-shuffles raw judge outputs into
// the subjective ScreenScores the honest benchmark consumes — dropping any judge
// who fails the calibration gate before taking the median. Extends the Round-0
// blind panel (neutral shuffled decks, disjoint personas, verbatim rubric).

import { LADDER, CALIBRATION, calibrationOk } from "./reference-ladder/ladder";
import { WEIGHTS, type Dimension, type ScreenScores } from "./impact-model";

const DIMS = Object.keys(WEIGHTS) as Dimension[];
const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

const DIM_DESC: Record<Dimension, string> = {
  hierarchy: "Visual hierarchy — the eye lands on next-action → € figure → urgency, in that order, unprompted",
  completeness: "Information completeness — the card answers who/where/what/when/how-much without a tap",
  warmth: "Warmth & brand coherence — reads 'elegant Greek office', not 'generic SaaS'; palette discipline felt",
  typography: "Typography craft — scale rhythm, Greek text sits beautifully, money reads as data",
  responsiveness: "Perceived responsiveness — state changes visible and instant; the save moment lands",
  ergonomics: "Capture ergonomics — sheets feel one-handed; selected states unmistakable in sunlight",
  gravitas: "Report gravitas — a builder would forward it to a partner without embarrassment",
};

/** Structured output the workflow forces each judge to return. */
export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    calibration: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, score: { type: "integer" } },
        required: ["id", "score"],
      },
    },
    frames: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          frame: { type: "string" },
          hierarchy: { type: "integer" },
          completeness: { type: "integer" },
          warmth: { type: "integer" },
          typography: { type: "integer" },
          responsiveness: { type: "integer" },
          ergonomics: { type: "integer" },
          gravitas: { type: "integer" },
          note: { type: "string" },
        },
        required: ["frame", ...DIMS, "note"],
      },
    },
  },
  required: ["calibration", "frames"],
} as const;

/** Ladder-anchored, calibration-gated, anti-drift judge prompt. */
export function judgePrompt(persona: string, imagePaths: Record<string, string>): string {
  const ladder = LADDER.map((l) => `  - Level ${l.level}: ${l.descriptor} (${l.source})`).join("\n");
  const rubric = DIMS.map((d) => `  - ${d} (${Math.round(WEIGHTS[d] * 100)}%): ${DIM_DESC[d]}`).join("\n");
  const cal = CALIBRATION.map((c) => `  - ${c.id} (this describes a level-${c.expected} screen): ${c.descriptor}`).join("\n");
  const frames = LETTERS.filter((L) => imagePaths[`frame-${L}`])
    .map((L) => `  frame-${L}: ${imagePaths[`frame-${L}`]}`)
    .join("\n");

  return `You are an independent design judge. Your assigned lens: **${persona}**. Apply the SAME rubric below through that lens.

You are scoring mobile-phone screenshots (390×844) of a Greek real-estate sales CRM. Open ONLY the image files named below with the Read tool — nothing else. Do NOT read any repository file, git history, or notes. You do not know whether this is a "before" or "after".

STEP 1 — CALIBRATE. First, internalize this reference ladder of what each score LEVEL looks like on a real product screen:
${ladder}

Then score each calibration anchor from 1–10 for how good the DESCRIBED screen is (this checks your scale is aligned — a level-8 description must score ~8, a level-2 ~2):
${cal}
Return these as the "calibration" array ({id, score}).

STEP 2 — SCORE THE DECK. Open and score each frame 1–10 (integer) on the 7 dimensions, ANCHORED to the ladder (8 = a polished shippable commercial product screen; 10 = reference-grade; 5 = functional but generic; 2 = unstyled). Keep 10 expensive.
${rubric}

Frames to open (score EACH, keep the exact id):
${frames}

Return one object per frame in "frames" (all with the 7 integer scores + a one-line note), plus the "calibration" array. Your entire output is the structured object — no prose outside it.`;
}

// ── De-shuffle + calibration gate ──

export interface JudgeResult {
  calibration: { id: string; score: number }[];
  frames: (Record<Dimension, number> & { frame: string; note?: string })[];
}
export interface JudgeReturn {
  deck: Record<string, string>; // neutral id → real screen
  result: JudgeResult;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Map every valid judge's neutral-id scores back to real screens and take the
 * median per (screen, dimension). Judges failing the calibration gate are dropped.
 */
export function deshuffle(judges: JudgeReturn[]): ScreenScores {
  const valid = judges.filter((j) => calibrationOk(j.result.calibration));
  const bucket: Record<string, Record<Dimension, number[]>> = {};
  for (const j of valid) {
    for (const fr of j.result.frames) {
      const real = j.deck[fr.frame];
      if (!real) continue;
      bucket[real] = bucket[real] ?? ({} as Record<Dimension, number[]>);
      for (const d of DIMS) {
        if (typeof fr[d] === "number") (bucket[real][d] = bucket[real][d] ?? []).push(fr[d]);
      }
    }
  }
  const out: ScreenScores = {};
  for (const [screen, dims] of Object.entries(bucket)) {
    out[screen] = {} as Record<Dimension, number>;
    for (const d of DIMS) out[screen][d] = dims[d]?.length ? median(dims[d]) : 0;
  }
  return out;
}
