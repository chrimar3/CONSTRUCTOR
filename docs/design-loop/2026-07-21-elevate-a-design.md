# Elevate variant A — three design refinements

**Branch:** `design/variant-a` · **Status:** approved design, pre-implementation
**Date:** 2026-07-21

> Design doc placed in `docs/design-loop/` (this repo's design-doc home) rather than the
> brainstorming skill's default `docs/superpowers/specs/` — the write-guard reserves any `specs/`
> path for the Spec Kit source of truth.

Three independent, independently-shippable refinements to the chosen design direction A
("Airbnb-warm"). One design doc; three separate commits, each with its own RED→GREEN loop.
Nothing here changes captured pipeline data, PII, labels, schema, or the report *numbers* — the
report numbers stay exactly as `biweekly.ts`/`monthly.ts` compute them today.

Governing rails (unchanged, must stay green throughout): `bun test`, `bash
scripts/verify-gates.sh` → ALL GATES PASS, `bun scripts/design/gates.ts` → 7/7. Every feature
re-captures the 8 frames and is reviewed by eye.

---

## Feature ① — Funnel bars in both builder reports

### Purpose
The reports are the client-facing deliverable (emailed / sent by Viber to construction firms).
The activity figures — inquiries → viewings → offers — currently render as a plain bulleted
list; the conversion shape they describe has no visual weight. A proportional bar funnel makes
the drop-off legible at a glance and visualises exactly what the recommendation engine reasons
about (few viewings ⇒ presentation problem; viewings but no offers ⇒ price problem).

### What renders
Under the existing `## Δραστηριότητα περιόδου` heading, in **both** the biweekly and monthly
reports, the three activity counts render as horizontal bars whose widths are proportional to
the largest of the three counts (tallest stage = 100%). Each row: stage label · proportional
bar · the integer count. The bars are **CSS `<div>`s** (a track + a filled span sized by an
inline `width` percentage), never SVG — email/Viber clients render `<div>`s reliably and strip
SVG.

```
ΔΡΑΣΤΗΡΙΟΤΗΤΑ ΠΕΡΙΟΔΟΥ

Εκδηλώσεις  ████████████████  8
Επισκέψεις  ██████████        5
Προσφορές   ████              2
```

### Design
- **Numbers stay in the generators.** `biweekly.ts` / `monthly.ts` already compute
  `totals.{inquiries,viewings,offers}`. They emit the funnel via ONE new lightweight structured
  block in the Markdown stream (exact token chosen at plan time — a fenced block or a
  role-tagged table row; it must not broaden the Markdown subset more than one well-scoped
  construct). The generators do the SQL; they do not emit HTML.
- **`html.ts` remains the sole HTML producer.** It gains one new block renderer that turns the
  structured funnel block into the bar markup. Width % = `round(count * 100 / max)` using integer
  arithmetic. The bar fill colour is a neutral ink/`--line-2`-family token already in variant A's
  report palette — it is **not** a new colour and **not** the accent (bars are data, not
  decoration).
- The plain textual counts remain present (either as the bar's trailing number or retained list)
  so nothing a reader relies on is removed.

### Invariants held
- **Article III (determinism):** integer arithmetic + static string CSS, no `Date`/`Date.now`,
  no `Intl`/`toLocaleString`. Reports re-render **byte-identically** — asserted by the existing
  determinism test and re-checked.
- **Article VI (no naked bad numbers):** a 0-count stage renders an **empty track** (width 0) and
  the existing zero-activity / recommendation line stays directly adjacent, so a bare zero can
  never stand alone. When all three are 0, the existing "Δεν καταγράφηκε δραστηριότητα" branch
  still fires; the funnel then renders three empty (width-0) tracks — safe and Article VI-paired,
  verified by the existing all-zero report tests. (As-shipped note: the funnel is NOT suppressed
  for an all-zero period; the empty-track rendering was kept because it is safe and the plain
  sentence already states the period was empty. The whole-feature review confirmed this.)
- The self-contained-document test (`tests/html.test.ts`) still holds: bars introduce no external
  resource.

### TDD
RED first in `tests/html.test.ts` (or a sibling): render a report containing the funnel block and
assert (a) three bars with widths proportional to the counts, (b) a 0 stage → width-0 track, (c)
byte-identical re-render. Synthetic fixture with an asserted precondition (the counts genuinely
differ, so proportionality is exercised).

---

## Feature ② — A restrained motion layer

### Purpose
Article I calls for "save feedback"; today the save toast is static and nothing has a pressed
state (the whole app has two CSS transitions). A small, quiet motion layer makes the app *feel*
premium in the hand. Airbnb-grade motion **confirms** actions; it never entertains — so this is
deliberately restrained, not expressive.

### What moves
1. **Save moment:** the confirmation toast slides down + fades in with its check icon, then
   auto-dismisses with a slide-up + fade after a short dwell.
2. **Press feedback:** buttons and board cards depress subtly on `:active` (~`scale(0.98)`) with a
   fast transition.
3. **Sheets:** the full-screen capture sheets slide up on open instead of snapping in.

### Design
- The app is inline-styled; `:active` and `@keyframes` cannot live in inline styles. Add a **small,
  contained CSS block** to `src/web/index.html`'s existing `<style>`: the `@keyframes`
  (toast-in/out, sheet-up) and a couple of interaction-state classes (`.press:active{…}`). Apply
  via `className` on the relevant buttons/cards/sheet — a thin, additive hook, no restructuring.
- Durations use the existing `--dur` token / small fixed values; easing is a calm ease-out, no
  spring, no bounce.
- **Everything sits under the `@media (prefers-reduced-motion: reduce)` guard already present in
  `index.html`**, which sets `transition/animation: none !important` — so the layer self-disables
  for users who ask for reduced motion. No new guard needed.

### Invariants held
Pure presentation. No behaviour, data, schema, PII, label, or report change. No new dependency.

### TDD / verification
Motion is not meaningfully unit-testable in `bun:test`; **stated honestly rather than faking a
test.** Verification is: the reduced-motion guard remains in `index.html` (a cheap assertion can
pin its presence), and the captured frames plus a manual pass confirm the states render. The
build must stay clean and all existing tests green.

---

## Feature ③ — Escalate-only board recency marker

### Purpose
`updated_at` is on every card but never shown, and the board is *already* ordered
`temperature, … updated_at ASC` — the stalest hot lead is already at the top. A quiet marker
names **why** the top card is on top, turning the board from a list into a triage tool. It is
silent by default and speaks only when action is overdue.

### Scope decision (the ruling this doc's approval authorizes)
This shows data the board does not display today, so it is a deliberate, small **scope addition**
beyond the original spec (ZONING would otherwise stop this RED). Christos's approval of this
design **is** the ruling; it will be recorded as an ADR in `DECISIONS.md`, with the thresholds
noted as a standing decision.

### Behaviour
- A pure helper `stalenessMarker(temperature, updatedAt, now)` returns `{ days }` when:
  - temperature is **hot** and untouched **> 2 days**, or
  - temperature is **warm** and untouched **> 5 days**;
  - otherwise `null`. **Cold never flags** (cold leads are expected to be dormant).
- `days` = whole calendar days between `updatedAt` and `now` (simple calendar diff; no
  weekend/business-day logic — stated explicitly).
- Thresholds are **named constants** (`STALE_HOT_DAYS = 2`, `STALE_WARM_DAYS = 5`).

### Display
A quiet `⚠ N μέρες` in the board card's top row, beside the temperature badge. Small, set in
ink/amber, **never a loud filled pill** (AVOID LIST holds). Fresh cards show nothing — the board
stays calm by default. The marker must not break the density win (it lives inline on an existing
row, adds no new row).

### Design / placement
- Helper lives in `src/web/helpers.ts` (pure, `now` injected — no clock inside the helper).
- `App.tsx` computes `now` once per render with `new Date()` and passes it down. **Rails:** the
  Article III clock ban applies to `src/report` and `src/domain` only; `src/web` is not gated, so
  `new Date()` on the live board is legitimate. The gate greps confirm this.
- The board already fetches `updatedAt` on each `PipelineCard` — no query/schema change.
- `⚠ N μέρες` renders "μέρες" via a plain string — it is not a stored enum, so `labels.ts` (FR-11)
  does not apply; the number is live, not a stored key.

### Invariants held
- No schema, PII, label, capture, or report change. No new dependency. No change to board
  ordering or temperature derivation (both one-way doors — untouched).
- Article I: no new taps, marker is glanceable, ≥44px targets unaffected.

### TDD
Strong RED-first anchor: `stalenessMarker` is a pure function of `(temperature, updatedAt, now)`.
Test with **synthetic fixtures** and injected `now`, asserting each fixture's precondition (e.g.
"this fixture IS a hot lead exactly 3 days old") so a fixture that stops exercising the rule fails
loudly. Cover: hot at 2d (no marker) vs >2d (marker); warm at 5d vs >5d; cold at 100d (never);
the day-count arithmetic; boundary exactness.

---

## Cross-cutting

- **Order of work:** ① → ② → ③, each a self-contained RED→GREEN→gates→commit cycle with a
  `POLISH:` message and the `Co-Authored-By` trailer. Independent — any can ship without the
  others.
- **Per feature:** watch the RED fail for the right reason; run the FULL `bun test`; run
  `verify-gates.sh` (ALL GATES PASS) and `bun scripts/design/gates.ts` (7/7); re-capture the 8
  frames and review by eye; for ③ append the ADR in the same commit.
- **Determinism re-check** after ①: confirm the report re-renders byte-identically.
- **Not in scope:** dark theme (still deferred, ADR-0037), report letterhead, loading/empty/error
  states, count-up/stagger motion — all explicitly out.
