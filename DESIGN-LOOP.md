# DESIGN-LOOP.md — the goal-based loop for elevating Constructor's design/UX/UI

*Operational document (committed process infrastructure, like REBUILD-RUNBOOK.md).
Companion rationale: the UX/UI Elevation Plan artifact. Direction: «Πεύκο & Μέλι».*

## GOAL

Raise Constructor's measured design quality from its baseline to **composite ≥ 8.5/10**
across the benchmark rubric below, on every canonical screen and the builder report,
in both themes — **without ever regressing a hard gate**. The loop ends when the target
is beaten and Christos signs the visual checkpoint, or when two consecutive rounds
produce no measurable improvement (then: human review of the rubric itself).

## The direction being scored against (summary — full tokens in the Elevation Plan)

- Palette «Πεύκο & Μέλι»: alabaster/espresso grounds · warm ink · Aegean-pine accent
  `#14555A`/`#4FA3A8` · ONE honey signal `#C89B3C`/`#D9AE55` (≤5% of any screen, money
  and save-moment only) · temperature trio where Ψυχρός is the palette's only cool hue.
- Type: Commissioner (Greek-native, self-hosted woff2) UI · Literata headings in the
  report · tabular numerals wherever money or counts appear · pinned scale 13/15/17/20/24.
- Space/shape: 4pt grid · radius language 14/999/20/12 · hairlines + one warm shadow level.
- Motion: 120ms states · one choreographed save moment · `prefers-reduced-motion` collapses all.

## BENCHMARKS — two kinds, never confused

### A. Mechanical gates (scripted, binary, run every round — `scripts/design-gates.sh` to be built in Round 0)

| Gate | Check | Bar |
|---|---|---|
| Tap economy | SC-1 harness tap counts | Lead ≤ 6 · Επίσκεψη ≤ 5 · Προσφορά ≤ 11 — NEVER regresses |
| Contrast | every token pair, both themes | WCAG AA (4.5:1 text, 3:1 UI) |
| Touch targets | DOM audit of interactive elements | ≥ 44×44px, all |
| Token compliance | computed styles vs token list | 0 off-palette colors; honey ≤ 5% of painted pixels |
| Type discipline | computed font sizes vs scale | 0 off-scale sizes; money elements have tabular-nums |
| Determinism/suite | `bun test` + `verify-gates.sh` | all green, byte-stable report |
| Perf floor | board render on seeded data | interactive < 1s on LAN |

Mechanical gates are pass/fail. A failing gate blocks the round from even reaching judging.

### B. Judged dimensions (panel-scored 1–10 from the fixed screenshot suite)

| Dimension | Weight | What 9–10 looks like |
|---|---|---|
| Visual hierarchy | 20% | The eye lands on next-action → € figure → urgency, in that order, unprompted |
| Information completeness | 20% | Card answers who/where/what/when/how-much without a tap (staleness, delta, last event) |
| Warmth & brand coherence | 15% | Reads "elegant Greek office", not "generic SaaS"; palette discipline felt, not noticed |
| Typography craft | 15% | Scale rhythm, Greek text sits beautifully, money reads as data |
| Perceived responsiveness | 10% | State changes visible and instant; the save moment lands |
| Capture ergonomics | 10% | Sheets feel one-handed; selected states unmistakable in sunlight |
| Report gravitas | 10% | A builder would forward it to a partner without embarrassment |

**Composite = weighted mean, reported per screen and overall, per theme.**

## Anti-drift protocol (what makes the scores mean something)

1. **Fixed screenshot suite**: the 8 canonical frames (PIN, operator, board, 3 sheets,
   biweekly + monthly report) on the SAME seeded fixture, same viewport (390×844@2x),
   both themes — 16 images per round, captured by the existing Puppeteer harness.
2. **Pinned rubric + blind judging**: judges (3 independent agents, median taken) receive
   the rubric verbatim + the screenshots WITHOUT round numbers or diffs — they never know
   if they're scoring "before" or "after".
