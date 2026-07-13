export const meta = {
  name: 'constructor-rebuild',
  description: 'Full agentic rebuild T001-T020: one specialist agent per task, TDD, skills-armed, one commit each, halt on RED. Run one phase per invocation: args {phase: 0|1|2|3}.',
  whenToUse: 'Invoked per-phase by the driver session per REBUILD-RUNBOOK.md. Never run a later phase before the earlier phase\'s CHECKPOINT was human-approved.',
}

const DIR = '/Users/chrism/Project with Claude/CONSTRUCTOR'

const RESULT = {
  type: 'object',
  required: ['task', 'status', 'commit', 'testsPass', 'summary'],
  properties: {
    task: { type: 'string' },
    status: { type: 'string', enum: ['done', 'blocked'] },
    commit: { type: 'string', description: 'short SHA of the task commit, or empty if blocked' },
    testsPass: { type: 'boolean', description: 'full bun test suite green at commit time' },
    summary: { type: 'string', description: '2-4 sentences: what was built, key choices' },
    yellowADRs: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string', description: 'if blocked: the RED-zone question or failure, verbatim' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'testCounts', 'commitsOk', 'articleGates', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    testCounts: { type: 'string' },
    commitsOk: { type: 'boolean' },
    articleGates: { type: 'string', description: 'one line per gate checked: command run + result' },
    issues: { type: 'array', items: { type: 'string' } },
  },
}

const COMMON = `
You are one specialist in a sequential pipeline rebuilding the Constructor prototype. Work ONLY in: ${DIR}

MANDATORY BOOTSTRAP (in order, before any work):
1. Read ${DIR}/CLAUDE.md and ${DIR}/.specify/memory/constitution.md (BINDING - 10 Articles).
2. Read ${DIR}/specs/001-sales-pipeline-mvp/data-model.md and find YOUR task in specs/001-sales-pipeline-mvp/tasks.md.
3. ARM YOURSELF - these installed, audited skills are part of your operating procedure (provenance: .claude/skills/THIRD-PARTY-SKILLS.md):
   - READ ${DIR}/.claude/skills/test-driven-development/SKILL.md NOW, before your first test. Its Iron Law governs you: no production code without a failing test first; watch it fail for the RIGHT reason. Before adding any mock/test helper, read its testing-anti-patterns.md.
   - If ANY test fails unexpectedly at ANY point: STOP, read ${DIR}/.claude/skills/systematic-debugging/SKILL.md, find root cause BEFORE any fix. No symptom patches.
   - Before claiming your task done: apply ${DIR}/.claude/skills/verification-before-completion/SKILL.md - run the full verification commands FRESH and read their output; no claims without evidence from this session.
   - If your task touches env vars, secrets, keys, or config defaults: read ${DIR}/.claude/skills/insecure-defaults/SKILL.md first. Fail-open defaults (env.X || 'fallback') on a secret are an Article IV violation - the app must crash without proper config, never run with a default key.
4. Run: git -C "${DIR}" log --oneline | head -8   and   cd "${DIR}" && bun test
   - If your task's commit ALREADY exists in the log (message starts with your task id), verify it satisfies your brief; if yes return status=done with that commit; if no, treat the gap as your work.
   - The suite must be green before you start (a missing-test-files error on a fresh repo counts as green for T001-T003). If it is red, apply systematic-debugging; if the cause is outside your task's scope, return status=blocked.

EXECUTION RULES (constitutional, non-negotiable):
- TDD per the skill: failing test FIRST (confirm it fails for the right reason), minimal implementation, FULL suite green (bun test, not just your file), refactor only on green. Exception: pure config/scaffold tasks (T001, T002) have no behavior to test - validate them by running them instead.
- ONE commit for your task only. Message starts "<TASK-ID>: " and ends with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Stage by explicit path (git add <paths>), NEVER git add -A. Leave the tree clean.
- Article X zones: GREEN act freely. YELLOW (real trade-off, no Article touched) act AND append an ADR to DECISIONS.md (next sequential number, template at top of file) BEFORE your commit; include DECISIONS.md in your commit. RED (touches Articles I-IX, expands scope, one-way door, new external/network dependency) = DO NOT PROCEED: return status=blocked with the exact question in "blocker", tree restored clean. When unsure, treat as RED.
- DECISIONS.md has an "Archived (run v1)" section: decisions from the previous build. You may ADOPT a v1 decision (fastest: say so in your own new ADR referencing it) or improve on it - but your run logs its own ADRs either way.
- Scope: exactly your task. Do not touch other tasks' files, specs/, or .specify/.
- Greek product surface (FR-11): user-facing strings Greek; stored enum keys render only via src/domain/labels.ts. Code/comments/tests English.
- Article III: the app NEVER calls an LLM API. Article IV: PII never in logs, reports, or analytical queries.
- Stack: Bun built-ins (bun:sqlite, Bun.serve, bun test). No ORM, no Express, no Jest. New dep = YELLOW (react/react-dom/lucide-react for T012 are pre-approved by plan.md, not YELLOW).

Your final output MUST be the structured result. "testsPass" = FULL suite green, verified fresh.
`

