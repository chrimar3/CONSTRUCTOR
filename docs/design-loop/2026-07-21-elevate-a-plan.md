# Elevate variant A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent refinements to design direction A — a proportional funnel in both builder reports, a restrained motion layer, and an escalate-only board recency marker.

**Architecture:** ① The report generators wrap the existing activity-total list lines in a ```` ```funnel ```` fence (leaving those lines byte-for-byte intact so every existing test passes unchanged); `html.ts` renders the fenced region as proportional CSS-`div` bars. ② A small CSS block (keyframes + `:active` classes) is added to `index.html` and applied via `className` in `App.tsx`, under the existing reduced-motion guard. ③ A pure `stalenessMarker()` helper drives a quiet lucide icon + "N μέρες" in the board card header.

**Tech Stack:** Bun (`bun test`, `bun:sqlite`, `Bun.serve`), React + `react-dom` + `lucide-react` (web only), hand-rolled Markdown→HTML renderer. No ORM, no CSS framework.

## Global Constraints

- Branch is `design/variant-a`. **Never commit to / push master.** Verify `git branch --show-current` before every commit.
- **No new runtime dependency** beyond `{react, react-dom, lucide-react}`.
- **Stage by explicit path.** Never `git add -A`. Never `--no-verify`.
- Commits touching `src/` **must** start `POLISH: ` and carry the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Report path (`src/report/**`, `src/domain/**`) stays deterministic: **no** `Date`/`Date.now`/`Math.random`/`toLocaleString`/`Intl`. `new Date()` is permitted in `src/web/**` only.
- Every task ends green: `set -a && source .env && set +a` then `bun test` (≥441 pass, 0 fail), `bash scripts/verify-gates.sh` → `ALL GATES PASS`, and (for tasks that change rendered frames) `DESIGN_OUT=artifacts/design/variant-a bun scripts/design/capture.ts` + `bun scripts/design/gates.ts` → 7/7.
- Money is bold ink, never a colour. Status is never a loud filled pill. Backgrounds pure white / cool off-white (AVOID LIST holds).
- All env-dependent commands need `.env` sourced first (`CONSTRUCTOR_PII_KEY`).

---

## Feature ① — Funnel bars in both reports

### File structure
- Modify `src/report/html.ts` — add `renderFunnel()` and fence detection in `markdownToHtml()`; add funnel CSS to `STYLE`.
- Modify `src/report/biweekly.ts` — wrap the three activity-total list lines in a ```` ```funnel ```` fence.
- Modify `src/report/monthly.ts` — same wrap for its activity-total block only (NOT the trend block).
- Test `tests/html.test.ts` — unit-test the funnel renderer.

### Task 1: Funnel renderer in `html.ts`

**Files:**
- Modify: `src/report/html.ts` (function `markdownToHtml`, and the `STYLE` constant)
- Test: `tests/html.test.ts`

**Interfaces:**
- Produces: a new block form the report renderer understands — a fence opening with a line whose trimmed value is exactly `` ```funnel ``, followed by zero or more `- <label>: <int>` lines, closed by a line whose trimmed value is exactly `` ``` ``. `markdownToHtml` renders it to `<div class="funnel">…</div>` with one `.funnel-row` per line.

- [ ] **Step 1: Write the failing test**

Add to `tests/html.test.ts` (inside the top-level `describe` for `markdownToHtml`):

```ts
test("funnel fence renders proportional bars; zero → width 0; values preserved", () => {
  const md = "```funnel\n- Εκδήλωση ενδιαφέροντος: 8\n- Επίσκεψη: 4\n- Προσφορά: 0\n```";
  const html = markdownToHtml(md);
  expect(html).toContain('<div class="funnel">');
  expect(html).toContain('style="width:100%"'); // 8 is the max → full
  expect(html).toContain('style="width:50%"');  // 4 / 8
  expect(html).toContain('style="width:0%"');   // 0 → empty track (Article VI safe)
  expect(html).toContain('<span class="funnel-val">0</span>');
  expect(html).toContain("Εκδήλωση ενδιαφέροντος");
  // the raw "- label: N" lines must NOT also leak out as <li> list items
  expect(html).not.toContain("<li>Εκδήλωση ενδιαφέροντος: 8</li>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/html.test.ts -t "funnel fence"`
Expected: FAIL — output contains `<ul>`/`<li>` (the fence lines fell through to the list renderer) and no `class="funnel"`.

- [ ] **Step 3: Add the renderer function**

In `src/report/html.ts`, immediately above `export function markdownToHtml`, add:

```ts
/**
 * Renders a ```funnel fence — a run of "- label: N" lines — as proportional
 * CSS-div bars (widths relative to the largest count; 0 → empty track). Pure
 * string, integer arithmetic only: Article III byte-determinism holds, and a
 * zero count still shows its figure adjacent to the block's recommendation
 * (Article VI). CSS divs (not SVG) so email/Viber clients render them.
 */
