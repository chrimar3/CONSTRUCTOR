# Tasks — 001 · Sales Pipeline MVP

Execution rules (from constitution): test-first (write failing test → implement → pass), one commit per task, build incrementally, stop at each **CHECKPOINT** for human verification. `[P]` = parallelizable (no shared files). Do NOT generate the whole project at once.

**Article X autonomy:** act freely on GREEN (implementation detail); on YELLOW (a real trade-off not touching any Article) act AND append an entry to `DECISIONS.md` before moving on; on RED (Article-touching, scope-expanding, or one-way-door) STOP and ask. When unsure, treat as RED.

## Phase 0 — Foundation

- **T001** Init repo: `package.json` with Bun scripts (`db:init`, `seed`, `dev`, `report`, `test`), tsconfig, `.gitignore` (ignore `constructor.db`). Commit.
- **T002** Add `src/db/schema.sql` verbatim from data-model.md (all tables, CHECK constraints, indexes, views). Commit.
- **T003** `src/db/init.ts`: opens `constructor.db` via `bun:sqlite`, applies `schema.sql`, `PRAGMA foreign_keys=ON`. Test: DB file created, tables exist. Commit.
- **T004 [P]** Test-first `src/domain/temperature.ts`: `temperature(interest)` → hot/warm/cold per data-model. `tests/domain.test.ts`. Commit.
- **T005 [P]** Test-first `src/domain/counter.ts`: `counter(asking, offer)` returns null if offer≥asking else `{pctBelow, suggested}` (weighted, rounded €500). Commit.
- **T006 [P]** Test-first `src/domain/recommend.ts`: `recommendation({viewings, offers, ...})` → Greek recommendation string using the pinned thresholds (`viewings ≥ 3 & offers = 0`, `viewings < 3`, else hold); guarantees non-empty for any input (Article VI). Commit.
- **T006a [P]** (FR-11) Test-first `src/domain/labels.ts`: `stageLabel(stage)` / `eventTypeLabel(type)` map the INTERNAL stored keys (incl. English `Lead`, `Fallthrough`, `inquiry`, …) to Greek display strings. Test: every enum value in schema.sql has a non-empty Greek label (fails if a new stored value is added without a label). Consumed by web (T012) and reports (T014/T016) so no raw key is ever rendered. Commit.
- **CHECKPOINT 0**: `bun test` green for domain + init. Human verifies schema matches data-model.md.

## Phase 1 — Capture + pipeline (US-1..US-4, US-7)

- **T007** `src/db/queries.ts`: typed functions — `createLead`, `logViewing`, `logOffer`, `advanceOpportunity`, `listPipeline(projectId)`, `activityCounters(projectId)`. Each enforces non-empty `next_action` (throw if empty) — mirrors the SQL CHECK. Test-first `tests/constraints.test.ts`: empty next_action rejected at query layer AND DB layer. Commit.
- **T008** Constraints test: inserting an opportunity/event with blank next_action MUST fail (Article II); analytical buyer query MUST return without touching `buyer_identity` (Article IV). Commit.
- **T008a** GDPR minimum (FR-14): AES-GCM encrypt/decrypt for identity (key from non-committed env/secret); `saveIdentity` refuses without consent; `eraseIdentity(buyerId)` deletes identity while opportunities/events survive. Test-first: no identity without consent; after erase, analytics still return; PII never in any report/query output. Commit.
- **T009** `src/api/server.ts` with `Bun.serve`: `POST /leads`, `POST /viewings`, `POST /offers`, `GET /pipeline?project=`, `GET /counters?project=`. Validate payloads; reject empty next_action (400). Test-first `tests/api.test.ts`. Commit.
- **T010** Offer endpoint integrates `counter()` — response includes suggested counter when applicable. Test. Commit.
- **T010a** Price-update path: `updateAskingPrice(unitId, newPrice, reason)` in `queries.ts` updates `units.asking_current` AND appends a `price_changes` row (old/new/reason) in one transaction. Test-first: changing a price logs exactly one `price_changes` row with correct old/new; realization/report reads see the new price. Commit.
- **T011** `src/db/seed.ts` + `bun run seed <file.json>`: Day-0 migration loads an existing pipeline so the board is populated on first launch (US-7). Provide `seed.example.json`. Test: seeded rows appear in `listPipeline`. Commit.
- **T011a** Comps (FR-12): `comps` table + `bun run comp:add` (and a minimal entry path) for operator-entered known **sale** prices, labelled by source; own sold units auto-count as `own_transaction`. Test: comps stored; asking prices rejected as sale prices is out of scope but source must be set. Commit.
- **T012** `src/web/App.tsx` + `index.html`: port the capture prototype (pipeline board, Lead/Viewing/Offer sheets, mandatory next-action, interest→temperature, offer auto-counter). Wire to API endpoints. Greek UI strings (via `labels.ts`, T006a). Served by `bun run dev`.
- **T012a** (FR-6, SC-5, clarification-locked) Operator identity: a "ποιος είσαι" selector on app open — **Χρήστος / Λωίδα / Γιολάντα** — stored in session; every capture auto-stamps `handled_by` and defaults `next_owner` to the current user (overridable). API accepts/validates the operator on each write. Test: events carry the selected `handled_by`; `v_separation` reflects it. Commit.
- **T013** Wire submit-disable on empty next_action in all three sheets (Article II at UI). Manual/visual test noted in quickstart. Commit.
- **CHECKPOINT 1**: `bun run dev` → open on phone viewport; complete each capture type in <30s (SC-1); board updates; empty next_action blocks submit (SC-2). Human verifies.