3. **Control frame**: one deliberately UNCHANGED screen ships in every round's deck.
   If its median score moves > 0.5 between rounds, the panel has drifted — recalibrate
   before trusting that round (baseline-rot lesson: re-sample before regression claims).
4. **Reference anchors**: judges get 2 reference images (a Linear mobile view, a
   Pipedrive deal card) pinned as "this is an 8" so 10 stays expensive.
5. **Human veto is final**: a round can beat every number and still be rejected at the
   visual checkpoint. Numbers converge; Christos decides.

## Judge isolation (validity guarantees — structural, then audited)

Judges and implementers are **disjoint, memoryless agent processes**. Beyond that:

1. **Evidence-only input.** A judge receives exactly: the rubric (verbatim from this file)
   + the screenshot deck + the two reference anchors. It is instructed to open NOTHING
   else — no repo files, no git log, no DECISIONS.md — and its transcript is audited
   after each round to prove it (the same tool-call audit used for skill compliance;
   a judge that peeked is discarded and replaced, its score excluded).
2. **Neutral, shuffled decks.** Frames are copied to neutral ids (frame-a.jpeg …) in a
   different random order per judge — filenames can't whisper "after" or "board-v2",
   and position effects wash out across the panel.
3. **Pinned prompt, no per-round framing.** The judge prompt is fixed in this file and
   may not be edited between rounds (editing it = a ruling). The orchestrator physically
   cannot add "we just improved the cards, please score" — the prompt has no slot for it.
4. **Fresh panel every round.** No judge instance ever scores twice; there is no memory
   of prior rounds to anchor on. The control frame catches panel-level drift anyway.
5. **Different lens per judge.** The three judges score the same rubric but each is
   assigned a distinct persona (field-operator pragmatist · brand/typography critic ·
   builder-client) — diversity of failure modes beats three identical opinions, and the
   median absorbs any one persona's bias.
6. **Implementer blindness.** Elevation-round agents get the previous round's SCORES
   (they must know what to fix) but never the judges' prose, personas, or identities —
   no writing-to-the-grader.

## THE LOOP

```
ROUND 0  BASELINE  Build scripts/design-gates.sh · capture the 16-frame suite on the
                   CURRENT app · run mechanical gates · judge panel scores it.
                   → Baseline report artifact. Human ratifies the 8.5 target (or moves it).
ROUND N  ELEVATE   1. Pick the lowest-scoring dimension × highest-weight surface.
                   2. Implement as a specialist run under ALL existing rails
                      (TDD, gates, one commit, ADRs; ZONING on every change).
                   3. Mechanical gates — any fail: fix before judging.
                   4. Re-capture the suite · blind panel · control-frame check.
                   5. Composite improved? → screenshots artifact → CHRISTOS visual
                      checkpoint → approved: next round. Not improved twice → stop,
                      review rubric with human.
EXIT               Composite ≥ 8.5 overall AND no screen < 7.5 AND human sign-off.
                   → Record final scores in DECISIONS.md; the mechanical gates join
                     verify-gates.sh permanently (design quality becomes a rail).
```

Expected shape: Round 1 = Pass 1 (tokens + board info layer), Round 2 = Pass 2 (sheets),
Round 3 = Pass 3 (report). The loop happily reorders based on what the scores say.

## Kickoff prompt (paste to start ROUND 0)

> Read CLAUDE.md, DESIGN-LOOP.md, and the UX/UI Elevation Plan artifact. Execute
> ROUND 0 only: build scripts/design-gates.sh (mechanical gates as specified), capture
> the 16-frame baseline suite with the existing Puppeteer pattern on seeded fixture
> data, run the mechanical gates on the current app, then run the blind 3-judge panel
> per the anti-drift protocol. Deliver: the baseline scores table (per screen, per
> theme, per dimension), the failing mechanical gates list, and a screenshots artifact
> — then STOP for my target ratification before any elevation round. Use a workflow —
> standing opt-in for the judge panel fan-out.

---
*Zone status: this loop is process infrastructure (GREEN to operate); every code change
inside a round obeys ZONING.md as always. The rubric weights and the 8.5 target are
YELLOW — ratified by the human at Round 0, changed only by ruling thereafter.*
