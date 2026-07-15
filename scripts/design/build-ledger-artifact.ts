// IMPACT-LOOP — build the round artifact (HTML): the honest benchmark with the
// drift made visible (honest composite vs raw panel), the tier + next gate, the
// O/S per-screen split, and the impact-ranked lever backlog with the recommended
// next lever highlighted. Self-contained (CSP-safe), «Πεύκο & Μέλι» styling.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const DEST =
  process.env.ARTIFACT_DEST ??
  "/private/tmp/claude-501/-Users-chrism-Project-with-Claude/604442f1-cd1c-42a1-b715-9ff84b2419fa/scratchpad/impact-loop-round.html";

const bench = JSON.parse(readFileSync(join(OUT, "benchmark.json"), "utf8"));
const ledger = JSON.parse(readFileSync(join(OUT, "ledger.json"), "utf8"));

const DIMS = ["hierarchy", "completeness", "warmth", "typography", "responsiveness", "ergonomics", "gravitas"];
const DIM_L: Record<string, string> = {
  hierarchy: "Hierarchy", completeness: "Complete", warmth: "Warmth", typography: "Type",
  responsiveness: "Respons.", ergonomics: "Ergon.", gravitas: "Gravitas",
};
const tone = (v: number) => (v >= 7.5 ? "hi" : v >= 6.5 ? "mid" : v >= 5.5 ? "lo" : "crit");

const screens = Object.keys(bench.perScreen);
const rows = screens
  .map((s) => {
    const v = bench.perScreen[s];
    const dimCells = DIMS.map((d) => `<td class="s ${tone(v.dims[d])}">${v.dims[d]}</td>`).join("");
    return `<tr><th scope="row">${s}</th>${dimCells}<td class="s comp ${tone(v.composite)}">${v.composite}</td><td class="s panel">${v.sComposite}</td><td class="s drift${v.driftFlagged ? " flag" : ""}">${v.drift > 0 ? "−" : ""}${Math.abs(v.drift)}</td></tr>`;
  })
  .join("");

const levers = ledger.ranked
  .map((r: any, i: number) => {
    const rec = i === 0;
    return `<div class="lever${rec ? " rec" : ""} ${r.lever.zone.toLowerCase()}">
      <div class="lv-rank">${i + 1}</div>
      <div class="lv-body">
        <div class="lv-title">${r.lever.title}${rec ? '<span class="rec-tag">recommended</span>' : ""}</div>
        <div class="lv-meta"><b>ExpectedLift ${r.expectedLift.toFixed(2)}</b> · priority ${r.priority.toFixed(2)} · effort ${r.lever.effort} · <span class="zone ${r.lever.zone.toLowerCase()}">${r.lever.zone}</span></div>
      </div></div>`;
  })
  .join("");

