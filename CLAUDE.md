# CLAUDE.md — Constructor (sales-operations prototype)

Spec Kit project: a real-estate agency acting as the **outsourced sales department** for
construction firms. **Everything binding lives in the spec documents — this file tells you
the goal, the loop, and the gates. When in doubt, the constitution wins.**

> OVERRIDES the global `~/CLAUDE.md` (React/Jest/ESLint config — does NOT apply here).
> Stack is Bun-native: `bun test`, `bun:sqlite`, `Bun.serve`. No ORM, no Jest, no CSS framework.

## GOAL (Phase A — definition of done)

The loop runs end-to-end: **capture (Lead/Viewing/Offer) → live pipeline board → one-command
Greek builder report**, with SC-1..SC-6 verified in `VERIFICATION.md` (T020). Then STOP for
human review. Nothing beyond `specs/001-sales-pipeline-mvp/spec.md` scope — expansions are RED.

## Session bootstrap (deterministic — do this before any work)

1. Read `.specify/memory/constitution.md` (BINDING, 10 Articles), then
   `specs/001-sales-pipeline-mvp/{spec,plan,data-model,tasks}.md` and `DECISIONS.md`.
2. Locate state from git, never from memory or notes:
   `git log --oneline | grep -oE '^\S+ T[0-9]+[a-z]?' | head -1` → last completed task;
   the next task is the one after it in `tasks.md`. `git status --short` must be clean.
3. Run `bun test` — must be green before starting anything new.

## THE LOOP (per task — no exceptions)

```
1. RED      Write the failing test that defines the behavior. Run it; confirm it fails
            for the RIGHT reason (missing impl, not a typo).
2. GREEN    Implement the minimum that passes. Run the full suite, not just the new file.
3. REFACTOR Only with green tests. Keep code boring and direct (Article VIII).
4. ZONE     Made a judgment call? GREEN→proceed · YELLOW→append ADR to DECISIONS.md NOW
            (before the commit) · RED→STOP and ask. Unsure = RED.
5. VERIFY   Gates below. For UI tasks also drive the real flow (phone viewport, <30s).
6. COMMIT   One commit per task, message starts "TXXX: ". Stage by path, never `git add -A`.
7. CHECKPOINT? If tasks.md marks one here: STOP, present the review package, WAIT.
```

Do NOT batch tasks, do NOT skip RED because the impl is "obvious", do NOT blow through a
checkpoint. An unlogged YELLOW decision is a process violation.

## Verification gates (all must pass before any commit)

```bash
bun test                                   # full suite green
grep -rn "claude\|anthropic\|api.anthropic" src/  # → empty; no LLM call in-app (Article III)
```
Plus per-area checks: any new stored enum value → label in `src/domain/labels.ts` (the labels
test enforces this); any query touching buyers → confirm it never joins `buyer_identity`
(Article IV); any report output → no bare zero/negative without a recommendation (Article VI).

## Hard invariants (the two easiest to break)

- **Article II**: no opportunity/event with empty `next_action` — SQL `CHECK` + UI submit-disable.
- **Article IV**: PII only in `buyer_identity` (AES-GCM, key from env — never committed),
  gated by `consent_flag`; never in reports/queries/logs; erasure leaves analytics intact.

Always-on: micro-area granularity (V) · no naked bad numbers (VI) · Greek product surface —
stored keys render only via `src/domain/labels.ts` (FR-11) · deterministic numbers (III).

## Quality bar (how "highest standards" applies WITHIN scope)

- **UX (Article I operationalized)**: mobile-first; every capture ≤30s; thumb-reachable
  controls ≥44px; structured inputs over free text; visible feedback on save; the board
  answers "what needs my attention" in one glance (needs-action sorted first).
- **TDD**: the test is the spec of the behavior — name tests after the requirement they pin
  (e.g. "Article II: …", "FR-13: …") so failures read as requirement violations.
- **System design**: pure domain functions (no I/O) · queries layer owns all SQL · API is a
  thin validator over queries · web is a thin client over the API. Dependencies point inward.
- **Errors**: reject loudly at the boundary (400 with a Greek message); never swallow; the DB
  CHECK is the last line, not the first.

## Commands

```bash
bun run db:init      # create constructor.db from src/db/schema.sql (idempotent)
bun run seed <file>  # Day-0 migration (US-7)
bun run dev          # API + web (phone viewport for UX checks)
bun run report --builder="…" --project="…" --period=biweekly|monthly|quarterly
bun test             # the gate
```

## Checkpoints (STOP and wait at each)

- **CHECKPOINT 0** after T006a — domain + init green; human verifies schema ↔ data-model.md.
- **CHECKPOINT 1** after T013 — phone-viewport capture <30s; empty next_action blocks submit.
- **CHECKPOINT 2** after T019 — reports <5s, Greek, zero naked bad numbers, no in-app LLM.
- **FINAL** after T020 — full loop demonstrated; await human review before Phase B.

## Locked decisions (do not revisit — rationale in DECISIONS.md)

- Grain: one opportunity per **buyer↔project** (`UNIQUE(buyer_id, project_id)`); unit focus via `focus_unit_id`.
- Operators: Χρήστος / Λωίδα / Γιολάντα selector → `handled_by`; no real auth.
- Counter: 0.6 weight toward asking, rounded €500 (value change = YELLOW; determinism = RED).
- Periods: fixed non-overlapping default; `--rolling`, `--as-of=DATE` supported.
- `recommendation()` threshold pinned: viewings ≥ 3.
- Insights: interactive `/insights` command only (Max, human-run) — in-app LLM/API = RED.
- Phase B (do NOT build): reservations/contracts capture, `v_velocity`, `marketing_assets`,
  ilist sync, auth, hosting, multi-tenant, portal syndication, native app.
