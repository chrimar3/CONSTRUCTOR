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
    title: "Information completeness on the PIN + operator entry screens",
    zone: "YELLOW",
    effort: 3,
    affects: [
      { screen: "pin", dimension: "completeness", gain: 4 },
      { screen: "operator", dimension: "completeness", gain: 4 },
      { screen: "pin", dimension: "hierarchy", gain: 1 },
      { screen: "operator", dimension: "hierarchy", gain: 1 },
    ],
    note: "Both entry screens scored completeness ~3 (sparse). Add orienting context/branding without adding taps.",
  },
  {
    id: "contrast-aa",
    title: "Bring every text pair to WCAG AA",
    zone: "GREEN",
    effort: 2,
    allScreens: true,
    affects: [{ dimension: "hierarchy", gain: 1 }],
    note: "Raises cap_hierarchy toward 10; closes the contrast objective gate. Mechanical, low-risk.",
  },
  {
    id: "tabular-numerals",
    title: "Tabular numerals on money + counts (the type scale itself is folded into the token layer)",
    zone: "GREEN",
    effort: 1,
    allScreens: true,
    // The pinned scale is defined by the token layer (tokens-pinemeli), so only the
    // non-overlapping remnant remains here: tabular figures so € amounts and counts
    // align as data. Small but real for a money CRM. Headroom largely collapses once
    // the token layer lands — the loop's re-measure self-corrects this (research, 2026-07-15).
    affects: [{ dimension: "typography", gain: 0.5 }],
    note: "Fast follow-up after the token layer: font-variant-numeric: tabular-nums on every €/count element.",
  },
  {
    id: "honey-signal",
    title: "Introduce the honey signal on money + save surfaces (≤5%)",
    zone: "YELLOW",
    effort: 2,
    affects: [
      { screen: "board", dimension: "warmth", gain: 1 },
      { screen: "sheet-offer", dimension: "warmth", gain: 1 },
      { screen: "report-biweekly", dimension: "gravitas", gain: 1 },
      { screen: "report-monthly", dimension: "gravitas", gain: 1 },
    ],
    note: "Depends on the token layer for the honey value; satisfies the honey-correctness objective gate.",
  },
  {
    id: "report-gravitas",
    title: "Report typography: serif headings + tabular figures + tighter hierarchy",
    zone: "YELLOW",
    effort: 3,
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
    allScreens: true,
    affects: [{ dimension: "responsiveness", gain: 2 }],
    note: "Responsiveness was the lowest raw dimension (5.5). prefers-reduced-motion collapses all.",
  },
];