// ── Task briefs — every task in tasks.md, one specialist each ────────────────

const PHASE0 = [
  { id: 'T001', role: 'You are a Bun project-scaffolding specialist.',
    brief: `Init repo scaffold: package.json (name constructor, type module, scripts: db:init=bun src/db/init.ts, seed=bun src/db/seed.ts, dev=bun src/api/server.ts, report=bun src/report/cli.ts, test=bun test; devDependency @types/bun), strict tsconfig.json (moduleResolution bundler, jsx react-jsx, noEmit, strict + noUncheckedIndexedAccess), and .gitignore covering constructor.db (+journal/wal/shm), .env/.env.* with !.env.example negation, node_modules, dist. If any of these files already exist from the reset, verify + fix rather than recreate. Run bun install; commit the lockfile. Scaffold task: no test - validate by running bun test (expects "0 test files" error = OK) and bun install exit 0.` },
  { id: 'T002', role: 'You are a SQL schema specialist.',
    brief: `Create src/db/schema.sql VERBATIM from specs/001-sales-pipeline-mvp/data-model.md (both SQL blocks: tables+indexes AND the views block). The data-model's next_action CHECKs use trim(next_action, ' ' || char(9) || char(10) || char(13)) - copy exactly; that strengthening was a human ruling (see DECISIONS.md RULING 2026-07-13). Validate by applying to an in-memory bun:sqlite Database and probing: all 9 tables + 4 views exist; INSERT with tab-only next_action fails the CHECK (use PRAGMA foreign_keys=OFF for the probe). This validation lives in a throwaway run, not a committed test (T003 owns the committed test).` },
  { id: 'T003', role: 'You are a bun:sqlite initialization specialist.',
    brief: `Test-first tests/init.test.ts then src/db/init.ts: export initDb(path='constructor.db') - opens/creates via bun:sqlite, PRAGMA foreign_keys=ON per connection, applies schema.sql idempotently (skip if tables exist), import.meta.main block for bun run db:init. Tests: DB file created; all 9 tables + 4 views present; PRAGMA foreign_keys=1 and an FK actually fires on dangling reference; double-init is a no-op. Use a temp-file DB path, clean up in afterEach.` },
  { id: 'T004', role: 'You are a pure-function domain specialist.',
    brief: `Test-first tests/domain.test.ts then src/domain/temperature.ts: temperature(interest) -> 'hot'|'warm'|'cold' per data-model derived logic (>=4 hot, =3 warm, <=2 cold); non-integer or out-of-1..5 throws RangeError. Export the Temperature type for reuse.` },
  { id: 'T005', role: 'You are a pure-function domain specialist (deterministic money math).',
    brief: `Test-first (extend tests/domain.test.ts) then src/domain/counter.ts: counter(asking, offer) -> null if offer>=asking, else {pctBelow, suggested} with pctBelow=(asking-offer)/asking and suggested=round((offer+(asking-offer)*0.6)/500)*500 (ADR-0003 locked weight; determinism is RED - never randomize/estimate). Pin exact vectors: (300000,270000)->suggested 288000 pctBelow 0.1; (250000,231300)->242500. Non-positive inputs throw.` },
  { id: 'T006', role: 'You are a domain specialist for report recommendations (Greek product surface).',
    brief: `Test-first then src/domain/recommend.ts: recommendation(signals) -> Greek string. PINNED thresholds (locked): viewings>=3 AND offers=0 -> price-too-high (with optional comps-based euro target in the text when provided); viewings<3 -> presentation/channel suggestion; otherwise hold. MUST be a total function: non-empty Greek output for ANY input including NaN/negatives (Article VI - no naked bad number can ever lack a recommendation), never throws. The input shape (where the comps target comes from, precedence when offers exist at low viewings) is YELLOW - v1 settled it as ADR-0006 (archived); adopt or improve, log your own ADR. Euro formatting must not depend on host ICU (Article III byte-determinism).` },
  { id: 'T006a', role: 'You are an i18n/label-map specialist.',
    brief: `Test-first tests/labels.test.ts then src/domain/labels.ts: stageLabel/eventTypeLabel/temperatureLabel mapping ALL stored enum keys (schema.sql comments list them: stages Lead|Επίσκεψη|Προσφορά|Κράτηση|Συμβόλαιο|Fallthrough; event types inquiry|viewing|offer|reservation|contract|fallthrough; temperature hot|warm|cold) to non-empty GREEK display strings. Unknown key THROWS (a new stored value without a label must fail tests, not leak English to a builder-facing surface - FR-11). Make the test parse the enum lists out of schema.sql's comment lines so schema additions without labels fail automatically.` },
]

