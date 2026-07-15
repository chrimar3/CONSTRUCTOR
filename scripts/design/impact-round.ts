// IMPACT-LOOP — deterministic round CLI (spec §4). Chains the already-pinned
// modules: capture audit + panel scores → objective facts → honest capped
// benchmark → tier → impact-ranked lever backlog. Writes benchmark.json +
// ledger.json and prints the ranked proposal. The Workflow's MEASURE agent calls
// this after the blind panel produces panel.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreAudit, offPaletteColors, type AuditFrame } from "./objective";
import { computeBenchmark } from "./benchmark";
import { rankLevers, type ScreenScores } from "./impact-model";
import { SEED_LEVERS } from "./levers";
import { tierFor } from "./tier";
import { isOnScale } from "./palette";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const CEILING = Number(process.env.DESIGN_CEILING ?? 9);

const audits = JSON.parse(readFileSync(join(OUT, "audit.json"), "utf8")) as AuditFrame[];
const panelPath = process.argv[2] ?? join(OUT, "panel.json");
const S = JSON.parse(readFileSync(panelPath, "utf8")).perScreen as ScreenScores;

const O = scoreAudit(audits, true);
const bench = computeBenchmark(O, S);
const scores: ScreenScores = Object.fromEntries(
  Object.entries(bench.perScreen).map(([k, v]) => [k, v.dims]),
);
const ranked = rankLevers(SEED_LEVERS, scores, { ceiling: CEILING });

// aggregate objective facts for the tier gate
const shares = Object.values(O).map((o) => o.palette_on_target_share);
const offPaletteShare = 1 - shares.reduce((a, b) => a + b, 0) / (shares.length || 1);
const anyOffScale = audits.some((f) => f.fontSizes.some((s) => !isOnScale(s)));
const contrastPass =
  Object.values(O).reduce((a, o) => a + o.contrast_pass_rate, 0) / (Object.keys(O).length || 1);
const honeyCorrect = Object.values(O).every((o) => o.honey_correct);
const allGatesPass = offPaletteShare === 0 && !anyOffScale && contrastPass >= 1 && honeyCorrect;
const tier = tierFor({
  overall: bench.overall,
  minScreen: bench.minScreen.composite,
  offPaletteShare,
  anyOffScale,
  contrastPass,
  honeyCorrect,
  allGatesPass,
});

const ledger = {
  tier,
  overall: bench.overall,
  minScreen: bench.minScreen,
  drift: bench.overallDrift,
  driftFlagged: bench.driftFlagged,
  objective: { offPaletteShare: Math.round(offPaletteShare * 1000) / 1000, anyOffScale, contrastPass: Math.round(contrastPass * 1000) / 1000, honeyCorrect },
  ranked,
  recommendation: ranked[0],
  offPalette: offPaletteColors(audits),
};
writeFileSync(join(OUT, "benchmark.json"), JSON.stringify(bench, null, 2));
writeFileSync(join(OUT, "ledger.json"), JSON.stringify(ledger, null, 2));

console.log(
  `tier ${tier.tier} (${tier.label}) · honest overall ${bench.overall}/10 · min ${bench.minScreen.composite} (${bench.minScreen.screen}) · drift ${bench.overallDrift}${bench.driftFlagged ? " ⚠" : ""}`,
);
console.log(`next gate: ${tier.nextGate}`);
console.log(`\nimpact-ranked levers  (ExpectedLift / priority):`);
for (const r of ranked)
  console.log(`  ${r.expectedLift.toFixed(2)} / ${r.priority.toFixed(2)}  [${r.lever.zone}]  ${r.lever.title}`);
console.log(`\n▶ RECOMMENDED: ${ranked[0].lever.title}  (${ranked[0].lever.zone}, effort ${ranked[0].lever.effort})`);
