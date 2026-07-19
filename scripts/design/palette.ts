// DESIGN VARIANT A — "Airbnb-warm": the token spec the mechanical gates check,
// reconciled to what src/web/index.html and src/report/html.ts ACTUALLY ship on
// this branch. This file and index.html are the two faces of one token set and
// MUST stay in step — a gate checking a palette the app does not paint proves
// nothing.
//
// Direction: pure-white ground, ONE confident teal accent spent only on meaning
// (primary action, operator identity, the next-action label), soft shadow in
// place of a card border, 16px radii, generous air. Money is bold tabular INK —
// variant A ships NO money colour at all.

export const PALETTE = {
  // The single accent — primary action, identity, next-action label (verbatim
  // from src/web/index.html :root).
  accent: { base: "#0f7a6c", press: "#0b6357", soft: "#d9eae7" },
  // Grounds + ink.
  grounds: { white: "#ffffff", field: "#f4f4f4" },
  ink: { primary: "#1c1c1c", secondary: "#5e5e5e" },
  // Temperature — carried by a dot + label only, never a filled pill.
  temp: { hot: "#b3392e", warm: "#8a5a12", cold: "#2f6d7d" },
} as const;

/**
 * Every token hex the app actually paints, normalized — the allowed set for "0
 * off-palette colors". Mirrors src/web/index.html :root. Variant A ships a
 * SINGLE (light) theme by deliberate choice (ADR-0037), so unlike the previous
 * token set there are no dark-theme hexes to admit.
 */
export const PALETTE_HEXES: ReadonlySet<string> = new Set([
  "#ffffff", "#f4f4f4",                          // grounds
  "#1c1c1c", "#5e5e5e", "#b0b0b0",               // ink
  "#ebebeb", "#dddddd",                          // lines
  "#0f7a6c", "#0b6357", "#d9eae7",               // accent family
  "#b3392e", "#fbeceb",                          // hot / Θερμός
  "#8a5a12", "#f8f0e2",                          // warm / Χλιαρός
  "#2f6d7d", "#e8f1f4",                          // cold / Ψυχρός
  "#000000",                                     // pure black always permitted
]);

/** Pinned type scale (variant A — friendlier and larger than the old 13/15/17/20/24). */
export const TYPE_SCALE: readonly number[] = [13, 15, 17, 22, 26] as const;

/** Radius language (variant A): card / pill / field / button. */
export const RADII: readonly number[] = [16, 999, 12, 14] as const;

/**
 * Retired-signal budget. The rejected «Πεύκο & Μέλι» pass painted € figures gold;
 * the AVOID LIST forbids it, and variant A sets money as bold ink instead. The
 * honey family below is therefore kept deliberately — not as a colour the design
 * uses, but as a DETECTOR: any reappearance of the gold money signal makes this
 * share non-zero and the gate visible. Expected reading is 0.0% on every frame.
 */
export const HONEY_MAX_SHARE = 0.05;

// ─── Color parsing + WCAG contrast ───────────────────────────────────────────

/** Fold "#14555A", "#FFF", or "rgb(20,85,90)" to canonical "#rrggbb" lowercase. */
export function normalizeHex(input: string): string {
  const s = input.trim().toLowerCase();
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  }
  const hex = s.replace(/[^0-9a-f]/g, "");
  if (hex.length === 3) {
    return "#" + hex.split("").map((c) => c + c).join("");
  }
  if (hex.length === 6) return "#" + hex;
  if (hex.length === 8) return "#" + hex.slice(0, 6); // drop alpha
  return s; // leave unrecognized forms untouched (they'll read as off-palette)
}

function toRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance of an sRGB color. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio in [1, 21], order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Membership checks ───────────────────────────────────────────────────────

export function isOnPalette(hex: string): boolean {
  return PALETTE_HEXES.has(normalizeHex(hex));
}

/** The retired honey family — the gold accents AND the honey-ink once used for
    € text. Variant A paints none of them; this set exists to detect a relapse. */
const HONEY_HEXES = new Set(["#c89b3c", "#d9ae55", "#7a5a1e", "#e6c274"]);
export function isHoneyToken(hex: string): boolean {
  return HONEY_HEXES.has(normalizeHex(hex));
}

export function isOnScale(px: number): boolean {
  return TYPE_SCALE.includes(px);
}

/** Honey painted-pixel share = honey area / total painted area. */
export function honeyShare(paintedByColor: Record<string, number>): number {
  let total = 0;
  let honey = 0;
  for (const [color, count] of Object.entries(paintedByColor)) {
    total += count;
    if (isHoneyToken(color)) honey += count;
  }
  return total === 0 ? 0 : honey / total;
}
