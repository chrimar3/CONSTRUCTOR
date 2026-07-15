# IMPACT-LOOP.md — the marginal-gain design-elevation loop

*Operational document (committed process infrastructure). Supersedes the LOOP section of
`DESIGN-LOOP.md`; keeps and hardens its rubric (Benchmarks B) and anti-drift protocol.
Design + plan: `docs/design-loop/2026-07-15-impact-loop-{design,plan}.md`. Rationale: ADR-0036.*

## GOAL

Raise Constructor's design quality to **honest composite ≥ 8.5/10** on every canonical
screen — Tier **T3 (Reference-grade)** — without regressing any objective gate, by, each
round, finding and fixing the single **highest-leverage** item. The loop ends at T3 + human
sign-off, or when two consecutive rounds produce < ε improvement (then: human review).

## Why "honest": the score cannot drift

Round 0's panel scored 6.29 because it had no objective tether — it praised a 100%-off-brand
palette as "warm 8". The IMPACT-LOOP binds every subjective judgement to objective fact:

```
score_d(s) = α_d · O_d(s)  +  (1 − α_d) · min( S_d(s), cap_d(s) )
```

- **O** = machine-measured facts (palette-compliance, contrast, type-scale, honey budget,
  touch targets) — reproducible, ungameable (`scripts/design/objective.ts` + `palette.ts`).
- **S** = the blind panel, but **capped by O**: `cap_warmth = 3 + 6·palette_on_target_share`,
  etc. A screen that is 0% on-palette *cannot* score warm 8 (Round 0's board: 8 → 2.94).
- Judges score a researched **reference ladder** (2/5/8/10, `reference-ladder/ladder.ts`) and
  pass a **calibration gate** (a judge who misreads the known anchors is discarded).
- Every round reports an explicit **Objective vs Subjective split**; if S floats far above the
  capped composite, the panel is generous → recalibrate before trusting the round.

## Tiers (each gate is un-fakeable — a failing objective gate blocks the tier)

| Tier | Name | Objective gate | Subjective floor |
|---|---|---|---|
| T0 | Functional | (baseline) | ~5–6 |
| T1 | Coherent | off-palette < 40% · 0 off-scale type | overall ≥ 6.5 |
| T2 | Branded | palette ≥ 90% · honey correct · AA everywhere | overall ≥ 7.5 · no screen < 6.5 |
| T3 | Reference-grade | ALL objective gates PASS | overall ≥ 8.5 · no screen < 7.5 · human sign-off |

## THE LOOP

```
MEASURE     Run the honest benchmark. Per-screen × per-dimension scores, O/S split +
            drift check, objective gate deltas. Drift flagged → recalibrate first.
ENUMERATE   Candidate levers from: failing/weak objective gates · low subjective
            dimensions × weight × headroom · a research/critique pass (blind spots).
RANK        ExpectedLift = Σ_(s,d) weight_d · min(headroom_d(s), gain_d(s|lever))
            Priority = ExpectedLift / effort   → the impact ledger (ranked backlog).
RESEARCH    Validate the top lever(s) against best practice; research if uncertain.
IMPLEMENT   The single top lever, under ALL rails — TDD, ZONING, gates, ONE commit,
            ADR. One lever/round so the composite delta is causally attributable.
VERIFY      Re-measure. Record predicted ExpectedLift vs actual Δcomposite (the ledger
            learns). HARD: no objective gate may regress.
CHECKPOINT  Crossing a tier → Christos visual sign-off (human veto is final).
PLATEAU     Realized lift < ε (0.15) for 2 rounds → broader research; if exhausted →
            human review of the rubric/architecture.
EXIT        T3 reached AND human sign-off.
```

## Running it

```bash
# Mechanical gates only (fast, deterministic, no panel):
bash scripts/design-gates.sh

# One full round — blind panel → honest benchmark → impact ledger → recommendation:
#   Workflow: .claude/workflows/impact-loop.js  (run by name once the session reloads
#   the registry, or by scriptPath). Returns a PROPOSAL — it does NOT implement the lever.
```

Outputs land in `artifacts/design/round-0/` (gitignored, regenerable): `benchmark.json`
(honest scores + O/S split), `ledger.json` (tier + impact-ranked backlog + recommendation).

## Scope & rails

- Levers are ranked wherever the rubric rewards them (including high-weight **information
  completeness**), but bounded by `.claude/ZONING.md`: GREEN/YELLOW auto-eligible; **RED
  levers are surfaced in the ledger for a human ruling, never auto-taken**.
- The Workflow **proposes**; it never implements a lever. Implementation is a separate,
  human-gated round: one lever = one commit = one ADR = one attributable score move.
- The honest benchmark runs on the **isolated fixture DB**, never `constructor.db`.
- The design gates are a **separate rail** from `verify-gates.sh`; they merge into it only
  at T3 by human ruling.

## Config (YELLOW — ratified after the first calibrated run, reviewed vs the O/S split)

`ALPHA` (per-dimension O weight) and the cap coefficients live in `scripts/design/benchmark.ts`;
tier thresholds in `tier.ts`; `drift_threshold` (1.5) + plateau `ε` (0.15). The provisional
neutral palette hexes in `palette.ts` await the external Elevation Plan's exact values.