function renderFunnel(rowLines: string[]): string {
  const rows = rowLines
    .map((l) => /^- (.+): (\d+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ label: m[1]!, value: parseInt(m[2]!, 10) }));
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const bars = rows
    .map((r) => {
      const pct = max === 0 ? 0 : Math.round((r.value * 100) / max);
      return (
        `<div class="funnel-row">` +
        `<span class="funnel-label">${escapeHtml(r.label)}</span>` +
        `<span class="funnel-track"><span class="funnel-bar" style="width:${pct}%"></span></span>` +
        `<span class="funnel-val">${r.value}</span>` +
        `</div>`
      );
    })
    .join("\n");
  return `<div class="funnel">\n${bars}\n</div>`;
}
```

- [ ] **Step 4: Detect the fence in `markdownToHtml`**

In `src/report/html.ts`, inside the `for` loop of `markdownToHtml`, directly AFTER the `if (isCommentLine(line)) { … }` block and BEFORE the `if (line.startsWith("- "))` list block, insert:

```ts
    // Funnel fence: ```funnel … ``` wrapping "- label: N" lines → proportional bars.
    if (line.trim() === "```funnel") {
      const rowLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "```") {
        rowLines.push(lines[i]!);
        i++;
      }
      out.push(renderFunnel(rowLines));
      continue;
    }
```

- [ ] **Step 5: Add funnel CSS to `STYLE`**

In `src/report/html.ts`, in the `STYLE` template string, add these rules immediately before the closing `` ` `` of the `@media print{…}` line (i.e. append them, each on its own line, before the final backtick):

```
.funnel{margin:.4em 0 1.2em}
.funnel-row{display:flex;align-items:center;gap:.7em;margin:.35em 0}
.funnel-label{flex:0 0 9em;font-size:13px;color:var(--ink-2)}
.funnel-track{flex:1;height:12px;background:var(--surface-2);border-radius:6px;overflow:hidden}
.funnel-bar{display:block;height:100%;background:var(--ink-2);border-radius:6px}
.funnel-val{flex:0 0 auto;min-width:1.6em;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/html.test.ts`
Expected: PASS (all `html.test.ts` tests, including the new one and the existing "no external url()" self-contained test — the bars use only `style="width:NN%"`, no `url(`).

- [ ] **Step 7: Commit**

```bash
git add src/report/html.ts tests/html.test.ts
git commit -m "POLISH: funnel bar renderer for report activity block

A \`\`\`funnel fence wrapping the existing '- label: N' lines renders as
proportional CSS-div bars (widths relative to max; 0 → empty track). Pure
string, integer arithmetic — Article III determinism and the self-contained
(no external url) invariant both hold.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: Emit the fence from both generators

**Files:**
- Modify: `src/report/biweekly.ts` (the `## Δραστηριότητα περιόδου` activity block)
- Modify: `src/report/monthly.ts` (the `## Δραστηριότητα περιόδου` activity block only — NOT the `## Τάση …` trend block)

**Interfaces:**
- Consumes: the fence form produced by Task 1.

- [ ] **Step 1: Confirm the coupled tests currently pass (baseline)**

Run: `set -a && source .env && set +a && bun test tests/report.test.ts tests/monthly.test.ts tests/naked-numbers.test.ts tests/cli.test.ts`
Expected: all PASS. These assert the literal `- Εκδήλωση ενδιαφέροντος: N\n- Επίσκεψη: N\n- Προσφορά: N` substrings and the `- Επίσκεψη: (\d+)` regex; the wrap below keeps those three lines byte-for-byte intact, so they must STILL pass after Step 2. This step records the baseline so a regression is unambiguous.

- [ ] **Step 2: Wrap the activity totals in `biweekly.ts`**

In `src/report/biweekly.ts`, find:

```ts
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
```

Replace with (the three original lines are unchanged; only the two fence markers are added):

```ts
  // ```funnel wrapper: html.ts renders these exact "- label: N" lines as
  // proportional bars. The lines stay byte-identical, so every report/cli/
  // naked-numbers assertion that matches them still holds.
  lines.push("```funnel");
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
  lines.push("```");
