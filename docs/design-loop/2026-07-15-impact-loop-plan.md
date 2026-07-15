# IMPACT-LOOP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable dynamic Workflow that executes one IMPACT-LOOP round — MEASURE the honest benchmark → RANK candidate levers by ExpectedLift → RESEARCH-augment the top few → PROPOSE the single highest-leverage next lever — stopping with a recommendation for human-gated implementation.

**Architecture:** Deterministic, unit-tested TypeScript modules under `scripts/design/` do the math (objective scoring, honest capped composite, tier, lever ranking); a thin Bun CLI (`impact-round.ts`) chains them from the capture audit + a panel JSON; a Workflow script (`.claude/workflows/impact-loop.js`) orchestrates the agent-requiring stages (the blind ladder-anchored judge panel and the research augmentation) and calls the CLI via a measure agent. The score cannot drift because subjective panel scores are capped by objective, machine-measured reality.

**Tech Stack:** Bun (`bun test`, `bun:sqlite`, `Bun.serve`), TypeScript, `puppeteer-core` + system Chrome (devDependency, ADR-0035), the Workflow tool for the judge/research fan-out.

## Global Constraints

- Bun-native only; **zero new runtime dependencies** beyond `{react, react-dom, lucide-react}`. `puppeteer-core` is a **devDependency**, imported only by `scripts/design/*`, never `src/` (ADR-0035).
- All design tooling lives under `scripts/design/` (+ `scripts/design-gates.sh`, `.claude/workflows/`, `IMPACT-LOOP.md`, `docs/design-loop/`). Never `src/` or `tests/` (keeps commits out of the `TXXX:` state machine; commit-msg needs a `Co-Authored-By: Claude` trailer).
- Work on branch `design-loop/round-0`; **never commit directly to master** (guard-bash blocks it).
- Stage by explicit path; **never `git add -A`** (guard-bash blocks it).
- The harness seeds an **isolated fixture DB** (`artifacts/design/round-0/baseline.db`); it must NEVER open `constructor.db`.
- `scripts/verify-gates.sh`, `.claude/hooks/**`, `scripts/git-hooks/**`, `src/db/schema.sql`, `specs/**`, `.specify/**` are write-protected (guard-writes). Paths containing `/specs/` are blocked — plan/spec docs go in `docs/design-loop/`.
- Rubric weights (verbatim): hierarchy .20 · completeness .20 · warmth .15 · typography .15 · responsiveness .10 · ergonomics .10 · gravitas .10.
- One lever = one commit = one ADR = one attributable score move. Benchmark config (ALPHA, cap coefficients, thresholds) is YELLOW — ratified after the first calibrated run.
- `bun test` must stay green; run `bash scripts/verify-gates.sh` before any commit (pre-commit hook re-runs it).

---

## Task 1: «Πεύκο & Μέλι» tokens + pure gate checkers — DONE (committed, Round 0)

**Files:** `scripts/design/palette.ts`, `scripts/design/palette.test.ts`
- [x] Token spec + `contrastRatio`, `isOnPalette`, `isOnScale`, `honeyShare`, `normalizeHex`, `HONEY_MAX_SHARE`, `TYPE_SCALE`. 13 pins green. Committed in `1c7be9b`.

## Task 2: Impact-ranking engine — DONE (uncommitted)

**Files:** `scripts/design/impact-model.ts`, `scripts/design/impact-model.test.ts`
- [x] `WEIGHTS`, `expectedLift`, `rankLevers`, types `Dimension`/`Lever`/`ScreenScores`/`RankedLever`. `ExpectedLift = Σ weight·min(headroom, gain)`, `Priority = lift/effort`; palette-wide lever outranks a single-screen fix. 6 pins green.

## Task 3: Honest capped benchmark — DONE (uncommitted)

**Files:** `scripts/design/benchmark.ts`, `scripts/design/benchmark.test.ts`
- [x] `computeBenchmark`, `ALPHA`, cap functions (`capWarmth` = `3 + 6·share`, etc.), O/S split + drift flag. `score_d = α·O + (1−α)·min(S, cap)`. Cap binds (warmth 9→~1.5 at 0% palette); drift fires when S≫O. Pins green. Verified on real Round-0 data: 6.29 → 5.84 honest.

