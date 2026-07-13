# MODEL-OPERATIONS.md — running this project on any model without quality loss

Principle: quality here comes from **rails, not raw capability**. Judgment that a strong
model exercises implicitly has been encoded as (1) executable gates, (2) blocking hooks,
(3) literal decision trees, (4) knowledge files. A weaker model that follows the rails
produces the same output; a strong model gets the same rails as a floor.

## The enforcement stack (what protects quality mechanically)

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Hooks (blocking, pre-action) | `.claude/hooks/guard-bash.py`, `guard-writes.py` via `.claude/settings.json` | `git add -A`, force-push, `--no-verify`, writes to specs/.specify/schema.sql, gate tampering, LLM API calls, destructive SQL |
| 2. Executable gates | `bash scripts/verify-gates.sh` | Article II/III/IV violations, ICU/wall-clock in reports, failing suite, PII-key fallback |
| 3. Schema-parsing tests | `tests/labels.test.ts` etc. | New enum without a Greek label; whitespace next_action |
| 4. Knowledge files | `CLAUDE.md` → `docs/CODEBASE-KNOWLEDGE.md` | Traps, conventions, error-layering — read, don't rediscover |
| 5. Decision tree | CLAUDE.md "Article X zones — literal triggers" | YELLOW/RED classification without taste |
| 6. Human checkpoints | REBUILD-RUNBOOK.md | Everything the above can't |

Rules 1–3 are deliberately NOT overridable by the working model. If a gate or hook seems
wrong, the model must say so and stop — fixing the check to make work pass is the
canonical weak-model failure and is treated as a RED violation.

## Model routing (who runs what)

- **Sonnet-tier — safe with rails**: mechanical, fully-briefed tasks: test-only tasks
  (T008-style), small endpoint extensions (T010-style), CLI printers (T019-style),
  seed/fixture authoring, doc updates. Requirements: hooks active, run
  `verify-gates.sh` before commit, follow THE LOOP literally, never classify zones
  itself — anything not plainly GREEN on the decision tree escalates.
- **Opus-tier — standard build work**: full task execution (API server, query-layer
  extensions, UI work, standard reports), driving the phase workflow, checkpoint
  package assembly. May log YELLOW ADRs using the decision tree; RED always escalates.
- **Fable/strongest-tier — judgment work**: security/crypto (T008a-class), period/window
  math and determinism design (T017-class), audits, RED-zone analysis and options for
  the human, spec/constitution amendments after rulings, anything the tree labels
  "ESCALATE", post-phase infrastructure updates (this file, gates, hooks).
- **Human only**: RED rulings, checkpoint approvals, one-way doors, spec changes.

Workflow support: each task in `.claude/workflows/constructor-rebuild.js` may carry a
`model` field ('sonnet' | 'opus' | omitted = session model). Routing is data in the
script, not a per-run judgment call. Default when unsure: omit (inherit strongest).

## Downshift protocol (before letting a weaker model drive)

1. Verify rails: `.claude/settings.json` hooks present; `bash scripts/verify-gates.sh`
   passes on a clean tree; `bun test` green.
2. The weaker model's session prompt is the REBUILD-RUNBOOK kickoff prompt — unchanged.
   The runbook, CLAUDE.md, and briefs carry the quality; do not hand-improvise prompts.
3. Spot-check its first task end-to-end (diff + gates + commit message) before letting
   it continue. One bad task = stop, review rails for the gap, patch the rail (not the
   model prompt), re-run the task from the workflow cache.
4. Escalation is cheap and expected: a weaker model saying "this is beyond my brief" is
   the system working — route that task to a stronger model, keep the rest downshifted.

## What was learned the hard way (why these rails exist)

- SQLite `trim()` ≠ JS trim → a DB CHECK can silently under-enforce → gate 2 probes the
  actual constraint with real whitespace variants (never trust the constraint text).
- `args` can arrive as object OR JSON string → workflow parses both (never assume shape).
- Prompt *mentions* of skills ≠ skills *read* → conditional skills are named per-task in
  briefs, unconditional ones verified by transcript audit.
- A fixture can defend a defect (test copied from corrupt data) → gates probe schema
  from source, not from fixtures.
- "Verbatim" claims need mechanical proof → gate diffs schema.sql against data-model.md
  blocks (audit does the same).
