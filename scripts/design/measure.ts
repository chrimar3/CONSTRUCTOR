// IMPACT-LOOP — bridge CLI for the Workflow's MEASURE stage. Reads the raw judge
// returns ([{deck, result}]) the workflow collected, de-shuffles them (calibration
// gate + neutral→real median, via panel.ts), and writes panel.json — the subjective
// input impact-round.ts then turns into the honest benchmark + ledger.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deshuffle, type JudgeReturn } from "./panel";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const rawPath = process.argv[2] ?? join(OUT, "judges-raw.json");
const raw = JSON.parse(readFileSync(rawPath, "utf8")) as JudgeReturn[];

const scores = deshuffle(raw);
writeFileSync(join(OUT, "panel.json"), JSON.stringify({ perScreen: scores }, null, 2));
console.log(`panel.json written for ${Object.keys(scores).length} screens from ${raw.length} judges`);
