// IMPACT-LOOP — bridge CLI for the Workflow's PREP stage. The workflow sandbox
// can't import TS, so this emits the three ladder-anchored judge prompts (built
// from panel.ts, DRY) + their neutral→real decks as JSON on stdout. Assumes the
// capture frames + blind decks already exist (the workflow runs capture +
// blind-decks.ts first). The workflow spawns one judge agent per prompt.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { judgePrompt } from "./panel";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as {
  judges: { id: number; persona: string; deck: Record<string, string> }[];
};

const judges = manifest.judges.map((j) => {
  const images: Record<string, string> = {};
  for (const neutral of Object.keys(j.deck)) {
    images[neutral] = resolve(OUT, "decks", `judge-${j.id}`, `${neutral}.jpeg`);
  }
  return {
    id: j.id,
    persona: j.persona,
    deckJson: JSON.stringify(j.deck),
    prompt: judgePrompt(j.persona, images),
  };
});

console.log(JSON.stringify({ judges }));
