# REBUILD-RUNBOOK — full agentic rebuild of Constructor (T001→T020)

Operator guide for re-running the entire build with the specialist-agent workflow
(`.claude/workflows/constructor-rebuild.js`) and the installed, audited skills
(`.claude/skills/` — TDD, systematic-debugging, verification-before-completion,
insecure-defaults; provenance in `.claude/skills/THIRD-PARTY-SKILLS.md`).

## GOAL

Rebuild the complete Phase A prototype — **capture (Lead/Viewing/Offer) → live pipeline
board → one-command Greek builder report** — executing ALL tasks T001–T020 via one
specialist agent per task, TDD-enforced by the installed skills, one commit per task,
independent constitution audit after every phase, human checkpoint between phases,
ending with `VERIFICATION.md` mapping SC-1..SC-6 to fresh evidence. The constitution
(`.specify/memory/constitution.md`) is binding throughout; RED-zone questions halt the
pipeline and come to the human — never worked around.

## THE LOOP (driver session — you are the orchestrator, agents do the tasks)

```
0. RESET   (once) Create the rebuild branch; clear prior task outputs (below).
1. RUN     Workflow name "constructor-rebuild", args {phase: N}   (N = 0, then 1, 2, 3)
2. WATCH   Pipeline runs task-agents sequentially; each: skills-armed TDD → full suite
           green → one commit → structured result. Independent auditor closes the phase.
3a. HALT?  An agent returned RED/blocked → bring the human the exact question →
           human rules → apply the ruling in the MAIN session (RED changes are never
           agent work) → commit → resume: same Workflow with resumeFromRunId (completed
           tasks replay from cache; only the edited/blocked task re-runs).
3b. DONE?  Read the audit verdict. Push commits. Present the CHECKPOINT package
           (below). STOP. WAIT for explicit human approval.
4. NEXT    On approval → N+1 → step 1. After phase 3: FINAL CHECKPOINT → full stop.
           No Phase B work, ever, without a new human mandate.
```

Never run phase N+1 before checkpoint N is approved. Never let an agent touch
`specs/` or resolve a RED. Push to origin after each phase, not mid-pipeline.

## Driver rules (Fable best practices — for the session running this loop)

- **State from git, never from memory.** After any interruption or context compaction,
  re-locate: `git log --oneline | grep -oE '^\S+ T[0-9]+[a-z]?' | head -1` = last done
  task; `git status --short` must be clean; `bun test` must be green. The runbook + git
  history are the full state — nothing lives only in conversation.
- **Capture the run ID** from every Workflow tool result the moment it returns. A halt,
  kill, or session restart resumes with `resumeFromRunId` — completed tasks replay from
  cache at zero cost; only the blocked/edited task re-runs.
- **Don't poll.** The workflow notifies on completion. While it runs, do nothing to the
  working tree (no edits, no commits — agents own it; concurrent writes race their
  `git add`). DECISIONS.md, if you must touch it mid-run, append-only (`cat >>`).
- **Empty or odd workflow result → read `journal.jsonl`** in the run's transcript dir
  BEFORE diagnosing. Never assume a cached agent result is non-empty.
- **Evidence before claims — driver included.** A checkpoint package contains only
  numbers you got from commands run fresh in this session (test counts, audit verdict,
  commit list). The verification-before-completion skill binds you, not just agents.
- **Report outcome-first.** Checkpoint messages open with the verdict (PASS/FAIL, counts),
  then detail. RED halts are relayed verbatim + one recommendation — no option essays.
- **Do not re-litigate standing rulings** (see DECISIONS.md "Standing human rulings") or
  locked clarifications; they bind the rebuild.

## Step 0 — RESET (run these exact commands, review each output)

```bash
cd "/Users/chrism/Project with Claude/CONSTRUCTOR"
git checkout -b rebuild/agentic-v2
# remove prior task outputs (keep: CLAUDE.md, .claude/, .specify/, specs/, DECISIONS.md,
# HANDOFF.md, README.md, REBUILD-RUNBOOK.md, .gitignore):
git rm -r --quiet src tests package.json tsconfig.json bun.lock 2>/dev/null || true
git rm --quiet .env.example seed.example.json 2>/dev/null || true
rm -rf node_modules constructor.db
```

Then restructure `DECISIONS.md`: (a) retitle "Agent decisions (YELLOW zone) — append below"
to "Archived (run v1) — prior build's decisions; new run logs its own"; (b) add a
"Standing human rulings — bind every run" section directly above it and MOVE the
RULING 2026-07-13 entry there (the strengthened Article II CHECK lives in data-model.md
and binds the rebuild); (c) re-add a fresh empty "Agent decisions (YELLOW zone) — append
below" section at the end.

Commit: `T000: reset task outputs for full agentic rebuild (runbook step 0)`.

## Checkpoint packages (what to verify before approving each phase)

- **CHECKPOINT 0** (after phase 0): audit PASS; suite green; `src/db/schema.sql` is
  verbatim data-model.md **including** the strengthened whitespace CHECK; every stored
  enum key has a Greek label.
- **CHECKPOINT 1** (after phase 1): audit PASS; then HUMAN, on a phone viewport
  (`bun run dev`): each capture flow completes in <30s (SC-1); empty next-action blocks
  submit in all three sheets (SC-2); board sorts needs-attention first; operator selector
  stamps handled_by; seeded board is non-empty (SC-6). Checklist: quickstart.md.
- **CHECKPOINT 2** (after phase 2): audit PASS; biweekly + monthly + --separation reports
  generate in one command each, <5s, Greek, zero naked bad numbers (SC-3), byte-identical
  on re-run; `--brief` output feeds `/insights` (human-run, Max) — no LLM call in-app.
- **FINAL** (after phase 3): `VERIFICATION.md` maps SC-1..SC-6 to evidence; human times
  SC-1 on the phone; full loop demo capture → board → report. Then STOP.

## RED-halt protocol

The workflow returns `{halted: '<task>', blocker: '<exact question>'}`. Options analysis
belongs to the human. Apply the ruling in the main session (schema/spec/one-way-door
changes are operator commits, recorded in DECISIONS.md as a RULING entry, like the
2026-07-13 Article II ruling). Then resume: edit the blocked task's brief in the
workflow script ONLY if the ruling changes its instructions, and re-invoke with
`resumeFromRunId` from the run's tool result.

## Kickoff prompt (paste into a fresh Fable session rooted in this directory)

> Read CLAUDE.md, then REBUILD-RUNBOOK.md, and execute the runbook exactly, following
> its Driver rules. Locate current state from git first (a partial rebuild resumes —
> never restarts). If Step 0 RESET has not run: perform it, show me the removal diff
> before committing. Then drive the phase loop: `Workflow name "constructor-rebuild"`
> with `args {phase: N}` starting at the first incomplete phase; capture the runId;
> on completion bring me the audit verdict + checkpoint package, outcome first, and
> STOP for my approval before the next phase. RED/blocked halts come to me verbatim
> with one recommendation; after my ruling, apply it yourself in the main session and
> resume with resumeFromRunId. Push to origin only at approved checkpoints. Spec scope
> is a hard boundary and the constitution is binding. Use a workflow — this is my
> standing opt-in for multi-agent orchestration for this rebuild.

## Cost / scale expectations

Each phase ≈ 6–12 sequential specialist agents + 1 auditor. Phase 1 is the largest
(11 tasks incl. the React UI). Expect the full rebuild to consume on the order of
1.5–3M tokens across all phases. Sequential by design (shared files, commit-per-task
history) — wall-clock is hours, not minutes; run phases in separate sittings if needed.