```

- [ ] **Step 3: Wrap the activity totals in `monthly.ts`**

In `src/report/monthly.ts`, find the activity block (under `## Δραστηριότητα περιόδου`):

```ts
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
```

Replace with the SAME wrap as Step 2:

```ts
  lines.push("```funnel");
  lines.push(`- ${eventTypeLabel("inquiry")}: ${totals.inquiries}`);
  lines.push(`- ${eventTypeLabel("viewing")}: ${totals.viewings}`);
  lines.push(`- ${eventTypeLabel("offer")}: ${totals.offers}`);
  lines.push("```");
```

> Do NOT touch the `## Τάση …` block's `- label: N (προηγούμενη περίοδος: …)` lines — that block stays a plain list.

- [ ] **Step 4: Run the full suite + gates**

Run: `set -a && source .env && set +a && bun test && bash scripts/verify-gates.sh`
Expected: `bun test` 0 fail (all four coupled files still green — proof the wrap is non-invasive); `verify-gates.sh` → `ALL GATES PASS`. If `report.test.ts` / `monthly.test.ts` / `naked-numbers.test.ts` / `cli.test.ts` fail, STOP — the fence lines were not kept byte-identical.

- [ ] **Step 5: Verify report determinism explicitly**

Run:
```bash
set -a && source .env && set +a && bun -e '
import { biweeklyReport } from "./src/report/biweekly";
import { monthlyReport } from "./src/report/monthly";
import { initDb } from "./src/db/init"; import { seed } from "./src/db/seed";
import { readFileSync } from "node:fs";
const db = initDb(":memory:"); seed(db, JSON.parse(readFileSync("seed.example.json","utf8")));
const p = 1, asOf = "2026-07-11";
const b1 = biweeklyReport(db,{projectId:p,asOf}); const b2 = biweeklyReport(db,{projectId:p,asOf});
console.log("biweekly byte-identical:", b1===b2, "| has fence:", b1.includes("```funnel"));'
```
Expected: `biweekly byte-identical: true | has fence: true`.

- [ ] **Step 6: Re-capture frames and check design gates**

Run: `set -a && source .env && set +a && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/capture.ts && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/gates.ts`
Expected: `captured 8 frames`; gates `0 of 7 gates FAIL`. Then OPEN `artifacts/design/variant-a/frame-7-report-biweekly.jpeg` and `frame-8-report-monthly.jpeg` and confirm the activity block now shows bars (label · bar · value), no leftover bullet list, money still ink.

- [ ] **Step 7: Commit**

```bash
git add src/report/biweekly.ts src/report/monthly.ts
git commit -m "POLISH: render report activity totals as a proportional funnel

