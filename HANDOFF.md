# HANDOFF — Constructor (read this first)

You are picking up the **Constructor** sales-operations prototype (real-estate agency acting as the outsourced sales department for construction firms). This is a **Spec Kit** project: everything you need is on disk. You have no memory of prior sessions — that is by design.

## Kickoff prompt (paste to yourself, or just follow it)

> Read `.specify/memory/constitution.md`, then `specs/001-sales-pipeline-mvp/` (spec → plan → data-model → tasks). Execute `tasks.md` in order, **test-first, one commit per task**. **STOP at every CHECKPOINT** and wait for human review. Do not exceed the spec's scope. Log YELLOW-zone decisions to `DECISIONS.md` before moving on.

The idiomatic way to run this in a Claude Code session rooted here: **`/speckit-implement`** (optionally `/speckit-analyze` first to confirm a clean report).

## Read order (do not skip the constitution)

1. `.specify/memory/constitution.md` — **binding**. 10 Articles. If a task would violate one, STOP and ask; never "work around" it.
2. `specs/001-sales-pipeline-mvp/spec.md` — WHAT & WHY (FR-1..14, SC-1..6, user stories, clarifications marked `[locked]`).
3. `specs/001-sales-pipeline-mvp/plan.md` — HOW (Bun + TypeScript + `bun:sqlite`, architecture, phases, Constitution Check).
4. `specs/001-sales-pipeline-mvp/data-model.md` — SQLite schema, constraints, deterministic views.
5. `specs/001-sales-pipeline-mvp/tasks.md` — ordered tasks T001…T020 (+ T006a, T010a, T012a) with CHECKPOINTS.
6. `specs/001-sales-pipeline-mvp/quickstart.md` — run & verify.

## Non-negotiable execution rules (from the constitution)

- **Test-first (Article IX).** No implementation code before a failing test defines the behavior. Writing impl before a test is a drift signal.
- **One commit per task.** Build incrementally; do NOT generate the whole project in one pass.
- **Stop at CHECKPOINTS.** Four of them (end of Phase 0 / 1 / 2 + FINAL). This is the human-in-the-loop — do not blow through them.
- **Bounded autonomy (Article X).**
  - **GREEN** (pure implementation detail) — act freely, no logging.
  - **YELLOW** (a real trade-off not touching any Article — a dependency, an ambiguous requirement, a data shape the spec left open) — act, but append an ADR entry to `DECISIONS.md` **before moving on**. An unlogged YELLOW decision is a process violation.
  - **RED** (touches any Article I–IX; expands scope — auth, ilist sync, hosting, multi-tenant; or a one-way door — the DB grain, PII encryption approach, price/report determinism) — **STOP and ask**. When unsure, treat as RED.
- **The two hardest invariants:** (Article II) no opportunity without a non-empty `next_action` — enforced in UI *and* DB CHECK; (Article IV) buyer PII lives in a separate, encrypted table, gated by consent, never in any report/query/log.
- **Greek product surface.** All UI strings and generated reports are Greek (render via `src/domain/labels.ts` for stored enum keys); your own specs/notes stay English.
- **Determinism & no in-app LLM.** Report numbers come only from SQL. The app never calls an LLM API. Insight prose is produced out-of-band via the interactive `/insights` command (`.claude/commands/insights.md`) under Max, then pasted in — no API key anywhere.

## Current state (as of this handoff)

- Product **rebranded Pipeline → Constructor**; data file is `constructor.db`. The domain term "sales pipeline", the `/pipeline` endpoint, and the `001-sales-pipeline-mvp` feature slug are intentionally unchanged.
- **Spec Kit 0.12.2 tooling wired**; `.specify/feature.json` points at `specs/001-sales-pipeline-mvp` so `check-prerequisites.sh` resolves off `master` (no per-feature branch needed).
- **`/speckit-analyze` run and remediated (F1–F7)** — 0 constitution violations, 0 critical issues. Notably: FR-1 grain reconciled to **buyer↔project** (`UNIQUE(buyer_id, project_id)`); added T006a (Greek labels), T010a (price-change logging), T012a (operator identity); reservation-velocity and `marketing_assets` explicitly **deferred to Phase B**; `recommendation()` threshold pinned at **viewings ≥ 3**.
- **No application code exists yet.** The next action is **T001** (init repo + `package.json` + Bun scripts + `.gitignore` ignoring `constructor.db`).

## Definition of done (prototype / Phase A)

The loop runs end-to-end: **capture (Lead/Viewing/Offer) → live pipeline board → one-command Greek builder report**, with SC-1..SC-6 from `spec.md` verified in a `VERIFICATION.md` (T020). Then **stop** for human review before any Phase B work.

## Guardrails recap (what NOT to do)

- Don't build auth, ilist sync, hosting, multi-tenant, portal syndication, or a native mobile app — all explicitly out of scope (Phase B).
- Don't add an in-app LLM/API call for insights — that's RED (Article III).
- Don't merge PII into analytical tables "for simplicity" — that's RED (Article IV).
- Don't skip a CHECKPOINT or a failing test to "save time."
