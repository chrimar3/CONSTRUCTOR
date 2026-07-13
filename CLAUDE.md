# CLAUDE.md — Constructor (sales-operations prototype)

Spec Kit project: a real-estate agency acting as the **outsourced sales department** for
construction firms. Binding law lives in the spec documents; this file is the operating
manual. When in doubt, the constitution wins.

> COMPLEMENTS the global `~/CLAUDE.md`; where they conflict, THIS file wins. In
> particular the global React/Jest/ESLint/Prettier web-app config does NOT apply:
> stack is Bun-native (`bun test`, `bun:sqlite`, `Bun.serve`), no ORM, no Jest,
> no CSS framework, zero runtime deps beyond {react, react-dom, lucide-react} (web only).

## GOAL (Phase A — definition of done)

The loop runs end-to-end: **capture (Lead/Viewing/Offer) → live pipeline board →
one-command Greek builder report**, SC-1..SC-6 verified in `VERIFICATION.md` (T020),
then STOP for human review. Anything beyond `specs/001-sales-pipeline-mvp/spec.md`
scope is RED — no exceptions for "obviously useful" additions.

## Session bootstrap (deterministic — do this before any work)

1. `bash scripts/state.sh` — branch, last task, tree, tests. State lives in git, never
   in conversation memory. Rerun after any interruption or context compaction.
2. Read `.specify/memory/constitution.md` (BINDING, 10 Articles), then
   `specs/001-sales-pipeline-mvp/{spec,plan,data-model,tasks}.md`.
3. Read `docs/CODEBASE-KNOWLEDGE.md` — file map, conventions, TRAPS (things that look
   wrong but are right, and things that look fine but are violations). Do not
   rediscover or "fix" deliberate design.
4. Read `DECISIONS.md` — locked decisions, **Standing human rulings** (bind you),
   current run's ADRs. Read `.claude/ZONING.md` — you will use it on every change.
5. Rebuild driving: `REBUILD-RUNBOOK.md`. Model routing: `MODEL-OPERATIONS.md`.

## THE LOOP (per task — no exceptions)

```
1. RED      Failing test first (read .claude/skills/test-driven-development/SKILL.md).
            Run it; confirm it fails for the RIGHT reason. Paste the RED output into
            your task notes/summary.
2. GREEN    Minimal implementation. Run the FULL suite (bun test), not just your file.
3. REFACTOR Only on green. Boring, direct code (Article VIII).
4. ZONE     Run .claude/ZONING.md top-to-bottom on your change. GREEN → proceed.
            YELLOW → append ADR to DECISIONS.md NOW, include it in your commit.
            RED → STOP and ask the human. Unsure = RED.
5. VERIFY   bash scripts/verify-gates.sh  — must print ALL GATES PASS.
            Writes in src/db → .claude/checklists/per-write.md.
            Report code → .claude/checklists/per-report.md.
            Unexpected red at any point → .claude/skills/systematic-debugging/SKILL.md
            (root cause BEFORE any fix). Before claiming done →
            .claude/skills/verification-before-completion/SKILL.md (fresh evidence only).
6. COMMIT   One commit per task, message "TXXX: …" + Co-Authored-By trailer. Stage by
            explicit path. Git hooks re-run the gates and check the message — if a
            hook blocks you, fix the cause. NEVER the hook, NEVER --no-verify.
7. CHECKPOINT? If tasks.md marks one: STOP, present evidence, WAIT for the human.
```

## Enforcement stack (rails are not suggestions)

Mechanical layers below you: Claude hooks (`.claude/hooks/` — block RED file writes,
`git add -A`, LLM tokens, fail-open secrets, Phase-B tokens) · git hooks
(`scripts/git-hooks/` — gates on every commit, message discipline) · executable gates
(`scripts/verify-gates.sh`) · schema-parsing tests. If any rail blocks you and seems
wrong, SAY SO and stop — adjusting a rail to make work pass is the canonical failure
this project is built to prevent, and rail files are themselves write-protected.

## Hard invariants (the ones easiest to break)

- **Article II**: no opportunity/event with empty/whitespace `next_action` — JS guard
  before the DB, strengthened SQL CHECK behind it (standing ruling), UI submit-disable.
- **Article IV**: PII only in `buyer_identity` via `src/db/identity.ts` (AES-256-GCM,
  key ONLY from `CONSTRUCTOR_PII_KEY`, fail-secure). Analytics never touch identity;
  erasure needs no key; PII never in reports/queries/logs/errors.
- **Article III**: report numbers from SQL only; no LLM call anywhere in the app;
  byte-determinism (no wall-clock in report paths, no ICU formatting — `formatEuro`).
- **FR-11**: stored enum keys render ONLY via `src/domain/labels.ts` (approved wording
  is human-ruled — do not re-open). **Article V**: micro_area everywhere, never coarser.
- **Article VI**: no zero/cold metric without an adjacent recommendation().

## Commands

```bash
bash scripts/state.sh        # where am I (start here, always)
bun test                     # full suite
bash scripts/verify-gates.sh # ALL constitution gates — THE gate before any commit
bun run db:init              # idempotent
bun run dev                  # API + web (phone viewport for UX checks)
bun run report --builder="…" --project="…" --period=biweekly|monthly|quarterly
```

## Quality bar (within scope — scope itself never moves)

- **UX (Article I)**: mobile-first, every capture ≤30s one-handed, ≥44px targets,
  structured inputs over keyboards, needs-attention-first board, save feedback.
- **TDD**: tests named for the requirement they pin ("Article II: …", "FR-13: …").
- **Design**: pure domain (no I/O) → queries own all SQL → API thin validator →
  web thin client. Dependencies point inward. Errors: capture paths throw loudly at
  the boundary (Greek 400s at the API); report path is total and never throws.

## Checkpoints (STOP and wait at each)

CHECKPOINT 0 after T006a · CHECKPOINT 1 after T013 (human phone-viewport pass) ·
CHECKPOINT 2 after T019 (reports <5s, Greek, zero naked bad numbers, byte-identical
re-run) · FINAL after T020. Criteria detail: REBUILD-RUNBOOK.md.

## Locked decisions (rationale in DECISIONS.md — do not revisit)

Grain buyer↔project (`UNIQUE(buyer_id, project_id)`, `focus_unit_id`) · operators
Χρήστος/Λωίδα/Γιολάντα → `handled_by`, no real auth · counter 0.6/€500 (value=YELLOW,
determinism=RED) · fixed non-overlapping periods + `--rolling`/`--as-of` ·
recommendation threshold viewings ≥ 3 · insights via human-run `/insights` only ·
label wording per CHECKPOINT-0 ruling · Phase B stays dark: reservations/contracts
capture, `v_velocity`, `marketing_assets`, ilist, auth, hosting, multi-tenant,
portal syndication, native app.
