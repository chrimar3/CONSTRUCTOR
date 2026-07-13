# CLAUDE.md — Constructor (sales-operations prototype)

Spec Kit project. Real-estate agency acting as the outsourced sales department for
construction firms. **Everything binding lives in the spec documents — this file only
tells you where they are and how to execute. When in doubt, the constitution wins.**

> NOTE: This project OVERRIDES the global `~/CLAUDE.md` (React/Jest/ESLint web-app
> config). That config does NOT apply here. Stack is Bun-native, tests run with
> `bun test`, no Prettier/ESLint pipeline, no ORM, no CSS framework.

## Read order (fresh session — do not skip)

1. `.specify/memory/constitution.md` — **BINDING. 10 Articles.** If a task would violate one, STOP and ask. Never work around it.
2. `specs/001-sales-pipeline-mvp/spec.md` — WHAT & WHY (FR-1..14, SC-1..6, `[locked]` clarifications).
3. `specs/001-sales-pipeline-mvp/plan.md` — HOW (architecture, phases, Constitution Check).
4. `specs/001-sales-pipeline-mvp/data-model.md` — SQLite schema, constraints, deterministic views + derived logic.
5. `specs/001-sales-pipeline-mvp/tasks.md` — ordered tasks T001…T020 (+ T006a, T010a, T011a, T012a) with CHECKPOINTS.
6. `HANDOFF.md` — session kickoff brief; `DECISIONS.md` — ADR log (inherited locked decisions + agent YELLOW entries).

## Tech stack

- **Runtime**: Bun (1.3+) · **Language**: TypeScript
- **DB**: `bun:sqlite`, single file `constructor.db` (gitignored). Raw SQL, **no ORM** (Article VIII).
- **Server**: `Bun.serve` — thin HTTP/JSON API, no framework.
- **Web**: React via Bun's bundler; minimal deps (react, react-dom, lucide-react); inline styles.
- **Tests**: `bun test` (built-in runner). **NOT Jest.**
- **Reports**: deterministic Greek Markdown to stdout. **No LLM API call anywhere in the app** — insight prose comes from the interactive `/insights` command (`.claude/commands/insights.md`), human-run under Max, pasted in.

## Execution rules (non-negotiable)

- **Test-first (Article IX)**: failing test → implement → green. No impl before its test.
- **One commit per task** (T001, T002, …). Never generate the whole project in one pass.
- **STOP at every CHECKPOINT** (end of Phase 0 / 1 / 2 + FINAL) and wait for human review.
- **Article X zones**: GREEN (pure impl detail) → act freely. YELLOW (real trade-off, no Article touched) → act, but append an ADR to `DECISIONS.md` **before moving on**. RED (touches Articles I–IX, expands scope, one-way door, or adds an external/network dependency) → STOP and ask. Unsure → RED.
- **Stage precisely**: `git add <paths>`, never `git add -A`.

## Hard invariants (the two easiest to break)

- **Article II**: no opportunity/event without a non-empty `next_action` — enforced in UI **and** SQL `CHECK`.
- **Article IV**: buyer PII (name/phone/email) lives only in `buyer_identity`, AES-GCM encrypted, key from a non-committed secret, gated by `consent_flag`. PII never appears in any report, analytic query, or log. Erasure deletes the identity row; analytics survive de-identified.

Also always-on: micro-area granularity (Article V), no naked bad numbers in reports (Article VI), Greek product surface — stored enum keys render via `src/domain/labels.ts`, never raw (FR-11).

## Commands

```bash
bun install
bun run db:init      # create constructor.db from src/db/schema.sql
bun run seed <file>  # Day-0 migration (US-7)
bun run dev          # API + web
bun run report --builder="…" --project="…" --period=biweekly|monthly|quarterly
bun test
```

## Locked decisions (do not revisit — see DECISIONS.md for rationale)

- Opportunity grain = **buyer↔project** (`UNIQUE(buyer_id, project_id)`); current unit is `focus_unit_id`.
- Operator identity = selector Χρήστος / Λωίδα / Γιολάντα, stamped as `handled_by`; no real auth.
- Counter-offer: weight 0.6 toward asking, rounded €500 (value = YELLOW to change; determinism = RED).
- Report periods: fixed non-overlapping by default; `--rolling` and `--as-of=DATE` supported.
- `recommendation()` threshold pinned at **viewings ≥ 3**.
- Deferred to Phase B: reservation/contract capture, `v_velocity`, `marketing_assets`, ilist sync, auth, hosting, multi-tenant.
