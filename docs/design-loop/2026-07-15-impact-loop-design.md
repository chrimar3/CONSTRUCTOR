# IMPACT-LOOP — design spec (2026-07-15)

*A marginal-gain design-elevation loop for Constructor. Supersedes the LOOP section
of `DESIGN-LOOP.md`; keeps and hardens its rubric (Benchmarks B) and anti-drift
protocol. Status of this file: design spec (brainstorming output). The operational
doc it authorizes is `IMPACT-LOOP.md` at repo root.*

## 1. Problem this solves

Round 0 produced a composite of **6.29/10** that is not trustworthy. The blind panel
had no real reference and no objective tether, so it praised the current generic
Tailwind palette as "warm, elegant office" (board warmth 8) **while the mechanical
token gate reports that palette 100 % off-target**. A loop that optimizes a drifting
score optimizes noise.

Three things must change:

1. **The score must not be able to drift** — subjective judgment is bound to objective fact.
2. **Progress must be tiered** — named milestones with hard gates, not one moving number.
3. **Each round must spend effort on the single highest-leverage lever** — chosen by a
   computed, explainable impact estimate, researched when uncertain, and *verified* to
   have delivered the predicted lift.

## 2. The honest benchmark (the un-driftable score)

The score is composed of two bound layers, reported both blended and split.

### 2.1 Objective layer O — facts, reproducible, ungameable

Extends the Round-0 mechanical gates. Per canonical screen `s`, machine-measured
sub-scores in [0,10] for the properties a machine *can* judge:

- **palette-compliance** — share of painted area + used colors that are on the «Πεύκο & Μέλι» token set.
- **contrast** — share of text pairs clearing WCAG AA.
- **type-scale adherence** — share of font sizes on the pinned scale {13,15,17,20,24}; tabular-nums present on money/counts.
- **honey-correctness** — honey present on money/save surfaces AND ≤5 % of painted pixels.
- **tap economy** — SC-1 tap counts within budget (Lead ≤6 · Επίσκεψη ≤5 · Προσφορά ≤11).
- **touch targets** — share of interactive elements ≥44×44.

### 2.2 Subjective layer S — the blind panel, hardened

The Benchmarks-B rubric (7 weighted dimensions) is retained verbatim. Three additions
make its numbers mean something:

1. **Reference ladder.** Every judge scores each frame *relative to* a researched ladder
   of real best-in-class product screens pinned at levels **2 / 5 / 8 / 10** (sourced by
   the research pass — §5). The ladder ships in every judge deck; "10" stays expensive
   because a real 10 is visible beside the work.
2. **Objective caps.** Each subjective dimension is capped by the objective reality it
   depends on, so praise of off-brand work is impossible. Cap functions (coefficients
   YELLOW-tunable, ratified at first calibrated run):
   - `cap_warmth(s)  = 3 + 6·palette_on_target_share(s)`  → 0 % on-palette caps warmth at 3; only a fully realized palette permits 9.
   - `cap_typography(s) = 3 + 6·type_scale_adherence(s)`
   - `cap_hierarchy(s)  = 4 + 6·contrast_pass_rate(s)`  (a screen failing AA cannot read as strong hierarchy)
   - `completeness`, `gravitas` have no machine proxy → **no cap** (pure ladder-anchored S).
   - `ergonomics` capped by touch-target + tap-economy pass.
3. **Calibration gate.** Each judge first scores the ladder itself. A judge who rates the
   known-8 exemplar ≤6 or the known-2 ≥5 is miscalibrated → discarded and replaced
   (extends the existing transcript-audit discard mechanism).

### 2.3 Composite

Per screen `s`, per dimension `d` (with per-dimension objective weight `α_d ∈ [0,1]`):

```
score_d(s) = α_d · O_d(s)  +  (1 − α_d) · min( S_d(s), cap_d(s) )
Composite(s) = Σ_d  weight_d · score_d(s)
Overall      = mean_s Composite(s)      (also report min_s Composite(s))
```

Suggested α (ratified at first run): warmth 0.5 · typography 0.5 · hierarchy 0.3 ·
ergonomics 0.6 · responsiveness 0.3 · completeness 0.0 · gravitas 0.0. Dimensions with
no O (`completeness`, `gravitas`) are pure capped/anchored S.

**Split reporting.** Every round reports `O_composite(s)` and `S_composite(s)`
separately. If `S_composite − O_composite > drift_threshold` (default 1.5) the panel is
being generous relative to the facts → flagged for recalibration *before* the round is
trusted. This is the drift alarm Round 0 lacked.

## 3. Tier ladder

Named milestones; each requires its objective gate green AND its subjective floor. A tier
cannot be claimed while any of its objective gates fail — tiers are as un-fakeable as the
score.

| Tier | Name | Objective gate | Subjective floor |
|---|---|---|---|
| **T0** | Functional | (baseline) | ~5–6 (where we are) |
| **T1** | Coherent | off-palette < 40 % · 0 off-scale type on primary surfaces | overall ≥ 6.5 |
| **T2** | Branded | palette ≥ 90 % on-target · honey correct · AA everywhere | overall ≥ 7.5 · no screen < 6.5 |
| **T3** | Reference-grade | ALL objective gates PASS · no gate regressed | overall ≥ 8.5 · no screen < 7.5 · human sign-off |

T3 is the loop's exit.

## 4. The loop

