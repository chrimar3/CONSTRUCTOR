# Pipeline — Spec Kit handoff (for autonomous execution)

Spec-Driven Development file set for the agency's sales-operations prototype. Hand this to an autonomous coding agent (Fable) and it has the full context to build the prototype without hand-holding.

## What's here

```
.specify/memory/constitution.md          # non-negotiable principles (agent must not drift)
.claude/commands/insights.md             # interactive Claude Code cmd: insight brief → Greek insight lines (Max)
DECISIONS.md                             # Article X yellow-zone decision log (agent appends)
specs/001-sales-pipeline-mvp/
  spec.md         # WHAT & WHY — user stories, requirements, success criteria (no tech)
  plan.md         # HOW — Bun/TS/SQLite stack, constitution check, architecture, phases
  data-model.md   # SQLite schema + constraints + metric views
  tasks.md        # ordered, test-first, committable tasks with CHECKPOINTS
  quickstart.md   # run & verify
```

## Two ways to run it

### A) Through Spec Kit tooling (recommended)
```bash
uvx --from git+https://github.com/github/spec-kit.git specify init pipeline --integration claude
# copy this .specify/ and specs/ over the initialized project, then:
# /speckit.analyze     → catch any gaps/violations first
# /speckit.implement   → agent executes tasks.md
```

### B) Direct autonomous handoff
Point the agent at this folder with: *"Read constitution.md, then specs/001-sales-pipeline-mvp/. Execute tasks.md in order, test-first, one commit per task. STOP at every CHECKPOINT and wait for my review. Do not exceed the spec's scope."*

## Autonomous execution guardrails (important)

- **Constitution is binding.** If a task would violate an Article, the agent stops and asks — it does not "work around" it. The two hardest invariants: **no opportunity without a next-action** (Article II) and **PII separated + encrypted** (Article IV).
- **Bounded autonomy (Article X).** The agent acts freely on implementation detail (GREEN), acts-and-logs on trade-off decisions (YELLOW → `DECISIONS.md`), and stops-and-asks on Article-touching / scope-expanding / one-way-door choices (RED). You review the YELLOW log at each checkpoint — that is where the extra autonomy lives, without silent drift.
- **Stop at CHECKPOINTS.** Four of them (end of Phase 0/1/2 + final). The agent must not blow through them. This is your human-in-the-loop.
- **Test-first, per-task commits.** If the agent starts writing implementation before a failing test, that's a drift signal.
- **Scope discipline.** ilist sync, auth, hosting, multi-tenant = explicitly out of scope. If the agent starts building those, redirect it — that's Phase B / later.
- **Greek product surface.** All UI strings and generated reports in Greek; the agent's own notes/specs stay English.
- **Determinism & Max-native AI.** Report numbers come only from SQL; the app **never** calls an LLM API. Insight prose is generated out-of-band via an interactive Claude Code slash-command (`.claude/commands/insights.md`) under your Max subscription — **no API key anywhere in the system** (build or run).

## Definition of done (prototype)
The loop runs end-to-end: **capture (Lead/Viewing/Offer) → live pipeline → one-command Greek builder report**, with SC-1..SC-6 from spec.md verified in `VERIFICATION.md`. Then stop for review before Phase B.

---
*Design note: this prototype is Phase A — dogfood in the agency's own office first. Every decision here (mandatory next-action, micro-area granularity, report-as-forcing-function, handled_by separation test) exists to make the accumulated data the moat later, not to make the app pretty now.*
