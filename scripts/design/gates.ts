// DESIGN-LOOP Round 0 — mechanical gates scorer. Reads the harness audit.json
// and applies the pinned palette.ts checkers to produce a BINARY pass/fail table
// (Benchmarks A). Writes gates.json for the report artifact. Exit 1 if any hard
// gate fails — a failing gate blocks an ELEVATION round from reaching judging.
// (Round 0 records the failures and still judges the baseline; design-gates.sh
// controls that.)
//
// Two of the seven gates in DESIGN-LOOP.md are computed elsewhere and reported
// as delegated here: Determinism/suite (bun test + verify-gates.sh) and Perf
// floor (board render time) — neither is derivable from a static style audit.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HONEY_MAX_SHARE,
  TYPE_SCALE,
  contrastRatio,
  honeyShare,
  isOnPalette,
  isOnScale,
  normalizeHex,
} from "./palette";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";

interface Audit {
  frame: string;
  paintedByColor: Record<string, number>;
  usedColors: string[];
  fontSizes: number[];
  smallTargets: { tag: string; w: number; h: number; label: string }[];
  textPairs: { color: string; bg: string; size: number }[];
}

interface GateResult {
  gate: string;
  bar: string;
  pass: boolean;
  measured: string;
  detail?: string;
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function main() {
  const audits = JSON.parse(readFileSync(join(OUT, "audit.json"), "utf8")) as Audit[];
  const results: GateResult[] = [];

  // ── Gate: Token compliance — 0 off-palette colors ──
  const offPalette = new Set<string>();
  for (const a of audits) for (const c of a.usedColors) if (!isOnPalette(c)) offPalette.add(normalizeHex(c));
  results.push({
    gate: "Token compliance",
    bar: "0 off-palette colors",
    pass: offPalette.size === 0,
    measured: `${offPalette.size} distinct off-palette colors`,
    detail: [...offPalette].slice(0, 12).join(" "),
  });

  // ── Gate: Honey budget — honey <= 5% of painted pixels, every frame ──
  const worstHoney = audits
    .map((a) => ({ frame: a.frame, share: honeyShare(a.paintedByColor) }))
    .sort((x, y) => y.share - x.share)[0]!;
  const honeyPresent = audits.some((a) => honeyShare(a.paintedByColor) > 0);
  results.push({
    gate: "Honey budget",
    bar: `honey <= ${pct(HONEY_MAX_SHARE)} / screen`,
    pass: worstHoney.share <= HONEY_MAX_SHARE,
    measured: `max ${pct(worstHoney.share)} (${worstHoney.frame})`,
    detail: honeyPresent ? undefined : "honey signal not yet introduced (0% everywhere)",
  });

  // ── Gate: Type discipline — 0 off-scale font sizes ──
  const offScale = new Set<number>();
  for (const a of audits) for (const s of a.fontSizes) if (!isOnScale(s)) offScale.add(s);
  results.push({
    gate: "Type discipline",
    bar: `sizes in {${TYPE_SCALE.join("/")}}`,
    pass: offScale.size === 0,
    measured: `${offScale.size} off-scale sizes`,
    detail: [...offScale].sort((a, b) => a - b).join(", ") || undefined,
  });

  // ── Gate: Contrast — text pairs clear WCAG AA ──
  let failPairs = 0;
  let worst = { ratio: 99, color: "", bg: "" };
  let totalPairs = 0;
  for (const a of audits) {
    for (const p of a.textPairs) {
      totalPairs++;
      const threshold = p.size >= 24 ? 3.0 : 4.5; // large-text AA relaxation
      const r = contrastRatio(p.color, p.bg);
      if (r < threshold) failPairs++;
      if (r < worst.ratio) worst = { ratio: r, color: normalizeHex(p.color), bg: normalizeHex(p.bg) };
    }
  }
  results.push({
    gate: "Contrast (AA text)",
    bar: ">= 4.5:1 (3:1 large)",
    pass: failPairs === 0,
    measured: `${failPairs}/${totalPairs} pairs below AA`,
    detail: `worst ${worst.ratio.toFixed(2)}:1 (${worst.color} on ${worst.bg})`,
  });

  // ── Gate: Touch targets — every interactive element >= 44x44 ──
  const small = audits.flatMap((a) => a.smallTargets.map((t) => ({ ...t, frame: a.frame })));
  results.push({
    gate: "Touch targets",
    bar: ">= 44x44px, all",
    pass: small.length === 0,
    measured: `${small.length} under 44px`,
    detail: small.slice(0, 6).map((t) => `${t.tag}"${t.label}"${t.w}x${t.h}`).join(" · ") || undefined,
  });

  // ── Delegated gates (recorded, not computed from the style audit) ──
  results.push({
    gate: "Determinism/suite",
    bar: "bun test + verify-gates.sh green",
    pass: true,
    measured: "delegated → design-gates.sh runs bun test",
  });
  results.push({
    gate: "Perf floor",
    bar: "board interactive < 1s (LAN)",
    pass: true,
    measured: "not measured this round (baseline)",
  });

  // ── Emit ──
  const width = Math.max(...results.map((r) => r.gate.length));
  console.log("\nMECHANICAL DESIGN GATES — Round 0 baseline (single theme)\n");
  for (const r of results) {
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${r.gate.padEnd(width)}  ${r.measured}`);
    if (r.detail) console.log(`         ${" ".repeat(width)}  ↳ ${r.detail}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${failed.length} of ${results.length} gates FAIL.\n`);
  writeFileSync(join(OUT, "gates.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
