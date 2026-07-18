# AIRBNB-GRADE REBUILD — overnight execution brief

> **For the agent picking this up (Fable or any fresh session):** this is a self-contained
> brief. You have zero prior context; everything you need is here. Read it top to bottom,
> then execute. **Launch `claude` from the `CONSTRUCTOR/` directory** (not the parent) or the
> project's hooks/gates silently don't load. Work autonomously overnight; leave a reviewed-ready
> branch + screenshots for Christos in the morning. **Do not merge to master, do not push.**

---

## 1. Mission (one sentence)

Rebuild Constructor's entire phone UI — all 8 canonical screens — to **Airbnb-grade visual
quality**, escaping the "AI slop" look of the current design, while keeping every engineering
rail green, and leave a branch + a screenshots artifact for Christos to approve by eye.

## 2. Why this exists (context you must absorb)

- Constructor is a mobile-first sales-operations tool (real-estate agency running sales for
  construction firms). See `README.md` for the product; `CLAUDE.md` for how to work here.
- A prior design pass shipped a «Πεύκο & Μέλι» token layer (currently on `master`). It scored
  **7.78/10 (tier T2)** on the in-repo IMPACT-LOOP benchmark — **and Christos rejected it by eye
  as "too AI slop."** Human veto is final; the number is not the arbiter of taste.
- **Diagnosis (do not repeat these mistakes):** the design landed squarely in the generic
  "AI good-taste" cluster — warm **cream** ground (`#f7f3ea`), **serif** display headings,
  an **earthy pine/honey decorative palette** smeared everywhere, **cramped rounded blobs**,
  and **centered lockups**. It was *competent but generic* — no point of view, no craft, no
  restraint. That is exactly what reads as AI.
- **Reference chosen by Christos: Airbnb.** Airbnb is warm, human, and premium — but its warmth
  comes from **craft and whitespace, not from a beige palette**. That is the standard to hit.

## 3. The target: Airbnb design DNA (build to THIS, faithfully)

The felt bar: *a senior product designer, shown the board, says "clean, premium, real product"
— not "AI mockup."* It should look like it belongs next to Airbnb / Linear / Attio / Stripe.

**The principles that kill the slop look — internalize all of them:**

1. **Pure-white grounds, generous air.** The warmth is the *whitespace*, not a cream tint.
   Backgrounds are true white (`#ffffff`) / very slightly cool off-white. Never cream/beige.
2. **One confident accent, used decisively** — for the primary CTA, the current-operator avatar,
   the "next action" label. NOT a decorative palette painted across every element.
3. **Clean geometric sans, no serif anywhere.** Friendly, modern, tight tracking on headings.
4. **Refined cards:** a single hairline border **or** one soft real shadow (not both loud),
   ~14–16px radius, *generous* interior padding, calm spacing. Airbnb cards breathe.
5. **Money plain and bold** — near-ink, tabular, confident. No gold glow, no special "money color."
   It reads as data because it is set with authority, not decorated.
6. **Status as a subtle badge** (a small dot + label in a clean bordered pill), never loud color blobs.
7. **People get avatar chips** (a small circle with an initial) — Airbnb's signature human touch.
8. **Big, calm touch targets;** a confident primary button with a soft brand shadow.

**Reference artifacts from the session that produced this brief (open them):**
- Airbnb-grade board (the current visual target — match or beat it):
  `https://claude.ai/code/artifact/409369ed-2123-4833-9af6-93050402e1e3`
- Three-direction exploration (context on what was rejected/considered):
  `https://claude.ai/code/artifact/d6024ab6-6a14-4b42-b6c8-74924d7d5a13`

**If the Claude-for-Chrome extension is connected**, study the *real* thing first — capture and
read Airbnb's app/listing cards, plus Attio (CRM), Linear (rigor), Stripe/Mercury (money) — and
build faithfully to what you see. If it isn't connected, the DNA above is sufficient; do not block.

## 4. The design system (concrete — implement these, don't re-derive vibes)

Starting token set (from the approved board mockup; tune against the real reference if available).
These live as CSS custom properties in `src/web/index.html :root` and are consumed by inline
styles in `src/web/App.tsx` and the report CSS in `src/report/html.ts`.