---

## Task 4: Objective-scorer test (code exists, add the pins)

**Files:**
- Modify: `scripts/design/objective.ts` (already written — `scoreFrame`, `scoreAudit`, `offPaletteColors`)
- Test: `scripts/design/objective.test.ts`

**Interfaces:**
- Consumes: `AuditFrame` (from capture), `palette.ts` checkers, `ObjectiveScreen` (from `benchmark.ts`).
- Produces: `scoreAudit(audits: AuditFrame[], tapOk?: boolean): Record<string, ObjectiveScreen>`; `offPaletteColors(audits): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { scoreFrame, scoreAudit, offPaletteColors, type AuditFrame } from "./objective";

const onBrand: AuditFrame = {
  frame: "board",
  paintedByColor: { "#14555a": 600, "#c89b3c": 30, "#ffffff": 370 }, // pine + honey + white
  usedColors: ["#14555a", "#c89b3c", "#ffffff"],
  fontSizes: [13, 15, 17],
  smallTargets: [],
  textPairs: [{ color: "#14555a", bg: "#ffffff", size: 15 }],
  interactiveCount: 4,
};
const offBrand: AuditFrame = {
  frame: "board",
  paintedByColor: { "#111827": 500, "#6b7280": 500 }, // tailwind grays
  usedColors: ["#111827", "#6b7280", "#1d4ed8"],
  fontSizes: [14, 18], // off-scale
  smallTargets: [{ tag: "button", w: 30, h: 30, label: "x" }],
  textPairs: [{ color: "#6b7280", bg: "#6b7280", size: 14 }], // fails AA
  interactiveCount: 4,
};

describe("scoreFrame — audit facts → ObjectiveScreen", () => {
  test("on-brand frame scores high on palette + type + honey", () => {
    const o = scoreFrame(onBrand);
    expect(o.palette_on_target_share).toBeCloseTo(1, 5); // all colors on-palette
    expect(o.type_scale_adherence).toBeCloseTo(1, 5);
    expect(o.honey_correct).toBe(true); // honey present, ≤5%... precondition:
    expect(30 / 1000).toBeLessThanOrEqual(0.05);
    expect(o.touch_ok_share).toBeCloseTo(1, 5);
  });
  test("off-brand frame scores low + flags small targets + failing contrast", () => {
    const o = scoreFrame(offBrand);
    expect(o.palette_on_target_share).toBeCloseTo(0, 5); // tailwind grays off-palette
    expect(o.type_scale_adherence).toBeCloseTo(0, 5); // 14,18 off-scale
    expect(o.contrast_pass_rate).toBeCloseTo(0, 5); // grey-on-grey fails
    expect(o.touch_ok_share).toBeCloseTo(0.75, 5); // 1 of 4 interactive too small
    expect(o.honey_correct).toBe(false); // board needs honey, none present
  });
});

describe("offPaletteColors — distinct off-palette used across frames", () => {
  test("collects the tailwind colors, not the on-palette ones", () => {
    const cs = offPaletteColors([onBrand, offBrand]);
    expect(cs).toContain("#111827");
    expect(cs).toContain("#1d4ed8");
    expect(cs).not.toContain("#14555a");
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes** — `bun test scripts/design/objective.test.ts`. If `scoreFrame` logic diverges from these facts, fix `objective.ts` (not the test). Expected end state: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/design/objective.ts scripts/design/objective.test.ts
git commit -m "$(printf 'IMPACT-LOOP: objective-scorer (audit facts -> ObjectiveScreen) + pins\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

## Task 5: Tier determination

**Files:**
- Create: `scripts/design/tier.ts`
- Test: `scripts/design/tier.test.ts`

**Interfaces:**
- Consumes: a `Benchmark` (from `benchmark.ts`) and the aggregate objective facts (off-palette count, any-off-scale, contrast pass, honey correctness, all-gates-pass boolean).
- Produces: `tierFor(input: TierInput): { tier: "T0"|"T1"|"T2"|"T3"; label: string; nextGate: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { tierFor } from "./tier";

describe("tierFor — T0..T3 with hard objective gates (spec §3)", () => {
  test("baseline generic app is T0", () => {
    expect(tierFor({ overall: 5.84, minScreen: 4.8, offPaletteShare: 0.78, anyOffScale: true,
      contrastPass: 0.85, honeyCorrect: false, allGatesPass: false }).tier).toBe("T0");
  });
  test("coherent (off-palette < 40%, no off-scale, overall ≥ 6.5) is T1", () => {
    expect(tierFor({ overall: 6.7, minScreen: 6.0, offPaletteShare: 0.30, anyOffScale: false,
      contrastPass: 0.95, honeyCorrect: false, allGatesPass: false }).tier).toBe("T1");
  });
  test("branded (palette ≥ 90%, honey ok, AA, overall ≥ 7.5, min ≥ 6.5) is T2", () => {
    expect(tierFor({ overall: 7.6, minScreen: 6.6, offPaletteShare: 0.08, anyOffScale: false,
      contrastPass: 1, honeyCorrect: true, allGatesPass: false }).tier).toBe("T2");
  });
  test("reference-grade needs ALL gates pass + overall ≥ 8.5 + min ≥ 7.5", () => {
    expect(tierFor({ overall: 8.6, minScreen: 7.6, offPaletteShare: 0, anyOffScale: false,
      contrastPass: 1, honeyCorrect: true, allGatesPass: true }).tier).toBe("T3");
  });
});
```

- [ ] **Step 2: Run — verify fail (module missing)** — `bun test scripts/design/tier.test.ts` → FAIL.

- [ ] **Step 3: Implement `scripts/design/tier.ts`**

```ts
export interface TierInput {
  overall: number; minScreen: number; offPaletteShare: number; anyOffScale: boolean;
  contrastPass: number; honeyCorrect: boolean; allGatesPass: boolean;
}
export function tierFor(i: TierInput): { tier: "T0"|"T1"|"T2"|"T3"; label: string; nextGate: string } {
  if (i.allGatesPass && i.overall >= 8.5 && i.minScreen >= 7.5)
    return { tier: "T3", label: "Reference-grade", nextGate: "— (exit)" };
  if (i.offPaletteShare <= 0.10 && i.honeyCorrect && i.contrastPass >= 1 && i.overall >= 7.5 && i.minScreen >= 6.5)
    return { tier: "T2", label: "Branded", nextGate: "all objective gates PASS · overall ≥ 8.5 · no screen < 7.5" };
  if (i.offPaletteShare < 0.40 && !i.anyOffScale && i.overall >= 6.5)
    return { tier: "T1", label: "Coherent", nextGate: "palette ≥ 90% · honey correct · AA everywhere · overall ≥ 7.5" };
  return { tier: "T0", label: "Functional", nextGate: "off-palette < 40% · 0 off-scale type · overall ≥ 6.5" };
}
```

- [ ] **Step 4: Run — verify pass**, then commit `scripts/design/tier.ts` + test with the `Co-Authored-By` trailer.

## Task 6: Deterministic round CLI (`impact-round.ts`)

**Files:**
- Create: `scripts/design/impact-round.ts`
- (No unit test — it is glue over already-pinned modules; verified by running on real data in Step 3.)

**Interfaces:**
- Consumes: `scoreAudit`/`offPaletteColors` (Task 4), `computeBenchmark` (Task 3), `rankLevers` (Task 2), `SEED_LEVERS` (`levers.ts`), `tierFor` (Task 5). Reads `$DESIGN_OUT/audit.json` and a panel JSON (`{ perScreen: { screen: { dim: score } } }`) from `argv[2]` (default `$DESIGN_OUT/panel.json`).
- Produces: writes `$DESIGN_OUT/benchmark.json` and `$DESIGN_OUT/ledger.json`; prints a summary. `ledger.json` shape: `{ tier, overall, drift, driftFlagged, ranked: RankedLever[], recommendation: RankedLever, offPalette: string[] }`.

- [ ] **Step 1: Implement the CLI**

```ts
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
const scores: ScreenScores = Object.fromEntries(Object.entries(bench.perScreen).map(([k, v]) => [k, v.dims]));
const ranked = rankLevers(SEED_LEVERS, scores, { ceiling: CEILING });

// aggregate objective facts for the tier gate
const shares = Object.values(O).map((o) => o.palette_on_target_share);
const offPaletteShare = 1 - shares.reduce((a, b) => a + b, 0) / (shares.length || 1);
const anyOffScale = audits.some((f) => f.fontSizes.some((s) => !isOnScale(s)));
const contrastPass = Object.values(O).reduce((a, o) => a + o.contrast_pass_rate, 0) / Object.keys(O).length;
const honeyCorrect = Object.values(O).every((o) => o.honey_correct);
const allGatesPass = offPaletteShare === 0 && !anyOffScale && contrastPass >= 1 && honeyCorrect;
const tier = tierFor({ overall: bench.overall, minScreen: bench.minScreen.composite, offPaletteShare,
  anyOffScale, contrastPass, honeyCorrect, allGatesPass });

const ledger = { tier, overall: bench.overall, minScreen: bench.minScreen, drift: bench.overallDrift,
  driftFlagged: bench.driftFlagged, ranked, recommendation: ranked[0], offPalette: offPaletteColors(audits) };
writeFileSync(join(OUT, "benchmark.json"), JSON.stringify(bench, null, 2));
writeFileSync(join(OUT, "ledger.json"), JSON.stringify(ledger, null, 2));

console.log(`tier ${tier.tier} (${tier.label}) · honest overall ${bench.overall}/10 · drift ${bench.overallDrift}${bench.driftFlagged ? " ⚠" : ""}`);
console.log(`next gate: ${tier.nextGate}`);
console.log(`\nimpact-ranked levers (ExpectedLift / priority):`);
for (const r of ranked) console.log(`  ${r.expectedLift.toFixed(2)} / ${r.priority.toFixed(2)}  [${r.lever.zone}] ${r.lever.title}`);
console.log(`\n▶ RECOMMENDED: ${ranked[0].lever.title} (${ranked[0].lever.zone}, effort ${ranked[0].lever.effort})`);
```

- [ ] **Step 2: Seed a panel JSON from the existing Round-0 scores** (so the CLI is runnable before panel v2 exists):

```bash
cd "/Users/chrism/Project with Claude/CONSTRUCTOR"
bun -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync("artifacts/design/round-0/baseline-report.json","utf8"));const perScreen={};for(const f of b.panel.perFrame)perScreen[f.frame]=f.dims;fs.writeFileSync("artifacts/design/round-0/panel.json",JSON.stringify({perScreen},null,2))'
```

- [ ] **Step 3: Run it and verify honest output**

Run: `set -a && source .env && set +a && bun scripts/design/capture.ts >/dev/null && bun scripts/design/impact-round.ts`
Expected: `tier T0 (Functional) · honest overall ~5.8/10`, and the ranked list with **`tokens-pinemeli` first** (highest ExpectedLift × across all screens).

- [ ] **Step 4: Commit** `scripts/design/impact-round.ts` + `scripts/design/levers.ts` with the trailer.

## Task 7: Reference ladder (calibration anchors)

**Files:**
- Create: `scripts/design/reference-ladder/ladder.ts` (cited textual descriptors for levels 2/5/8/10 of a mobile CRM screen + a `CALIBRATION` set the judges must score first)
- Test: `scripts/design/reference-ladder/ladder.test.ts`

**Interfaces:**
- Produces: `LADDER: { level: 2|5|8|10; descriptor: string; source: string }[]`; `CALIBRATION: { id: string; expected: number; descriptor: string }[]`; `calibrationOk(scored: {id,score}[]): boolean` (a judge who rates the known-8 ≤6 or known-2 ≥5 fails).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { LADDER, CALIBRATION, calibrationOk } from "./ladder";

describe("reference ladder", () => {
  test("four anchored levels with cited sources", () => {
    expect(LADDER.map((l) => l.level)).toEqual([2, 5, 8, 10]);
    for (const l of LADDER) expect(l.source.length).toBeGreaterThan(0);
  });
  test("calibrationOk discards a miscalibrated judge", () => {
    const good = CALIBRATION.map((c) => ({ id: c.id, score: c.expected }));
    expect(calibrationOk(good)).toBe(true);
    const bad = CALIBRATION.map((c) => ({ id: c.id, score: c.expected >= 8 ? 5 : c.expected }));
    expect(calibrationOk(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to fail. Step 3: Implement `ladder.ts`** — descriptors researched from real best-in-class mobile CRM/product surfaces (Linear, Attio, Superhuman, Pipedrive deal cards); each `source` a short citation string. `calibrationOk`: return false if any known-≥8 anchor scored ≤6 or any known-≤2 anchor scored ≥5. **Step 4:** run to pass, commit with trailer.

- [ ] **Step 5 (research):** before writing descriptors, run a research pass (WebSearch/WebFetch or a research subagent) to ground each level's descriptor in real, cited exemplars. Record sources inline. (Image sourcing is optional/licensing-permitting; descriptors are the floor per spec §9.)

## Task 8: Panel v2 prompt + de-shuffle helpers

**Files:**
- Create: `scripts/design/panel.ts`
- Test: `scripts/design/panel.test.ts`

**Interfaces:**
- Consumes: `LADDER`/`CALIBRATION` (Task 7), the neutral-deck manifest (from `blind-decks.ts`).
- Produces: `judgePrompt(persona: string, imagePaths: Record<string,string>): string` (embeds the verbatim rubric + the ladder descriptors + the calibration instruction + anti-drift "open nothing else"); `JUDGE_SCHEMA` (structured output incl. a `calibration` block + per-frame 7 dims); `deshuffle(judges: {deck, result}[]): ScreenScores` (neutral→real, median per dimension, dropping judges that fail `calibrationOk`).

- [ ] **Step 1: Write the failing test** for `deshuffle` (median across judges, calibration-gated):

```ts
import { describe, expect, test } from "bun:test";
import { deshuffle } from "./panel";

