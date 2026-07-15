// IMPACT-LOOP — seed lever catalog. Candidate improvements the impact model ranks
// each round (spec §4). Each lever declares the (screen,dimension) pairs it
// affects, an estimated gain (points added, clamped by headroom at rank time),
// a ZONING zone, and a relative effort (S=1, M=3, L=6). The research pass
// augments/reorders this catalog; gains are estimates VERIFIED after implementation
// (predicted-vs-actual, spec §4). Screen ids match the capture frames.

import type { Lever } from "./impact-model";

export const SEED_LEVERS: Lever[] = [
  {
    id: "tokens-pinemeli",
    title: "«Πεύκο & Μέλι» design-token layer (palette + type + space) across all screens",
    zone: "YELLOW",
    effort: 6,
    status: "done", // Round 1 (5e52746): palette 0.27→0.86, all mechanical gates pass
    allScreens: true,
    affects: [
      { dimension: "warmth", gain: 6 }, // raises cap_warmth 3→9; the headline lever
      { dimension: "typography", gain: 2 }, // owns the pinned type scale — cap_typography 3→9
    ],
    // NOT hierarchy: cap_hierarchy is contrast-driven (see contrast-aa), so crediting it
    // here would double-count Lever "contrast-aa" (research finding, 2026-07-15). The type
    // scale is folded into the token definitions, so it also absorbs the scale part of the
    // "type-scale-snap" lever below — which is why that lever collapses to tabular-nums only.
    note: "Introduces CSS custom properties for the token set; every component styles through them. Closes the palette + type objective gates simultaneously (bake the pinned scale + AA-valid pine/honey pairs into the token values from the start).",
  },
  {
    id: "info-complete-entry",
    title: "Orienting context on the PIN + operator entry screens (within the minimal-auth ceiling)",
    zone: "YELLOW",
    effort: 3,
    status: "done", // Round 2 (brand lockup + context): pin composite 6.38→7.07
    affects: [
      // Ceiling-adjusted (research 2026-07-15): auth/entry screens have a purpose-bound
      // completeness ceiling (~6–7) — minimal is best practice. Current ~4 → realistic gain ~2.
      // NEVER add taps/friction to a PIN screen; only orienting context/branding.
      { screen: "pin", dimension: "completeness", gain: 2 },
      { screen: "operator", dimension: "completeness", gain: 2 },
    ],
    note: "PIN/operator are the weakest screens (~6.4) and gate T2's no-screen-<6.5 floor — but the instrument is orienting context/branding, not more fields.",
  },
  {
    id: "contrast-aa",
    title: "Bring every text pair to WCAG AA",
    zone: "GREEN",
    effort: 2,
    status: "done", // Round 1: contrast pairs below AA 62→0
    allScreens: true,
    affects: [{ dimension: "hierarchy", gain: 1 }],
    note: "Raises cap_hierarchy toward 10; closes the contrast objective gate. Mechanical, low-risk.",
  },
  {
    id: "tabular-numerals",
    title: "Tabular numerals on money + counts (the type scale itself is folded into the token layer)",
    zone: "GREEN",
    effort: 1,
    status: "done", // Round 1: tabular-nums on € figures + board counters + report bodies
    allScreens: true,
    // The pinned scale is defined by the token layer (tokens-pinemeli), so only the
    // non-overlapping remnant remains here: tabular figures so € amounts and counts
    // align as data. Small but real for a money CRM. Headroom largely collapses once
    // the token layer lands — the loop's re-measure self-corrects this (research, 2026-07-15).
    affects: [{ dimension: "typography", gain: 0.5 }],
    note: "Fast follow-up after the token layer: font-variant-numeric: tabular-nums on every €/count element.",
  },
  {
    id: "honey-reports",
    title: "Honey signal on report € figures (unblocks honeyCorrect → the T2 gate)",
    zone: "YELLOW",
    effort: 1,
    status: "done", // Round 2: flipped honeyCorrect false→true (was false in Round 1) → T2
    affects: [
      { screen: "report-biweekly", dimension: "gravitas", gain: 1 },
      { screen: "report-monthly", dimension: "gravitas", gain: 1 },
    ],
    // The app honey (money + save moment) shipped in Round 1; only the reports still
    // lack it, which is why objective honeyCorrect is false and T2 is blocked. NOTE:
    // ExpectedLift undersells this — its real value is closing the honeyCorrect TIER
    // gate, which the judged-dimension model does not price. Pair with a T2 push.
    note: "Reports render € in ink, not honey — the only surface keeping honeyCorrect false. Small judged lift, but a T2 prerequisite.",
  },
  {
    id: "report-gravitas",
    title: "Report typography: serif headings + tabular figures + tighter hierarchy",
    zone: "YELLOW",
    effort: 3,
    status: "done", // Round 1: serif (Georgia) headings + tabular figures in html.ts; reports gravitas ~8
    affects: [
      { screen: "report-biweekly", dimension: "typography", gain: 2 },
      { screen: "report-monthly", dimension: "typography", gain: 2 },
      { screen: "report-biweekly", dimension: "gravitas", gain: 1 },
      { screen: "report-monthly", dimension: "gravitas", gain: 1 },
    ],
    note: "The reports read as documents; the panel flagged wall-of-text. Highest-weight after warmth on those two surfaces.",
  },
  {
    id: "save-moment",
    title: "Choreographed save moment + 120ms state transitions (reduced-motion aware)",
    zone: "YELLOW",
    effort: 3,
    // Scoped to INTERACTIVE screens only (research 2026-07-15): the two static
    // report documents have no save action or runtime state, so allScreens overstated
    // the lift by crediting them ~+2. Responsiveness is the lowest dimension (~6);
    // 120ms is the responsive-feedback sweet spot; Article I independently mandates
    // save feedback. NOTE: a screenshot benchmark can't SEE motion — verify by driving
    // the app, not the static panel (its realized panel-lift will look muted).
    affects: [
      { screen: "board", dimension: "responsiveness", gain: 2 },
      { screen: "sheet-lead", dimension: "responsiveness", gain: 2 },
      { screen: "sheet-viewing", dimension: "responsiveness", gain: 2 },
      { screen: "sheet-offer", dimension: "responsiveness", gain: 2 },
      { screen: "pin", dimension: "responsiveness", gain: 2 },
      { screen: "operator", dimension: "responsiveness", gain: 2 },
    ],
    note: "Responsiveness is the lowest dimension. Interactive screens only; prefers-reduced-motion collapses all. Verify motion by click-through, not the static benchmark.",
  },
];