```
--bg:#ffffff  --ink:#222222  --ink2:#6a6a6a  --ink3:#b0b0b0
--line:#ebebeb  --line2:#dddddd  --field:#f7f7f7
--accent:#0f7a6c  --accent-press:#0b6357        /* confident teal — Constructor's own identity */
--hot:#e0483d  --warm:#c9812a  --cold:#3f7d8c   /* temperature: subtle dot+label, never loud */
--shadow:0 6px 20px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)
--radius-card:16  --radius-field:12  --radius-btn:14
```

**Type scale (friendlier/larger than the old one — Airbnb is not cramped):** pick a clean scale
and pin it, e.g. `13 / 15 / 17 / 22 / 26` (or Airbnb-like `14 / 16 / 18 / 22 / 26`). Whatever you
choose, **update `scripts/design/palette.ts` `TYPE_SCALE` to match** so the type gate stays honest.
Tabular numerals on every € figure and count.

**Component patterns (apply consistently across all screens):**
- **Card:** white, 1px `--line`, `--radius-card`, ~18px padding, `--shadow`; top row = id + subtle
  status badge; a money row (stage label in `--ink2`, € bold in `--ink`); a "next action" block on
  `--field` with an `--accent` uppercase micro-label and an avatar chip for the owner.
- **Primary button:** `--accent` fill, white text, `--radius-btn`, soft accent shadow.
- **Secondary/option button:** white, 1px `--line2`; selected = `--ink` fill + white text (calm,
  high-contrast — this is the segmented-control pattern the capture sheets already use).
- **Badge:** clean pill, 1px border, a 7px colored dot + label; color only the dot + text.
- **Header:** minimal — small wordmark in `--accent`, operator as an avatar chip on the right,
  project switcher as calm rounded tabs, a stat row with big numbers + small labels.

**AVOID LIST — if any of these are present, it is not done:**
- ❌ cream/beige/warm-tan backgrounds  ❌ serif/Georgia headings anywhere
- ❌ a decorative multi-color palette (pine+honey+ochre) used beyond meaning
- ❌ gold/"honey" money coloring (money = bold ink)  ❌ loud filled status pills
- ❌ cramped spacing / everything rounded-blob  ❌ centered hero lockups
- ❌ heavy drop shadows *and* borders on the same element

## 5. Scope — the 8 canonical screens (rebuild every one)

PIN gate · operator gate ("Ποιος είσαι;") · pipeline **board** · **lead** sheet · **viewing**
sheet · **offer** sheet · **biweekly report** · **monthly report**. The board is the flagship —
get it right first, then propagate the exact system to the rest (consistency is most of "premium").

## 6. How to work (the loop)

1. `bash scripts/state.sh` — confirm branch/tests. Read `CLAUDE.md`, `.claude/ZONING.md`.
2. Branch off master: `git switch -c design/airbnb-grade`.
3. Rebuild `src/web/index.html` tokens → the system in §4. Then rebuild `src/web/App.tsx` screen by
   screen, and `src/report/html.ts` for the two reports. One coherent system, applied everywhere.
4. **Reconcile `scripts/design/palette.ts`** (`PALETTE_HEXES`, `TYPE_SCALE`, honey rules) to the new
   token values so the mechanical gates check the *real* palette. (The old gate hexes are the
   rejected «Πεύκο & Μέλι» set — replace them.)
5. **Capture + look at your own work every iteration.** The local Puppeteer harness works
   independently of the Chrome extension:
   ```
   set -a && source .env && set +a
   bun scripts/design/capture.ts        # → artifacts/design/round-0/frame-*.jpeg (all 8 screens)
   ```
   Open each frame. Self-critique against the §4 AVOID LIST. Iterate until zero tells remain.
6. Keep rails green continuously: `bun test` and `bash scripts/verify-gates.sh` must pass before
   every commit (the git hooks enforce it). Commit per coherent chunk with a `POLISH:` prefix
   (src/ commits require it) + the `Co-Authored-By: Claude ...` trailer.
7. Build a screenshots artifact (an HTML page embedding the 8 frames as data-URIs, like
   `scripts/design/build-artifact.ts`) so Christos can review on his phone. He **cannot use
   DevTools and reviews by eye/screenshot** — screenshots are the deliverable.

## 7. Rails that MUST hold (this repo is heavily governed)