const t = ledger.tier;
const obj = ledger.objective ?? {};
const html = `<title>IMPACT-LOOP · round · ${t.tier} ${bench.overall}/10</title>
<style>
:root{--pine:#14555a;--pine2:#4fa3a8;--honey:#c89b3c;--ground:#f3f0e9;--panel:#fbf9f4;--ink:#2a2320;--soft:#5f574e;--line:#e2dccf;--hi:#2f7d5b;--mid:#7a6a3a;--lo:#9a6a2c;--crit:#a4432f;--shadow:0 1px 2px rgba(42,35,32,.06),0 8px 24px rgba(42,35,32,.08)}
@media(prefers-color-scheme:dark){:root{--pine:#5cb6bb;--honey:#d9ae55;--ground:#161a1a;--panel:#1e2423;--ink:#ece7dd;--soft:#a7a096;--line:#313a39;--hi:#57c495;--mid:#c9b06a;--lo:#d69a54;--crit:#e88168;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35)}}
:root[data-theme=light]{--pine:#14555a;--honey:#c89b3c;--ground:#f3f0e9;--panel:#fbf9f4;--ink:#2a2320;--soft:#5f574e;--line:#e2dccf;--hi:#2f7d5b;--mid:#7a6a3a;--lo:#9a6a2c;--crit:#a4432f}
:root[data-theme=dark]{--pine:#5cb6bb;--honey:#d9ae55;--ground:#161a1a;--panel:#1e2423;--ink:#ece7dd;--soft:#a7a096;--line:#313a39;--hi:#57c495;--mid:#c9b06a;--lo:#d69a54;--crit:#e88168}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:system-ui,-apple-system,sans-serif;line-height:1.55}
.wrap{max-width:960px;margin:0 auto;padding:clamp(20px,4vw,52px)}
h1,h2{font-family:ui-serif,Georgia,serif;letter-spacing:-.01em}
.eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--pine)}
h1{font-size:clamp(26px,4vw,40px);margin:.3em 0 .1em;text-wrap:balance}
.hero{display:flex;flex-wrap:wrap;gap:28px;align-items:center;margin:24px 0 36px;padding:clamp(18px,3vw,30px);background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
.now{font-family:ui-serif,Georgia,serif;font-size:clamp(48px,9vw,78px);font-weight:600;color:var(--pine);line-height:.9;font-variant-numeric:tabular-nums}
.tier{font-size:13px;font-weight:800;letter-spacing:.05em;color:var(--honey);text-transform:uppercase}
.pill{font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:99px;border:1px solid var(--line);color:var(--soft)}
.pill b{color:var(--ink)}
.status{display:flex;flex-wrap:wrap;gap:9px}
section{margin:36px 0}h2{font-size:21px;margin:0 0 4px}.lead{color:var(--soft);font-size:14px;margin:0 0 16px;max-width:70ch}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:680px;font-size:13px}
th,td{padding:9px 11px;text-align:center;border-bottom:1px solid var(--line)}
thead th{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--soft);font-weight:700}
tbody th{text-align:left;font-weight:600;white-space:nowrap}
td.s{font-variant-numeric:tabular-nums;font-weight:600}
td.hi{color:var(--hi)}td.mid{color:var(--mid)}td.lo{color:var(--lo)}td.crit{color:var(--crit)}
td.comp{font-weight:800;background:color-mix(in oklab,var(--pine) 8%,transparent)}
td.panel{color:var(--soft)}td.drift{color:var(--soft);font-variant-numeric:tabular-nums}td.drift.flag{color:var(--crit);font-weight:800}
.lever{display:flex;gap:14px;align-items:center;padding:13px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:10px;border-left-width:4px;border-left-color:var(--line)}
.lever.rec{border-left-color:var(--honey);background:color-mix(in oklab,var(--honey) 7%,var(--panel))}
.lv-rank{font-family:ui-serif,Georgia,serif;font-size:22px;font-weight:600;color:var(--soft);min-width:26px;text-align:center}
.lv-title{font-weight:700;font-size:15px}.rec-tag{margin-left:9px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--honey)}
.lv-meta{font-size:12.5px;color:var(--soft);font-variant-numeric:tabular-nums;margin-top:2px}
.zone{font-weight:800}.zone.green{color:var(--hi)}.zone.yellow{color:var(--mid)}.zone.red{color:var(--crit)}
.callout{border:1px solid var(--line);border-left:4px solid var(--pine);background:color-mix(in oklab,var(--pine) 6%,var(--panel));border-radius:12px;padding:15px 19px;font-size:13.5px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--soft)}
footer b{color:var(--ink)}
</style>
<div class="wrap">
  <div class="eyebrow">Constructor · IMPACT-LOOP · round measurement</div>
  <h1>Honest benchmark &amp; the next highest-leverage lever</h1>
  <div class="hero">
    <div>
      <div class="now">${bench.overall}</div>
      <div class="tier">${t.tier} · ${t.label}</div>
    </div>
    <div style="flex:1;min-width:240px">
      <div class="status">
        <span class="pill">honest, capped by objective fact</span>
        <span class="pill">raw panel <b>${(bench.overall + bench.overallDrift).toFixed(2)}</b> → drift <b>${bench.overallDrift}</b>${bench.driftFlagged ? " ⚠" : ""}</span>
        <span class="pill">weakest <b>${bench.minScreen.screen} ${bench.minScreen.composite}</b></span>
        <span class="pill">off-palette <b>${obj.offPaletteShare != null ? Math.round(obj.offPaletteShare * 100) + "%" : "—"}</b></span>
        <span class="pill">honey <b>${obj.honeyCorrect ? "ok" : "absent"}</b></span>
      </div>
      <div class="callout" style="margin-top:14px"><b>Next gate (${t.tier} → next):</b> ${t.nextGate}</div>
    </div>
  </div>

  <section>
    <h2>Per-screen — honest vs raw panel (drift made visible)</h2>
    <p class="lead">Each dimension is the panel's median <em>capped by objective reality</em> and blended with it. <b>Honest</b> = the composite that counts; <b>Panel</b> = the raw uncapped panel; <b>Drift</b> = how far the panel floated above the facts.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Screen</th>${DIMS.map((d) => `<th>${DIM_L[d]}</th>`).join("")}<th>Honest</th><th>Panel</th><th>Drift</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>

  <section>
    <h2>Impact ledger — levers ranked by ExpectedLift ÷ effort</h2>
    <p class="lead">ExpectedLift = Σ rubric-weight · min(headroom, estimated gain) over every (screen, dimension) a lever touches. The top lever is the recommended next round — implemented under all rails as its own commit + ADR, then the lift is verified.</p>
    ${levers}
  </section>

  <footer><p><b>Proposal only.</b> Implementing the recommended lever is a separate, human-gated round (one lever = one commit = one ADR = one attributable score move). Regenerate: the <b>impact-loop</b> Workflow. Method: <b>IMPACT-LOOP.md</b>; rationale: <b>ADR-0036</b>.</p></footer>
</div>`;

writeFileSync(DEST, html);
console.log(`ledger artifact → ${DEST} (${(html.length / 1024).toFixed(0)} KB)`);