const PHASE1 = [
  { id: 'T007', role: 'You are a SQLite + TypeScript data-layer specialist (prepared statements, transactions, typed results).',
    brief: `Build src/db/queries.ts test-first (tests/constraints.test.ts): createLead, logViewing, logOffer, advanceOpportunity, listPipeline(projectId), activityCounters(projectId).
- Grain (locked): ONE opportunity per buyer-project (UNIQUE(buyer_id, project_id)). logViewing/logOffer with no prior opportunity CREATES it on the spot (spec edge case). Event unit -> sales_events.unit_id AND opportunities.focus_unit_id.
- Article II mirrored: every write throws on empty/whitespace next_action BEFORE touching the DB (JS trim); the SQL CHECK stays the backstop.
- Temperature: viewings via temperature(interest); offers force 'hot'. Stage advances forward only, never regresses. handled_by + next_action on every event; updated_at ISO-8601; multi-statement writes in db.transaction.
- listPipeline: card fields (pseudonym, unit code, stage, temperature, offer amount, next_action, next_owner) + DETERMINISTIC needs-attention-first order - v1 settled ordering + closed-stage filter as ADR-0007, lead defaults as ADR-0008 (archived; adopt or improve, log yours).
- Buyers here are ANALYTICAL ONLY - reject any name/phone/email keys at runtime (Article IV).` },
  { id: 'T008', role: 'You are a test engineer specializing in DB constraint verification and negative-path testing.',
    brief: `Extend tests/constraints.test.ts: (a) Article II - opportunity AND sales_event inserts with blank AND tab/newline-only next_action fail at the RAW SQL layer (db.run, bypassing queries.ts; the strengthened CHECK handles all whitespace) AND at the query layer (throws before DB). (b) Article IV - assert the SQL text in src/db/queries.ts never references buyer_identity (read + grep the file in the test); analytical queries (v_buyer_pool, listPipeline, activityCounters) return correctly with buyer_identity EMPTY and even DROPPED. Test-focused commit.` },
  { id: 'T008a', role: 'You are an application-security specialist: AES-GCM authenticated encryption, env-based key management, GDPR erasure mechanics. The insecure-defaults skill is MANDATORY reading for you.',
    brief: `Test-first src/db/identity.ts + tests/identity.test.ts: AES-256-GCM via node:crypto; key ONLY from env CONSTRUCTOR_PII_KEY (32 bytes; document accepted encoding); missing/malformed key = loud crash naming the var - NEVER a fallback default (fail-secure; the skill's core pattern). Fresh random IV per encryption; IV+authTag stored with ciphertext in the BLOB. saveIdentity refuses without recorded consent (no identity row without consent - FR-14); readIdentity decrypts; eraseIdentity deletes the identity row while buyers/opportunities/events remain fully queryable (prove with a test). Tests: consent gate; roundtrip; ciphertext bytes do not contain plaintext; PII never in error messages; analytics work after erasure. Fixed test key set via env in the test file. Provide .env.example (committed, keyless, with openssl rand -base64 32 generation hint).` },
  { id: 'T009', role: 'You are a Bun.serve HTTP API specialist: routing, boundary validation, ephemeral-port test servers.',
    brief: `Test-first tests/api.test.ts then src/api/server.ts: POST /leads /viewings /offers, GET /pipeline?project= and /counters?project=. Thin boundary - validate shape/types then delegate to queries.ts; NO business logic. Empty next_action -> 400 GREEK JSON error; viewing without interest -> 400 (required); consistent 400/404 semantics. Export makeServer(db) so tests inject a temp DB and port 0; import.meta.main starts the dev server. Tests drive real HTTP via fetch: happy path per endpoint + Article II rejection per write + viewing-without-interest.` },
  { id: 'T010', role: 'You are the API specialist extending the offer endpoint.',
    brief: `POST /offers response includes counter() output ({pctBelow, suggested}) when offer < unit asking_current; at-or-above asking: no counter, capture still succeeds, next_action still required. Test both branches with exact numbers (300000/270000 -> 288000).` },
  { id: 'T010a', role: 'You are the data-layer specialist: atomic transactions.',
    brief: `updateAskingPrice(unitId, newPrice, reason) in queries.ts: update units.asking_current AND append exactly one price_changes row (old/new/reason/changed_at ISO) in ONE transaction - both or neither. Test-first: exactly one log row with correct old/new per call; reads see the new price; rollback path if forceable.` },
  { id: 'T011', role: 'You are a data-migration specialist: seed loaders, realistic fixtures.',
    brief: `src/db/seed.ts + bun run seed <file.json> (US-7/SC-6: board never empty on first launch). Design the JSON shape (projects+units, analytical buyers, opportunities with stage/temperature/next_action/next_owner, sales_events history) - shape deviations from data-model implications are YELLOW. seed.example.json: realistic GREEK data - builder "Παπαδόπουλος", project "Κυψέλη-Α" (exactly as quickstart.md), micro_area at Article V precision ("Κυψέλη · Πλατεία Κύπρου, block Α"), 2 projects, ~6 units, ~8 buyers across segments/sources, stages spread across Lead/Επίσκεψη/Προσφορά, Greek next_actions, handled_by across Χρήστος/Λωίδα/Γιολάντα. NO PII (pseudonyms only - file is committed). Test: seeded temp DB shows rows via listPipeline + activityCounters; re-seed does not crash or duplicate.` },
  { id: 'T011a', role: 'You are a CLI-tool specialist.',
    brief: `Comps entry (FR-12) test-first: package.json script comp:add -> src/db/comps.ts. Required: micro_area (Article V), source in {own_transaction, manual_known_sale}, positive integer sale_price (an actual SALE price, never asking - say so in help text), entered_by for manual. Programmatic addComp() for tests/reports + the merge query: own sold units (units.sale_price NOT NULL) auto-count as own_transaction alongside comps rows for a micro_area (monthly report consumes this). Tests: stored with correct source; missing source/micro_area rejected.` },
  { id: 'T012', role: 'You are a senior mobile-first React engineer and product designer: one-hand ergonomics, sub-30s capture flows, Greek UI, 44px+ touch targets, segmented controls over keyboards.',
    brief: `src/web/App.tsx + index.html: pipeline board + three capture sheets wired to the API, served by bun run dev (Bun fullstack HTML-import routes, or Bun.build - GREEN either way). Deps react/react-dom/lucide-react pre-approved. Inline styles.
- BOARD (US-4): cards show pseudonym, unit, stage GREEK label via labels.ts (never raw keys), temperature color badge, offer amount, next_action + next_owner prominent; order comes FROM the API - no client re-sort; per-project counters (live/viewings/offers).
- SHEETS (Article I - each flow <30s one-handed): +Lead (source/segment/budget as big option grids, optional unit, mandatory next_action, max ONE optional note); +Επίσκεψη (unit, buyer, interest 1-5 as five big tap targets REQUIRED, mandatory next_action); +Προσφορά (unit, buyer, numeric amount, live pct-below + suggested counter from API response, one-tap "set as next action", mandatory next_action).
- All chrome strings Greek. Saved-confirmation feedback, return to board.
- Tests (pragmatic split per plan): server serves HTML route 200 text/html; TSX bundle builds clean (Bun.build in a test); extracted pure helpers unit-tested. Interactive behavior = CHECKPOINT 1 human verification - state this split in your summary.` },
  { id: 'T012a', role: 'You are a full-stack specialist for lightweight session identity (no real auth - locked).',
    brief: `Operator identity (FR-6/SC-5 locked): on app open a "Ποιος είσαι;" selector - Χρήστος / Λωίδα / Γιολάντα - in sessionStorage, switchable from the header. Every capture auto-includes the operator; next_owner defaults to it, overridable. API validates handled_by is one of the three (400 Greek otherwise). Tests (API level): events carry posted handled_by; invalid operator rejected; v_separation reflects distribution.` },
  { id: 'T013', role: 'You are a UI-correctness specialist closing Article II at the interface.',
    brief: `Submit-disable on empty/whitespace next_action in ALL three sheets (visually disabled AND non-functional until trim length > 0); viewing sheet also cannot submit without interest. Extract a pure canSubmit predicate and unit-test it headlessly. Append a short CHECKPOINT-1 manual checklist section to quickstart.md (the file tasks.md names for this - minimal edit, this is the one sanctioned specs/ touch).` },
]

