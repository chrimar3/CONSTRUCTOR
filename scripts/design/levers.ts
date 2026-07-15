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
      { dimension: "typography", gain: 2 },
      { dimension: "hierarchy", gain: 1 },
    ],
    note: "Introduces CSS custom properties for the token set; every component styles through them. Closes the palette + type objective gates simultaneously.",
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
    id: "type-scale-snap",
    title: "Snap all font sizes to the pinned scale {13,15,17,20,24} + tabular money",
    zone: "GREEN",
    effort: 2,
    allScreens: true,
    affects: [{ dimension: "typography", gain: 2 }],
    note: "Closes the type-discipline objective gate; complements the token layer.",
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