test("deshuffle maps neutral→real and medians, dropping miscalibrated judges", () => {
  const mk = (warmth: number, calOk: boolean) => ({
    deck: { "frame-a": "board" },
    result: {
      calibration: calOk ? [{ id: "hi", score: 8 }, { id: "lo", score: 2 }] : [{ id: "hi", score: 4 }, { id: "lo", score: 2 }],
      frames: [{ frame: "frame-a", hierarchy: 7, completeness: 7, warmth, typography: 7, responsiveness: 7, ergonomics: 7, gravitas: 7 }],
    },
  });
  const scores = deshuffle([mk(8, true), mk(6, true), mk(2, false)]); // third dropped
  expect(scores.board.warmth).toBe(7); // median of {8,6}
});
```

- [ ] **Step 2: fail → Step 3: implement `panel.ts`** (`judgePrompt` extends the Round-0 workflow prompt with the ladder + calibration; `deshuffle` filters via `calibrationOk`, maps neutral→real, medians per dimension). **Step 4:** pass, commit with trailer.

## Task 9: The dynamic Workflow (`impact-loop.js`)

**Files:**
- Create: `.claude/workflows/impact-loop.js`
- (Verified by running — Task 12.)

**Interfaces:**
- Consumes: `panel.ts` prompt/schema/deshuffle (Task 8), `blind-decks.ts` decks, the `impact-round.ts` CLI (Task 6).
- Produces: a Workflow that returns `{ tier, honestOverall, drift, recommendation, ledger }`.

- [ ] **Step 1: Write the workflow** (structure — full code written at implementation time, following the Round-0 judge workflow as the template):

```js
export const meta = {
  name: 'impact-loop-round',
  description: 'One IMPACT-LOOP round: blind ladder-anchored panel → honest benchmark → impact-ranked levers → recommended next lever',
  phases: [{ title: 'Judge' }, { title: 'Measure' }, { title: 'Research' }],
}
// 1) JUDGE: parallel 3 ladder-anchored, calibration-gated judges over neutral shuffled decks.
// 2) MEASURE: one agent writes panel.json from the deshuffled medians, runs
//    `bun scripts/design/impact-round.ts`, returns benchmark + ledger JSON.
// 3) RESEARCH: one agent reads the top-3 ledger levers, validates/augments the gain
//    estimates against best practice, returns a possibly-reordered top list.
// 4) return { tier, honestOverall, drift, recommendation, ledger } (proposal only —
//    lever implementation is a separate human-gated round).
```

- [ ] **Step 2: Ensure the deck + capture prerequisites exist** — the workflow assumes `bash scripts/design-gates.sh` + `bun scripts/design/blind-decks.ts` have produced fresh frames + neutral decks; the MEASURE agent runs capture if `audit.json` is stale.

- [ ] **Step 3: Dry-run the JS parses** (syntax) by launching the Workflow (Task 12).

## Task 10: Operational doc `IMPACT-LOOP.md`

**Files:**
- Create: `IMPACT-LOOP.md` (repo root)
- Modify: `DESIGN-LOOP.md` — add a one-line pointer at the top noting the LOOP section is superseded by `IMPACT-LOOP.md` (retain its rubric + anti-drift).

- [ ] **Step 1:** Write `IMPACT-LOOP.md` from spec §2–§6: the honest benchmark (O-caps-S + ladder + calibration + drift split), the tier ladder, the loop steps (MEASURE→ENUMERATE→RANK→RESEARCH→IMPLEMENT→VERIFY→CHECKPOINT→PLATEAU), the run commands (`bash scripts/design-gates.sh`; Workflow `impact-loop`), and the ZONING gating for RED levers. Keep `DESIGN-LOOP.md`'s rubric (Benchmarks B) + anti-drift referenced verbatim.
- [ ] **Step 2:** Add the pointer note atop `DESIGN-LOOP.md`. **Step 3:** commit both with the trailer.

## Task 11: Ledger/round artifact

**Files:**
- Create: `scripts/design/build-ledger-artifact.ts` (or extend `build-artifact.ts`)

- [ ] **Step 1:** Emit a self-contained HTML artifact from `ledger.json` + `benchmark.json`: the honest composite vs the raw panel (drift made visible), the O/S split per screen, the tier + next gate, and the impact-ranked lever backlog with the recommendation highlighted. Reuse the Round-0 artifact's «Πεύκο & Μέλι» styling. **Step 2:** run, publish via the Artifact tool, commit the builder with the trailer.

## Task 12: Run Round 1 (execute the loop once)

- [ ] **Step 1:** `bash scripts/design-gates.sh` (fresh capture + mechanical gates) → `bun scripts/design/blind-decks.ts`.
- [ ] **Step 2:** Launch the `impact-loop` Workflow. Expected: a proposal — tier **T0**, honest overall **~5.8**, recommendation **`tokens-pinemeli`** (the «Πεύκο & Μέλι» token layer), with the impact-ranked backlog behind it.
- [ ] **Step 3:** Build + publish the ledger artifact (Task 11). Present the recommendation to Christos for the human-gated go on implementing the top lever (which becomes its own TDD/ZONING/ADR round). **Do NOT auto-implement the lever** — that is the next, separately-approved round.

---

## Self-Review

- **Spec coverage:** §2 honest benchmark → Tasks 3,4,7,8; §3 tiers → Task 5; §4 loop → Tasks 2,6,9,12; §5 components → Tasks 6,8,9,10,11; §6 scope/rails → Global Constraints + Task 12 (RED-lever gating). Reference ladder (§2.1) → Task 7. Drift split (§2.3) → Tasks 3,11. All covered.
- **Placeholder scan:** the workflow (Task 9) and doc (Task 10) describe structure with the Round-0 workflow as the concrete template rather than inlining ~200 lines; every unit-testable module (Tasks 4,5,6,7,8) has complete code/tests. Acceptable — the agent-orchestration code is verified by running (Task 12), not unit tests.
- **Type consistency:** `ScreenScores` (impact-model) = `Record<string, Record<Dimension, number>>` used consistently in benchmark, impact-round, panel. `ObjectiveScreen` (benchmark) produced by `scoreAudit` (objective) — matches. `Lever`/`RankedLever` (impact-model) used by levers + impact-round + ledger. Consistent.
