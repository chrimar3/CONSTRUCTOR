export const meta = {
  name: 'impact-loop',
  description: 'One IMPACT-LOOP round: blind ladder-anchored + calibration-gated panel → honest capped benchmark → impact-ranked levers → research-validated recommendation. PROPOSAL only — implementing the recommended lever is a separate human-gated round.',
  whenToUse: 'Run to measure Constructor design quality honestly and get the single highest-leverage next lever. See IMPACT-LOOP.md.',
  phases: [
    { title: 'Prep', detail: 'capture frames + blind decks + emit judge prompts' },
    { title: 'Judge', detail: '3 blind ladder-anchored calibration-gated judges' },
    { title: 'Measure', detail: 'de-shuffle → honest benchmark → impact ledger' },
    { title: 'Research', detail: 'validate the top levers against best practice' },
  ],
}

// The judge structured-output schema (mirrors scripts/design/panel.ts JUDGE_SCHEMA;
// the workflow sandbox cannot import TS, so it is declared here as data).
const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    calibration: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, score: { type: 'integer' } }, required: ['id', 'score'] } },
    frames: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        frame: { type: 'string' }, hierarchy: { type: 'integer' }, completeness: { type: 'integer' },
        warmth: { type: 'integer' }, typography: { type: 'integer' }, responsiveness: { type: 'integer' },
        ergonomics: { type: 'integer' }, gravitas: { type: 'integer' }, note: { type: 'string' },
      },
      required: ['frame', 'hierarchy', 'completeness', 'warmth', 'typography', 'responsiveness', 'ergonomics', 'gravitas', 'note'] } },
  },
  required: ['calibration', 'frames'],
}

const PREP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { judges: { type: 'array', items: { type: 'object', additionalProperties: false,
    properties: { id: { type: 'integer' }, persona: { type: 'string' }, prompt: { type: 'string' }, deckJson: { type: 'string' } },
    required: ['id', 'persona', 'prompt', 'deckJson'] } } },
  required: ['judges'],
}

const LEDGER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { ledgerJson: { type: 'string' }, note: { type: 'string' } },
  required: ['ledgerJson'],
}

const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    validated: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, title: { type: 'string' }, gainVerdict: { type: 'string' }, note: { type: 'string' } },
      required: ['id', 'title', 'gainVerdict', 'note'] } },
    recommendedId: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['validated', 'recommendedId', 'rationale'],
}

// ── Prep: refresh capture + decks, emit the 3 judge prompts ──
phase('Prep')
const prep = await agent(
  `You are preparing an IMPACT-LOOP measurement round for the Constructor project (cwd is the repo root: "/Users/chrism/Project with Claude/CONSTRUCTOR").
Run these commands in order (bash), then return the emit-panel JSON:
  1) set -a; source .env; set +a
  2) bun scripts/design/capture.ts        # refresh the 8 frames on the seeded fixture
  3) bun scripts/design/blind-decks.ts    # neutral shuffled decks
  4) bun scripts/design/emit-panel.ts     # prints {"judges":[...]} on stdout
Return EXACTLY the parsed object emit-panel printed (its "judges" array — each item has id, persona, prompt, deckJson). Do not summarize or alter the prompts.`,
  { label: 'prep:capture+decks+prompts', phase: 'Prep', schema: PREP_SCHEMA },
)

const judges = (prep && prep.judges) || []
if (judges.length === 0) {
  log('prep failed — no judge prompts emitted; aborting round')
  return { error: 'prep failed', prep }
}

// ── Judge: 3 blind, ladder-anchored, calibration-gated panels in parallel ──
phase('Judge')
const rawJudges = await parallel(
  judges.map((j) => () =>
    agent(j.prompt, { label: `judge-${j.id}:${j.persona}`, phase: 'Judge', agentType: 'general-purpose', schema: JUDGE_SCHEMA })
      .then((result) => (result ? { deckJson: j.deckJson, result } : null)),
  ),
)
const good = rawJudges.filter(Boolean)
log(`panel: ${good.length}/${judges.length} judges returned scores`)
if (good.length === 0) return { error: 'no judges returned scores' }

// Reshape to [{deck, result}] for measure.ts (deck parsed from deckJson).
const judgesRaw = good.map((g) => ({ deck: JSON.parse(g.deckJson), result: g.result }))

// ── Measure: de-shuffle (calibration gate) → honest benchmark → impact ledger ──
phase('Measure')
const measure = await agent(
  `You are computing the honest benchmark + impact ledger for the Constructor IMPACT-LOOP (cwd = repo root).
STEP 1 — write this EXACT JSON (the raw judge returns) to artifacts/design/round-0/judges-raw.json:
${JSON.stringify(judgesRaw)}
STEP 2 — run, in bash from the repo root:
  set -a; source .env; set +a
  bun scripts/design/measure.ts          # de-shuffles (calibration gate) → panel.json
  bun scripts/design/impact-round.ts     # → benchmark.json + ledger.json, prints the ranked proposal
STEP 3 — return the FULL contents of artifacts/design/round-0/ledger.json verbatim as "ledgerJson" (a JSON string). Do not edit it.`,
  { label: 'measure:benchmark+ledger', phase: 'Measure', schema: LEDGER_SCHEMA },
)

let ledger = null
try { ledger = JSON.parse(measure.ledgerJson) } catch (e) { return { error: 'could not parse ledger', measure } }
const top = (ledger.ranked || []).slice(0, 3)
log(`tier ${ledger.tier?.tier} · honest overall ${ledger.overall} · drift ${ledger.drift}${ledger.driftFlagged ? ' ⚠' : ''} · top lever: ${ledger.recommendation?.lever?.title}`)

// ── Research: validate the top levers' gain estimates against best practice ──
phase('Research')
const research = await agent(
  `You are a design-research critic validating the impact model's top candidate levers for a Greek real-estate sales CRM pursuing the «Πεύκο & Μέλι» direction (deep Aegean-pine + a single honey accent, Commissioner/Literata type, 4pt grid). The honest benchmark is at tier ${ledger.tier?.tier} (${ledger.tier?.label}), overall ${ledger.overall}/10, weakest screen ${ledger.minScreen?.screen} (${ledger.minScreen?.composite}).
Here are the top impact-ranked levers (ExpectedLift = Σ rubric-weight · min(headroom, estimated gain)):
${top.map((r, i) => `${i + 1}. [${r.lever.zone}] ${r.lever.title} — ExpectedLift ${r.expectedLift}, priority ${r.priority}, effort ${r.lever.effort}. Rationale: ${r.lever.note || ''}`).join('\n')}
For EACH, judge whether its estimated gain is realistic (over/under/realistic) given best practice, and whether the ranking should change. You MAY do brief web research if genuinely uncertain. Then name the single lever you'd implement first and why. Do NOT implement anything — this is validation only.`,
  { label: 'research:validate-top-levers', phase: 'Research', agentType: 'general-purpose', schema: RESEARCH_SCHEMA },
)

return {
  tier: ledger.tier,
  honestOverall: ledger.overall,
  minScreen: ledger.minScreen,
  drift: ledger.drift,
  driftFlagged: ledger.driftFlagged,
  objective: ledger.objective,
  judgesValid: good.length,
  ranked: (ledger.ranked || []).map((r) => ({ title: r.lever.title, zone: r.lever.zone, expectedLift: r.expectedLift, priority: r.priority, effort: r.lever.effort })),
  modelRecommendation: ledger.recommendation?.lever?.title,
  research,
}