## Phase 2 — Reporting (US-5, US-6)

- **T014** `src/report/biweekly.ts`: deterministic Greek report for last 14 days — activity totals, per-unit breakdown, insight placeholders. Uses only SQL/queries. Test-first `tests/report.test.ts`. Commit.
- **T015** "No naked bad number" rule: every zero/cold metric paired with `recommendation()` output. Test asserts no bare negative figure appears without a recommendation (Article VI). Commit.
- **T016** `src/report/monthly.ts`: adds trend vs previous period, price-realization per unit, micro-area comparative (own sold units + manual comps from `comps`, labelled), per-unit recommendation, absorption forecast. Test deterministic outputs. Commit.
- **T017** `src/report/cli.ts` + `bun run report --builder --project --period`: emits Greek Markdown to stdout. Implement **fixed non-overlapping** periods anchored to `--anchor` (default project.listed_at), plus `--rolling` and `--as-of=DATE`. Identical DB + same flags ⇒ identical numbers. Test all three modes. Commit.
- **T018 [P]** `src/report/brief.ts` + `--brief` flag: emit a structured insight brief (raw signals: cold units, velocity delta, offers vs asking) — deterministic, **NO LLM API**. Also add `.claude/commands/insights.md`: an interactive Claude Code slash-command that turns a pasted brief into 2–3 Greek insight sentences (house style + no-naked-bad-number), run by the operator under the Max subscription. Test: report generates fully without any AI; `--brief` output is well-formed. Commit.
- **T019 [P]** Separation-test report: `bun run report --separation` prints `v_separation` (handled_by distribution) (SC-5). Commit.
- **CHECKPOINT 2**: biweekly + monthly reports generate in one command in <5s, in Greek, with zero naked bad numbers (SC-3); **no in-app LLM call**; insight prose comes from the interactive Claude Code `/insights` step. Human verifies report reads like something a builder would trust.

## Phase 3 — Verify against success criteria
- **T020** Run all `bun test`; confirm SC-1..SC-6 from spec.md. Produce a short `VERIFICATION.md` mapping each SC to its evidence. Commit.
- **FINAL CHECKPOINT**: prototype demonstrably runs the loop capture → pipeline → report. Stop. Await human review before any Phase B work.

## Dependency notes
- T004–T006a parallel after T001. T007 needs T002/T003. T010a needs T007. T009 needs T007. T012 needs T009 + T006a. T012a needs T009/T012. Phase 2 needs Phase 1 board + queries; reports consume T006a labels. T018/T019 parallel after T017.
