// DESIGN-LOOP Round 0 — «Πεύκο & Μέλι» token spec + pure mechanical-gate logic.
//
// SOURCE OF TRUTH: the hex values marked (verbatim) are quoted directly from
// DESIGN-LOOP.md. The neutral grounds/ink/cool values are marked PROVISIONAL —
// their exact hexes live in the external "UX/UI Elevation Plan" artifact, not in
// the repo. They do NOT affect the Round-0 baseline conclusion (the current app
// uses none of them either), and must be ratified into this file before an
// elevation round claims token compliance. Until then the token gate reports the
// baseline honestly: how far the CURRENT palette is from the target.

export const PALETTE = {
  // Aegean-pine accent (verbatim — DESIGN-LOOP.md)
  pine: { dark: "#14555a", light: "#4fa3a8" },
  // ONE honey signal, money + save-moment only, <=5% of any screen (verbatim)
  honey: { warm: "#c89b3c", bright: "#d9ae55" },
  // Grounds + ink + the single cool hue — PROVISIONAL placeholders (see note above)
  grounds: { alabaster: "#f7f5f0", espresso: "#2a2320" },
  ink: { warm: "#3b342e" },
  cool: { psychros: "#3e5c6e" }, // Ψυχρός — the palette's only cool hue
} as const;

/** Every token hex, normalized — the allowed set for "0 off-palette colors". */
export const PALETTE_HEXES: ReadonlySet<string> = new Set([
  PALETTE.pine.dark,
  PALETTE.pine.light,
  PALETTE.honey.warm,
  PALETTE.honey.bright,
  PALETTE.grounds.alabaster,
  PALETTE.grounds.espresso,
  PALETTE.ink.warm,
  PALETTE.cool.psychros,
  // pure black/white are always permitted as ink/ground extremes
  "#000000",
  "#ffffff",
]);

/** Pinned type scale (verbatim — DESIGN-LOOP.md): 13/15/17/20/24 px. */
export const TYPE_SCALE: readonly number[] = [13, 15, 17, 20, 24] as const;

/** Radius language (verbatim): 14 / 999 / 20 / 12. */
export const RADII: readonly number[] = [14, 999, 20, 12] as const;

/** Honey budget: honey may paint at most this share of any screen's pixels. */
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

export function isHoneyToken(hex: string): boolean {
  const h = normalizeHex(hex);
  return h === PALETTE.honey.warm || h === PALETTE.honey.bright;
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