const PHASE2 = [
  { id: 'T014', role: 'You are a deterministic-report specialist: Greek business prose from SQL numbers only.',
    brief: `Test-first tests/report.test.ts then src/report/biweekly.ts: Greek Markdown report for the last 14 days of a project - activity totals (new inquiries, viewings, offers), per-unit breakdown, and clearly-marked placeholders for 2-3 insight lines (pasted later from the /insights command - Article III: NO LLM here, numbers from queries.ts/SQL only). Stage/event names via labels.ts. Deterministic: same DB + args = byte-identical output (inject the as-of date, never call new Date() in the report path). Test with a seeded fixture DB.` },
  { id: 'T015', role: 'You are the report specialist enforcing Article VI.',
    brief: `No-naked-bad-number rule: every zero/cold metric in the biweekly report is PAIRED inline with a recommendation() output (src/domain/recommend.ts). Test asserts: for a fixture with a zero-activity unit and a cold unit, no zero/negative figure renders without an adjacent recommendation; and a fully-zero period states it plainly + recommends a concrete action (spec edge case - never blank, never a bare 0).` },
  { id: 'T016', role: 'You are the analytics-report specialist: trends, price realization, comparatives, forecasts - all SQL-deterministic.',
    brief: `src/report/monthly.ts test-first: extends biweekly with (a) trend vs previous fixed period, (b) price-realization per unit (v_price_realization), (c) micro-area comparative from own transactions + manual comps (T011a merge query; label each comp's source in the output), (d) per-unit recommendation (price/presentation/hold via recommendation(), computing the comps-based euro target here in the report layer), (e) absorption forecast from offer/viewing signals ONLY (reservation velocity is Phase B - deferred; do NOT read v_velocity). Deterministic tests on a fixture DB with known numbers.` },
  { id: 'T017', role: 'You are a CLI + date-window specialist: fixed non-overlapping period math (Article III reproducibility).',
    brief: `src/report/cli.ts + bun run report --builder= --project= --period=biweekly|monthly|quarterly [--anchor=DATE] [--rolling] [--as-of=DATE]. DEFAULT: fixed, non-overlapping windows anchored to --anchor (default project.listed_at) - consecutive reports NEVER double-count an event (test the boundary: an event on a window edge appears in exactly one window). --rolling = last N days from as-of (internal). --as-of=DATE computes as if run then (reproducibility). Same DB + same flags = identical stdout (test twice, compare bytes). Greek Markdown to stdout, exit 0. Unknown builder/project = clear Greek error, exit 1.` },
  { id: 'T018', role: 'You are the insight-brief specialist (deterministic signals; the human runs the AI step elsewhere).',
    brief: `src/report/brief.ts + --brief flag: emit a structured insight brief (cold units, activity deltas, offers-vs-asking gaps - raw signals as structured text/JSON) - fully deterministic, NO LLM API (Article III). Verify .claude/commands/insights.md EXISTS (it does - pre-existing) and matches the brief's actual output format; update that command file's input-format section if needed (sanctioned touch). Tests: report generates fully WITHOUT any insight content; --brief output well-formed and deterministic.` },
  { id: 'T019', role: 'You are a small-feature specialist.',
    brief: `bun run report --separation prints the v_separation view (handled_by distribution, Greek headers) - SC-5's separation test, available from day one. Test: seeded events produce correct per-operator counts.` },
]