- `bash scripts/verify-gates.sh` → **ALL GATES PASS**; `bun test` green (≥437). Byte-deterministic
  reports (no `Date.now`/`Math.random`/`toLocaleString`/`Intl` in `src/report` — pure string CSS is fine).
- **No behavior/schema/PII/label changes** — this is a *visual* rebuild. Don't touch `src/db/`,
  `src/domain/labels.ts`, capture logic, or the constitution invariants (Articles II/III/IV/VI).
- **No new runtime dependencies** beyond `{react, react-dom, lucide-react}`. Self-hosting a webfont
  (e.g. an Airbnb-Cereal-like geometric sans as a committed woff2) is allowed and encouraged for
  authenticity, but it is a devless static asset, not an npm runtime dep — record it in an ADR.
- Mobile one-handed, **≥44×44px** targets, Greek UI (every stored enum via `labels.ts`).
- **Never `git add -A`** (stage by path). **Do not commit to / push master.** Work on the branch.
- ZONING on every change; a genuine trade-off → append an ADR to `DECISIONS.md` before the commit.

## 8. Done when (falsifiable checklist — all must be true)

- [ ] All **8 screens** rebuilt to the §4 system; **zero** items from the AVOID LIST present
      (verify by opening every captured frame).
- [ ] `bash scripts/verify-gates.sh` prints **ALL GATES PASS**; `bun test` green; reports byte-identical.
- [ ] Mechanical **design** gates pass on the new palette (`bun scripts/design/gates.ts`):
      0 off-palette, WCAG AA everywhere, ≥44px targets, on-scale type, tabular money —
      `palette.ts` reconciled to the shipped tokens.
- [ ] Screenshots of all 8 screens captured and a **review artifact published** (URL in the summary).
- [ ] All work committed (`POLISH:`) on branch **`design/airbnb-grade`** — **NOT** merged, **NOT** pushed.
- [ ] A **morning summary** written (see §10) with: what changed, the screenshots URL, the one open
      decision (accent color), and any RED item that stopped you.

## 9. What "success looks like" vs "not done"

**Success:** the board reads as a real, premium product — calm white, one confident accent, clean
type, refined cards, plain-bold money, human avatar touches. A hirer/designer would not guess it
was AI-generated. It sits comfortably beside Airbnb/Linear/Attio.

**Not done (regressions to catch yourself):** any cream tint creeps back; a serif sneaks into the
report; money gets a gold color again; status becomes loud filled pills; cards get cramped;
spacing gets tight and busy; the accent gets used decoratively instead of for meaning.

## 10. Deliverables for the morning

1. Branch `design/airbnb-grade` with the full rebuild, rails green, unmerged.
2. A published **screenshots artifact** (all 8 screens; both light + dark if you add a dark theme).
3. A short **summary comment** (in your final message or a `docs/design-loop/AIRBNB-REBUILD-RESULT.md`):
   - before → after, per screen, in one line each;
   - the screenshots artifact URL;
   - **the one open decision:** accent color. Default shipped = teal `#0f7a6c` (Constructor's own).
     If a warmer Airbnb-coral or a return to pine looks stronger, capture that variant too and let
     Christos pick — do not block on it.
   - anything that hit a RED zone and stopped.

## 11. Autonomy guardrails

- **Act freely** on any design decision *within* the Airbnb-grade direction — that's the whole job.
- **The benchmark is secondary.** It scored the rejected slop 7.78; treat the mechanical gates as
  objective *hygiene* (contrast/targets/tabular/scale), never as the judge of taste. Your eye +
  the §4 DNA + the AVOID LIST are the real bar.
- **STOP and leave a note (RED)** for: any behavior/schema/PII/scope change; merging or pushing
  master; adding a runtime dependency; anything the constitution forbids. Better to leave it for
  Christos than to drift.

---

*Pointers: tokens in `src/web/index.html`; all app screens in `src/web/App.tsx`; reports in
`src/report/html.ts`; capture harness `scripts/design/capture.ts`; design gates
`scripts/design/gates.ts`; palette spec `scripts/design/palette.ts`; the method + benchmark in
`IMPACT-LOOP.md`; the governing rails in `CLAUDE.md`, `.claude/ZONING.md`,
`.specify/memory/constitution.md`.*