```
MEASURE     Run the honest benchmark (§2). Per-screen × per-dimension scores, the
            O/S split + drift check, objective gate deltas. If drift flagged →
            recalibrate the panel before trusting the round.
ENUMERATE   Candidate levers from three sources: (a) failing/weak objective gates,
            (b) low subjective dimensions × high weight × headroom, (c) a research/
            critique pass naming the highest-leverage missing thing (blind spots the
            formula can't see, e.g. "the whole layout is wrong").
RANK        ExpectedLift(L) = Σ_(s,d)∈affected(L)  weight_d · min( headroom_d(s), gain_d(s|L) )
            headroom_d(s) = ceiling_d(s) − score_d(s)   (ceiling = current tier target, else 10)
            gain_d(s|L)   = lever's declared/estimated points added to (s,d)
            Priority(L)   = ExpectedLift(L) / Effort(L)      → the impact ledger (ranked backlog)
RESEARCH    For the top lever(s), if the gain estimate is uncertain, do proper research
            (best-practice patterns, real exemplars) BEFORE building.
IMPLEMENT   The single top lever, under ALL rails — TDD, ZONING, gates, ONE commit, ADR.
            One lever per round so the composite delta is causally attributable.
VERIFY      Re-measure. Record predicted ExpectedLift vs actual Δcomposite (the ledger
            learns: a per-lever-type calibration factor refines future estimates).
            HARD: no objective gate may regress; a regression fails the round.
CHECKPOINT  Crossing a tier → Christos visual sign-off (human veto is final).
PLATEAU     "When we can't make a difference": if the top lever's realized lift < ε
            (default 0.15) for 2 consecutive rounds → escalate to broader research; if
            genuinely exhausted → surface to human (the rubric or the current
            architecture is the ceiling).
EXIT        T3 reached (§3) OR plateau → human review of the rubric itself.
```

## 5. Components to build

- **`scripts/design/benchmark.ts`** — the honest composite: consumes the objective audit
  (extends `gates.ts`) + the panel output, applies caps + α-blend, emits per-screen ×
  per-dimension scores, the O/S split, and the drift flag. Pure given its two JSON inputs → testable.
- **`scripts/design/impact-model.ts`** — pure lever enumeration + `ExpectedLift`/`Priority`
  ranking from the benchmark JSON + a **lever catalog** (each lever declares its
  `affected(s,d)` set + a `gain` model + an effort estimate). Fully unit-testable (TDD).
- **`scripts/design/reference-ladder/`** — researched exemplars: per level {2,5,8,10} an
  anchor image (where sourced) + a cited textual descriptor of what that level looks like
  on a mobile CRM screen. Consumed by the panel deck + the calibration gate.
- **Judge Workflow v2** — ladder-anchored, calibration-gated, cap-aware; still blind,
  neutral-shuffled, disjoint personas, median. Extends the Round-0 workflow.
- **`IMPACT-LOOP.md`** (repo root) — the operational loop doc. Keeps DESIGN-LOOP's rubric
  + anti-drift, adds §2 caps/ladder/calibration, §3 tiers, §4 loop. `DESIGN-LOOP.md`
  gets a pointer note (it is not guard-protected).
- **Impact-ledger artifact** — per round: the ranked backlog, the chosen lever, predicted
  vs actual lift, tier status, O/S split. The running record of how the score was earned.

## 6. Scope, rails, isolation

- Levers are ranked wherever the rubric rewards them — **including high-weight
  information completeness (20 %)**, not only palette — but every lever is bounded by
  `ZONING.md`: GREEN/YELLOW auto-eligible; **RED levers are surfaced in the ledger for a
  human ruling and never auto-taken**. Spec/schema/Phase-B remain RED.
- One lever = one commit = one ADR = one attributable score move.
- Isolation: `impact-model.ts`, `benchmark.ts`, the cap/O-scorer functions are pure and
  unit-tested; capture + panel are browser-coupled and verified live (the Round-0 pattern).
  The benchmark runs on the isolated fixture DB, never `constructor.db`.
- The design gates stay a **separate rail** from `verify-gates.sh`; they merge into it only
  at T3 by human ruling.

## 7. Testing

- **impact-model.ts** — TDD: synthetic benchmark fixture with known headrooms → asserts the
  ranking order and that a palette-wide lever outranks a single-screen contrast fix; assert
  the fixture precondition (headrooms are non-trivial) so it can't go vacuous.
- **benchmark.ts** — deterministic composite over a synthetic (O,S) fixture; assert a cap
  actually binds (S=9, palette 0 % → warmth ≤3) and that the drift flag fires when S≫O.
- **cap/O-scorers** — extend `palette.test.ts` pins.
- **panel v2 + ladder** — verified live; the calibration gate is exercised with a
  deliberately miscalibrated synthetic judge response.

## 8. First round preview (computed fresh, not assumed)

By the formula the likely top lever is a **«Πεύκο & Μέλι» design-token layer** (CSS custom
properties for palette/type/space, applied across all 8 screens): it raises `cap_warmth`
from 3→9 across every screen (15 % weight × 8 screens × large headroom) and lifts the
`cap_typography` cap by defining the pinned type scale, closing the palette + type objective
gates simultaneously — the textbook highest-leverage move. (It does **not** by itself lift
`cap_hierarchy`, which is contrast-driven — that belongs to the contrast lever; crediting it
here would double-count. Correction confirmed by the Round-1 research pass, 2026-07-15.)
Second likely: information completeness on the weak PIN/operator screens (20 % weight,
currently ~3). The loop recomputes this from the live benchmark rather than presuming it.

## 9. Open items (ratified at first calibrated run)

- Exact α_d and cap coefficients (YELLOW — ratified after the first calibrated benchmark,
  reviewed against the O/S split).
- Reference-ladder image sourcing: textual cited descriptors are the floor; representative
  anchor images are sourced by the research pass where licensing allows (else descriptor-only).
- `drift_threshold`, plateau `ε`, per-tier gate thresholds (YELLOW — first-run calibrated).