const PHASE3 = [
  { id: 'T020', role: 'You are a verification specialist: evidence-backed success-criteria mapping. The verification-before-completion skill is your operating manual.',
    brief: `Run the FULL suite + every quickstart.md command fresh. Produce VERIFICATION.md mapping each of SC-1..SC-6 (spec.md) to concrete evidence: the command run, its output (paste key lines), and the test file:line pinning it. SC-1 (<30s capture) is human-measured at FINAL CHECKPOINT - mark it "pending human timing" with the automated proxy evidence (payload sizes, single-round-trip saves). No claim without fresh output from THIS run (the skill's Iron Law). Commit VERIFICATION.md.` },
]

// ── Auditor prompt (per phase) ───────────────────────────────────────────────

function auditPrompt(phaseName, taskIds) {
  return `You are an independent constitution auditor for ${DIR}. ${phaseName} was just built by a task-per-agent pipeline. Verify SKEPTICALLY - run every check yourself (verification-before-completion skill applies: evidence only, no trust):
1. git log: exactly one commit per task [${taskIds.join(', ')}] (prefix check), tree clean.
2. bun test - exact pass/fail counts.
3. Article gates by command: II (blank AND tab-only next_action fail raw-SQL on a scratch schema copy), III (grep -ri "anthropic\\|claude -p\\|api.anthropic" src/ empty), IV (buyer_identity referenced only in the identity module; analytics run with zero identity rows; no PII field names in log/error strings in src/), V (no location field coarser than micro_area), FR-11 (no raw stored enum keys rendered in src/web or reports - all via labels.ts).
4. DECISIONS.md: every YELLOW the agents reported is logged with the template.
5. Phase-specific: Phase 1 -> db:init + seed seed.example.json on a scratch DB yields board rows (SC-6); dev server GET / is 200 text/html and /pipeline?project=1 is 200 JSON (kill it, clean up). Phase 2 -> bun run report (biweekly + monthly + --separation) on the seeded scratch DB: Greek output, <5s, run twice = byte-identical, zero naked bad numbers by inspection. Phase 3 -> VERIFICATION.md claims spot-checked by re-running two of its commands.
Do NOT fix anything - report only.`
}