Both reports wrap the activity totals in a \`\`\`funnel fence; the three
'- label: N' lines are byte-identical, so every existing report/monthly/
naked-numbers/cli assertion passes unchanged. Reports re-render byte-identically.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Feature ② — A restrained motion layer

### File structure
- Modify `src/web/index.html` — add `@keyframes` + `.press` interaction classes inside the existing `<style>` (above the reduced-motion guard so the guard's `!important` still wins).
- Modify `src/web/App.tsx` — add `className` to the toast, the submit button, board cards, and the sheet container.
- Test `tests/web.test.ts` — pin that the served shell still carries the reduced-motion guard.

### Task 3: Motion CSS + hooks

**Files:**
- Modify: `src/web/index.html` (the `<style>` block)
- Modify: `src/web/App.tsx` (toast div, `S.submit` button usage, `BoardCard` root, `Sheet` root)
- Test: `tests/web.test.ts`

**Interfaces:**
- Produces: CSS classes `press` (scale-on-`:active`), `toast-in` (slide+fade-in keyframe), `sheet-in` (slide-up keyframe), all no-ops under `prefers-reduced-motion: reduce`.

- [ ] **Step 1: Write the failing test**

Add to `tests/web.test.ts` (in the shell-serving describe):

```ts
test("shell carries the reduced-motion guard AND the motion classes it disables", async () => {
  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain("prefers-reduced-motion: reduce");
  expect(html).toContain(".press:active");     // press feedback exists…
  expect(html).toContain("@keyframes toast-in"); // …and the toast keyframe…
  expect(html).toContain("@keyframes sheet-in"); // …and the sheet keyframe
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a && source .env && set +a && bun test tests/web.test.ts -t "reduced-motion guard AND"`
Expected: FAIL — `.press:active` / `@keyframes toast-in` not found.

- [ ] **Step 3: Add the motion CSS**

In `src/web/index.html`, inside `<style>`, immediately BEFORE the existing `@media (prefers-reduced-motion: reduce) { … }` rule, add:

```css
    @keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes sheet-in { from { transform: translateY(16px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
    .toast-in { animation: toast-in var(--dur) ease-out; }
    .sheet-in { animation: sheet-in 180ms ease-out; }
    .press { transition: transform var(--dur) ease, box-shadow var(--dur) ease; }
    .press:active { transform: scale(0.98); }
```

(The existing `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }` immediately below already disables all of the above for reduced-motion users — no change needed there.)

- [ ] **Step 4: Apply the classes in `App.tsx`**

Add `className="press"` to the interactive elements and the animation classes to the transient ones:

1. **Board card** — on the `BoardCard` root `<div>` (the one with `boxShadow: "var(--shadow-card)"`), add `className="press"`.
2. **Submit button** — in the `Sheet` component's submit `<button>` (styled by `S.submit(...)`), add `className="press"`.
3. **Capture bar buttons** and **primary buttons** (PIN `Είσοδος`, operator choices) — add `className="press"` to each `<button>`.
4. **Toast** — on the toast `<div>` (the one with `background: "var(--ink)"`, `<Check .../>`), add `className="toast-in"`.
5. **Sheet** — on the `Sheet` component's outermost fixed `<div>` (`position: "fixed", inset: 0`), add `className="sheet-in"`.

- [ ] **Step 5: Verify build + test + full suite**

Run: `set -a && source .env && set +a && bun build src/web/App.tsx --target=browser >/dev/null && bun test`
Expected: build OK; `bun test` 0 fail (new `web.test.ts` assertion passes).

- [ ] **Step 6: Gates + capture**

Run: `set -a && source .env && set +a && bash scripts/verify-gates.sh && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/capture.ts && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/gates.ts`
Expected: `ALL GATES PASS`; `0 of 7 gates FAIL`. (Motion is not visible in a still frame; the frames confirm nothing regressed. Motion itself is verified by the class-presence test + manual pass — stated honestly, not faked.)

- [ ] **Step 7: Commit**

```bash
git add src/web/index.html src/web/App.tsx tests/web.test.ts
git commit -m "POLISH: restrained motion layer (save moment, press feedback, sheet slide)

Toast slides+fades in, buttons/cards depress on :active, sheets slide up. Small
CSS block in index.html applied via className; all of it sits under the existing
prefers-reduced-motion guard, which is now pinned by a served-shell test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Feature ③ — Escalate-only board recency marker

### File structure
- Modify `src/web/helpers.ts` — add `STALE_HOT_DAYS`, `STALE_WARM_DAYS`, `stalenessMarker()`.
- Modify `src/web/App.tsx` — import the helper + a lucide icon; compute `now` once; render the marker in `BoardCard`.
- Test `tests/web.test.ts` (or a new `tests/staleness.test.ts`) — pin `stalenessMarker`.
- Modify `DECISIONS.md` — append the ADR (in the same commit).

### Task 4: `stalenessMarker` helper (pure, RED-first)

**Files:**
- Modify: `src/web/helpers.ts`
- Test: `tests/web.test.ts`

**Interfaces:**
- Produces: `export function stalenessMarker(temperature: string, updatedAt: string, now: Date): { days: number } | null` and `export const STALE_HOT_DAYS = 2`, `export const STALE_WARM_DAYS = 5`.

- [ ] **Step 1: Write the failing test**

Add a new `describe` to `tests/web.test.ts` (import `stalenessMarker`, `STALE_HOT_DAYS`, `STALE_WARM_DAYS` from `../src/web/helpers` at the top):

```ts
describe("stalenessMarker — escalate-only board recency (hot >2d, warm >5d, cold never)", () => {
  const at = (isoDay: string) => new Date(`${isoDay}T09:00:00Z`);
  const NOW = at("2026-07-21");
  const daysAgo = (n: number) => {
    const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  test("thresholds are the ruled values", () => {
    expect(STALE_HOT_DAYS).toBe(2);
    expect(STALE_WARM_DAYS).toBe(5);
  });
  test("hot at exactly 2 days is fresh; at 3 days it flags", () => {
    expect(daysAgo(2)).not.toBe(daysAgo(3)); // precondition: fixtures differ
    expect(stalenessMarker("hot", daysAgo(2), NOW)).toBeNull();
    expect(stalenessMarker("hot", daysAgo(3), NOW)).toEqual({ days: 3 });
  });
  test("warm at 5 days is fresh; at 6 days it flags", () => {
    expect(stalenessMarker("warm", daysAgo(5), NOW)).toBeNull();
    expect(stalenessMarker("warm", daysAgo(6), NOW)).toEqual({ days: 6 });
  });
  test("cold never flags, however old", () => {
    expect(stalenessMarker("cold", daysAgo(100), NOW)).toBeNull();
  });
  test("day count is whole calendar days from the date part, ignoring time of day", () => {
    // precondition: same calendar day, different clock time → 0 days, no flag
    expect(stalenessMarker("hot", "2026-07-21T23:59:59Z", at("2026-07-21"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a && source .env && set +a && bun test tests/web.test.ts -t "stalenessMarker"`
Expected: FAIL — `stalenessMarker` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/web/helpers.ts`:

```ts
// ─── Board recency (design elevation ③) ───────────────────────────────────────
// Escalate-only staleness: a HOT lead untouched > STALE_HOT_DAYS, or a WARM lead
// untouched > STALE_WARM_DAYS, is overdue. Cold never flags (dormant by nature).
// Pure function of (temperature, updatedAt, now) — `now` injected, so it is
// deterministic and unit-testable without a wall clock.

export const STALE_HOT_DAYS = 2;
export const STALE_WARM_DAYS = 5;

const MS_PER_DAY = 86_400_000;

/** Whole calendar days between two ISO date-or-datetime strings (date part only). */
function calendarDaysBetween(fromIso: string, toIso: string): number {
  const day = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY);
  return day(toIso) - day(fromIso);
}

/** Overdue marker for a board card, or null when fresh / cold. */
export function stalenessMarker(
  temperature: string,
  updatedAt: string,
  now: Date,
): { days: number } | null {
  const days = calendarDaysBetween(updatedAt, now.toISOString());
  if (temperature === "hot" && days > STALE_HOT_DAYS) return { days };
  if (temperature === "warm" && days > STALE_WARM_DAYS) return { days };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a && source .env && set +a && bun test tests/web.test.ts -t "stalenessMarker"`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/web/helpers.ts tests/web.test.ts
git commit -m "POLISH: stalenessMarker helper for board recency (hot >2d, warm >5d)

Pure function of (temperature, updatedAt, now) with now injected — deterministic,
unit-tested. Cold never flags. Wiring into the board follows.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5: Render the marker in `BoardCard` + ADR

**Files:**
- Modify: `src/web/App.tsx` (imports, board render, `BoardCard`)
- Modify: `DECISIONS.md` (append ADR)

**Interfaces:**
- Consumes: `stalenessMarker` from Task 4; `AlertTriangle` from `lucide-react` (already a dependency; verified present in the installed version).

- [ ] **Step 1: Import the helper and icon**

In `src/web/App.tsx`:
- Add `stalenessMarker` to the existing import from `./helpers`.
- Add `AlertTriangle` to the existing `lucide-react` import (line 12: `import { Check, ChevronLeft, Euro, Eye, UserPlus } from "lucide-react";` → add `AlertTriangle`).

- [ ] **Step 2: Thread `now` into the board render**

In `App.tsx`, in the board `return (` (the `<div data-screen="board" …>`), compute `now` once just before the cards are mapped, and pass it to each card:

```tsx
        // one clock read per render; src/web is not on the Article III report path
        const now = new Date();
```
and change the card map to:
```tsx
        cards.map((c) => <BoardCard key={c.opportunityId} card={c} now={now} />)
```

- [ ] **Step 3: Render the marker in `BoardCard`**

Change the signature `function BoardCard(props: { card: Card })` to `function BoardCard(props: { card: Card; now: Date })`, and inside compute the marker and render it in the header row beside the temperature badge. In the first header `<div>` (the flex row containing the `pseudonym`/`unitCode` block and `<TemperatureBadge …/>`), wrap the badge so the marker sits to its left:

```tsx
  const c = props.card;
  const stale = stalenessMarker(c.temperature, c.updatedAt, props.now);
```
and replace `<TemperatureBadge temperature={c.temperature} />` in that header row with:
```tsx
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {stale !== null ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "var(--warm)",
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <AlertTriangle size={13} /> {stale.days} μέρες
            </span>
          ) : null}
          <TemperatureBadge temperature={c.temperature} />
        </span>
```

- [ ] **Step 4: Build + full suite + gates**

Run: `set -a && source .env && set +a && bun build src/web/App.tsx --target=browser >/dev/null && bun test && bash scripts/verify-gates.sh`
Expected: build OK; `bun test` 0 fail; `ALL GATES PASS`. In particular the Article III gate greps `src/report`/`src/domain` only, so the `new Date()` in `src/web/App.tsx` does not trip it — confirm the gate output shows the determinism/clock gates green.

- [ ] **Step 5: Capture + eyeball the marker**

Run: `set -a && source .env && set +a && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/capture.ts && DESIGN_OUT=artifacts/design/variant-a bun scripts/design/gates.ts`
Expected: `captured 8 frames`; `0 of 7 gates FAIL`. OPEN `artifacts/design/variant-a/frame-3-board.jpeg`: overdue hot/warm cards show a quiet `⚠ N μέρες` beside the temperature badge; fresh cards show nothing; the marker is not a filled pill; ≥44px targets unaffected.

- [ ] **Step 6: Append the ADR**

Append to `DECISIONS.md` (next free ADR number — check with `grep '^### ADR-' DECISIONS.md | tail -1`; expected `ADR-0041`):

```markdown

### ADR-0041 — Board surfaces escalate-only recency (hot >2d, warm >5d); cold never
- Date: 2026-07-21
- Zone: YELLOW (ZONING Step 4 — a small, human-authorised scope addition that shows data the board did not display before). Christos approved the design doc `docs/design-loop/2026-07-21-elevate-a-design.md`, which is the ruling; the thresholds below are the standing decision.
- Context: `updated_at` is on every `PipelineCard` but was never shown, and `listPipeline` already orders `temperature, … updated_at ASC` — the stalest hot lead is already first. Surfacing recency makes the board a triage tool without changing the ordering it already computes.
- Decision: a quiet marker (`⚠ N μέρες`) appears only when a HOT lead is untouched > 2 days or a WARM lead > 5 days; COLD never flags. Driven by the pure `stalenessMarker(temperature, updatedAt, now)` helper (`now` injected, unit-tested). Thresholds are named constants `STALE_HOT_DAYS`/`STALE_WARM_DAYS`.
- Alternatives considered: relative time on every card (rejected: reads as a timestamp, adds a line to every card, costs the density win); both (rejected: pushes against density); flagging cold (rejected: cold is expected to be dormant — it would cry wolf).
- Reversibility: easy — remove the marker span in `BoardCard` and the helper; nothing else depends on it. No schema, query, ordering or temperature-derivation change.
- Article-safety: I — no new taps, glanceable, ≥44px unaffected. III — `new Date()` lives only in `src/web/App.tsx`; the clock ban covers `src/report`/`src/domain`, which are untouched, so reports stay byte-deterministic. IV/V — no PII, no micro_area change. VIII — no new dependency (`AlertTriangle` is from the existing `lucide-react`).
```

- [ ] **Step 7: Commit**

```bash
git add src/web/App.tsx DECISIONS.md
git commit -m "POLISH: escalate-only board recency marker (ADR-0041)

A quiet '⚠ N μέρες' appears beside the temperature badge only when a hot lead is
untouched >2 days or a warm lead >5 days; cold never flags. Driven by the pure
stalenessMarker helper. new Date() is confined to src/web, so the report
determinism path is untouched. Scope addition authorised by design approval.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** ① Task 1 (renderer) + Task 2 (both generators, determinism, capture); ② Task 3 (CSS + hooks + reduced-motion pin + capture); ③ Task 4 (helper, RED-first) + Task 5 (board wiring + ADR + capture). Every spec section maps to a task. The spec's "CSS divs not SVG", "zero-safe", "byte-identical", "thresholds as named constants", "new Date only in src/web", "AVOID LIST holds", and "ADR for ③" are all in explicit steps.
- **Placeholder scan:** none — every code step carries the actual code and every run step its expected output.
- **Type/name consistency:** `stalenessMarker(temperature, updatedAt, now): { days: number } | null`, `STALE_HOT_DAYS`, `STALE_WARM_DAYS`, `renderFunnel(rowLines: string[])`, classes `press`/`toast-in`/`sheet-in`, icon `AlertTriangle` — used identically across the tasks that define and consume them.
- **Order independence:** ①, ②, ③ are independent and may ship in any order; within ③, Task 4 must precede Task 5 (Task 5 consumes the helper).
