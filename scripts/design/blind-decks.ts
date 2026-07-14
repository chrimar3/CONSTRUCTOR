// DESIGN-LOOP Round 0 — anti-drift deck builder. Copies the 8 canonical frames
// into 3 per-judge decks under NEUTRAL, per-judge-SHUFFLED ids (frame-a..h) so
// filenames can't whisper "board" or "after", and position effects wash out
// across the panel. Deterministic (fixed permutations, no RNG — workflows and
// resumes must be reproducible). Writes manifest.json (neutral→real) that the
// judges never receive; only the orchestrator uses it to de-shuffle scores.

import { copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

// real frame index (1..8) → descriptive id
const REAL: Record<number, string> = {
  1: "pin",
  2: "operator",
  3: "board",
  4: "sheet-lead",
  5: "sheet-viewing",
  6: "sheet-offer",
  7: "report-biweekly",
  8: "report-monthly",
};
const FILE: Record<number, string> = {
  1: "frame-1-pin",
  2: "frame-2-operator",
  3: "frame-3-board",
  4: "frame-4-sheet-lead",
  5: "frame-5-sheet-viewing",
  6: "frame-6-sheet-offer",
  7: "frame-7-report-biweekly",
  8: "frame-8-report-monthly",
};

// Fixed, distinct shuffles — neutral position (a..h) → real frame index.
const JUDGES = [
  { id: 1, persona: "field-operator pragmatist", order: [3, 1, 7, 5, 2, 8, 4, 6] },
  { id: 2, persona: "brand/typography critic", order: [6, 4, 2, 8, 1, 5, 3, 7] },
  { id: 3, persona: "builder-client", order: [8, 5, 1, 4, 7, 2, 6, 3] },
];

function main() {
  const manifest = JUDGES.map((j) => {
    const dir = join(OUT, "decks", `judge-${j.id}`);
    mkdirSync(dir, { recursive: true });
    const deck: Record<string, string> = {};
    j.order.forEach((real, i) => {
      const src = join(OUT, `${FILE[real]}.jpeg`);
      if (!existsSync(src)) throw new Error(`missing frame ${src} — run capture first`);
      const neutral = `frame-${LETTERS[i]}`;
      copyFileSync(src, join(dir, `${neutral}.jpeg`));
      deck[neutral] = REAL[real]!; // orchestrator-only mapping
    });
    return { id: j.id, persona: j.persona, dir, deck };
  });
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ judges: manifest }, null, 2));
  console.log(`prepared ${JUDGES.length} blind decks (8 frames each) → ${OUT}/decks`);
}

main();