// ── Driver ───────────────────────────────────────────────────────────────────

const PHASES = { 0: PHASE0, 1: PHASE1, 2: PHASE2, 3: PHASE3 }
const PHASE_NAMES = { 0: 'Phase 0 (foundation)', 1: 'Phase 1 (capture + pipeline)', 2: 'Phase 2 (reporting)', 3: 'Phase 3 (verification)' }
// args may arrive as an object or a JSON-encoded string depending on invocation path — accept both.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { /* fall through to guard */ } }
const phaseKey = A && A.phase !== undefined ? Number(A.phase) : NaN
if (!(phaseKey in PHASES)) {
  return { error: 'Pass args {phase: 0|1|2|3}. Run phases in order; get human CHECKPOINT approval between them (REBUILD-RUNBOOK.md).' }
}

const tasks = PHASES[phaseKey]
const results = []
let prev = phaseKey === 0
  ? 'You are the first agent of this phase; repo was reset for the rebuild (see REBUILD-RUNBOOK.md).'
  : `Earlier phases are committed and were human-approved at their checkpoint. Read git log for their state.`

for (const t of tasks) {
  phase(t.id)
  log(`Starting ${t.id}`)
  const r = await agent(
    `${t.role}\n\nYOUR TASK: ${t.id} - from tasks.md:\n${t.brief}\n\nHANDOFF FROM PREVIOUS AGENT: ${prev}\n${COMMON}`,
    { label: t.id, phase: t.id, schema: RESULT }
  )
  if (!r) { log(`${t.id}: agent died - halting`); return { halted: t.id, reason: 'agent returned null', results } }
  results.push(r)
  if (r.status !== 'done' || !r.testsPass) {
    log(`${t.id} HALTED: ${(r.blocker || 'tests not green').slice(0, 200)}`)
    return { halted: t.id, blocker: r.blocker || 'tests not green at commit time', results }
  }
  prev = `${t.id} done (commit ${r.commit}): ${r.summary}${r.yellowADRs && r.yellowADRs.length ? ' YELLOW: ' + r.yellowADRs.join(', ') : ''}`
  log(`${t.id} done: ${r.commit}`)
}

phase('Audit')
const audit = await agent(auditPrompt(PHASE_NAMES[phaseKey], tasks.map(t => t.id)), {
  label: `audit-phase${phaseKey}`, phase: 'Audit', schema: AUDIT_SCHEMA,
})

return {
  phase: phaseKey,
  results,
  audit,
  next: phaseKey === 3
    ? 'FINAL CHECKPOINT: full loop demo + human review. STOP - no Phase B work.'
    : `CHECKPOINT ${phaseKey}: present the review package, WAIT for human approval, then run args {phase: ${phaseKey + 1}}.`,
}