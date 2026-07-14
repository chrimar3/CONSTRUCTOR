// DESIGN-LOOP Round 0 — build the self-contained baseline artifact (HTML deck):
// scores matrix + mechanical gates + honest caveats + the 8 screenshots embedded
// as data URIs. Output is a single file for the Artifact tool (CSP-safe: no
// external resource). Not committed (presentation of a gitignored capture).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "artifacts/design/round-0";
const DEST = process.env.ARTIFACT_DEST ?? "/private/tmp/claude-501/-Users-chrism-Project-with-Claude/604442f1-cd1c-42a1-b715-9ff84b2419fa/scratchpad/design-round0-baseline.html";

const rec = JSON.parse(readFileSync(join(OUT, "baseline-report.json"), "utf8"));
const FRAMES = [
  ["frame-1-pin", "PIN gate", "pin"],
  ["frame-2-operator", "Ποιος είσαι; — operator", "operator"],
  ["frame-3-board", "Pipeline board", "board"],
  ["frame-4-sheet-lead", "Νέος — lead capture", "sheet-lead"],
  ["frame-5-sheet-viewing", "Επίσκεψη — viewing", "sheet-viewing"],
  ["frame-6-sheet-offer", "Προσφορά — offer", "sheet-offer"],
  ["frame-7-report-biweekly", "Biweekly builder report", "report-biweekly"],
  ["frame-8-report-monthly", "Monthly builder report", "report-monthly"],
];
const DIMS = [
  ["hierarchy", "Hierarchy", 20],
  ["completeness", "Info completeness", 20],
  ["warmth", "Warmth & brand", 15],
  ["typography", "Typography", 15],
  ["responsiveness", "Responsiveness", 10],
  ["ergonomics", "Capture ergonomics", 10],
  ["gravitas", "Report gravitas", 10],
];

const dataUri = (f: string) =>
  `data:image/jpeg;base64,${readFileSync(join(OUT, `${f}.jpeg`)).toString("base64")}`;

const byFrame: Record<string, any> = {};
for (const f of rec.panel.perFrame) byFrame[f.frame] = f;

// score → tone class
const tone = (v: number | null) =>
  v == null ? "na" : v >= 7.5 ? "hi" : v >= 6.5 ? "mid" : v >= 5.5 ? "lo" : "crit";

function matrixRows() {
  return FRAMES.map(([file, label, key]) => {
    const fr = byFrame[key];
    const cells = DIMS.map(([d]) => {
      const v = fr.dims[d];
      return `<td class="s ${tone(v)}">${v ?? "–"}</td>`;
    }).join("");
    return `<tr><th scope="row">${label}</th>${cells}<td class="s comp ${tone(fr.composite)}">${fr.composite.toFixed(2)}</td></tr>`;
  }).join("");
}

function dimFooter() {
  const cells = DIMS.map(([d]) => {
    const v = rec.panel.perDimensionOverall[d];
    const target = d === "warmth"; // lowest-scoring × high-weight → next elevation target
    return `<td class="s ${tone(v)}${target ? " target" : ""}">${v.toFixed(2)}</td>`;
  }).join("");
  return `<tr class="foot"><th scope="row">Median · overall</th>${cells}<td class="s comp hi">${rec.panel.overall.toFixed(2)}</td></tr>`;
}

function gatesStrip() {
  return rec.gates
    .map((g: any) => {
      const cls = g.pass ? "pass" : "fail";
      return `<div class="gate ${cls}"><span class="gm">${g.pass ? "PASS" : "FAIL"}</span><span class="gn">${g.gate}</span><span class="gv">${g.measured}</span>${g.detail ? `<span class="gd">${g.detail}</span>` : ""}</div>`;
    })
    .join("");
}

function gallery() {
  return FRAMES.map(([file, label, key]) => {
    const fr = byFrame[key];
    return `<figure class="shot"><div class="phone"><img loading="lazy" alt="${label}" src="${dataUri(file)}"></div><figcaption><span class="cap-l">${label}</span><span class="cap-s ${tone(fr.composite)}">${fr.composite.toFixed(2)}</span></figcaption></figure>`;
  }).join("");
}

const caveats = rec.caveats.map((c: string) => `<li>${c}</li>`).join("");
const gatesFail = rec.gates.filter((g: any) => !g.pass).length;
const gap = (8.5 - rec.panel.overall).toFixed(2);
const pctToTarget = Math.round((rec.panel.overall / 8.5) * 100);

const html = `<title>Constructor · DESIGN-LOOP Round 0 baseline</title>
<style>
:root{
  --pine:#14555a; --pine-2:#4fa3a8; --honey:#c89b3c; --honey-2:#d9ae55;
  --ground:#f3f0e9; --panel:#fbf9f4; --ink:#2a2320; --ink-soft:#5f574e;
  --line:#e2dccf; --hi:#2f7d5b; --mid:#7a6a3a; --lo:#9a6a2c; --crit:#a4432f;
  --pass:#2f7d5b; --fail:#a4432f;
  --shadow:0 1px 2px rgba(42,35,32,.06),0 8px 24px rgba(42,35,32,.08);
}
@media (prefers-color-scheme:dark){:root{
  --pine:#5cb6bb; --pine-2:#4fa3a8; --honey:#d9ae55; --honey-2:#e6c274;
  --ground:#161a1a; --panel:#1e2423; --ink:#ece7dd; --ink-soft:#a7a096;
  --line:#313a39; --hi:#57c495; --mid:#c9b06a; --lo:#d69a54; --crit:#e88168;
  --pass:#57c495; --fail:#e88168;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}}
:root[data-theme="light"]{
  --pine:#14555a; --pine-2:#4fa3a8; --honey:#c89b3c; --ground:#f3f0e9; --panel:#fbf9f4;
  --ink:#2a2320; --ink-soft:#5f574e; --line:#e2dccf;
  --hi:#2f7d5b; --mid:#7a6a3a; --lo:#9a6a2c; --crit:#a4432f; --pass:#2f7d5b; --fail:#a4432f;
  --shadow:0 1px 2px rgba(42,35,32,.06),0 8px 24px rgba(42,35,32,.08);
}
:root[data-theme="dark"]{
  --pine:#5cb6bb; --honey:#d9ae55; --ground:#161a1a; --panel:#1e2423;
  --ink:#ece7dd; --ink-soft:#a7a096; --line:#313a39;
  --hi:#57c495; --mid:#c9b06a; --lo:#d69a54; --crit:#e88168; --pass:#57c495; --fail:#e88168;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,56px)}
h1,h2,.serif{font-family:ui-serif,Georgia,"Times New Roman",serif;letter-spacing:-.01em}
.eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--pine)}
h1{font-size:clamp(28px,4.4vw,44px);margin:.28em 0 .1em;line-height:1.08;text-wrap:balance}
.sub{color:var(--ink-soft);font-size:15px;max-width:64ch}
.hero{display:grid;grid-template-columns:1fr;gap:28px;margin:28px 0 40px;
  padding:clamp(20px,3vw,32px);background:var(--panel);border:1px solid var(--line);
  border-radius:18px;box-shadow:var(--shadow)}
@media(min-width:720px){.hero{grid-template-columns:auto 1fr;align-items:center}}
.score{display:flex;align-items:baseline;gap:10px}
.score .now{font-family:ui-serif,Georgia,serif;font-size:clamp(56px,10vw,88px);font-weight:600;
  color:var(--pine);line-height:.9;font-variant-numeric:tabular-nums}
.score .of{font-size:20px;color:var(--ink-soft)}
.score .tgt{font-size:20px;color:var(--honey);font-weight:700;font-variant-numeric:tabular-nums}
.meter{margin-top:14px;height:10px;border-radius:99px;background:color-mix(in oklab,var(--line) 70%,transparent);overflow:hidden}
.meter span{display:block;height:100%;border-radius:99px;
  background:linear-gradient(90deg,var(--pine),var(--pine-2))}
.mnote{margin-top:8px;font-size:13px;color:var(--ink-soft)}
.mnote b{color:var(--honey);font-variant-numeric:tabular-nums}
.status{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.pill{font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:99px;border:1px solid var(--line);
  background:color-mix(in oklab,var(--panel) 60%,transparent);color:var(--ink-soft)}
.pill b{color:var(--ink)}
section{margin:40px 0}
h2{font-size:22px;margin:0 0 4px}
.lead{color:var(--ink-soft);font-size:14.5px;margin:0 0 18px;max-width:70ch}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:640px;font-size:13.5px}
th,td{padding:10px 12px;text-align:center;border-bottom:1px solid var(--line)}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);font-weight:700;
  position:sticky;top:0;background:var(--panel)}
thead th .w{display:block;font-size:10px;color:var(--pine);font-weight:600}
tbody th,tfoot th{text-align:left;font-weight:600;color:var(--ink);white-space:nowrap}
td.s{font-variant-numeric:tabular-nums;font-weight:600}
td.hi{color:var(--hi)} td.mid{color:var(--mid)} td.lo{color:var(--lo)} td.crit{color:var(--crit)} td.na{color:var(--ink-soft)}
td.comp{font-weight:800;background:color-mix(in oklab,var(--honey) 8%,transparent)}
tr.foot td,tr.foot th{border-top:2px solid var(--line);border-bottom:none;background:color-mix(in oklab,var(--pine) 6%,transparent)}
td.target{outline:2px solid var(--honey);outline-offset:-2px;border-radius:6px}
.gates{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.gate{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--panel);
  border-left-width:4px}
.gate.pass{border-left-color:var(--pass)} .gate.fail{border-left-color:var(--fail)}
.gm{font-size:11px;font-weight:800;letter-spacing:.06em}
.gate.pass .gm{color:var(--pass)} .gate.fail .gm{color:var(--fail)}
.gn{display:block;font-weight:700;font-size:15px;margin:2px 0 3px}
.gv{display:block;font-size:12.5px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.gd{display:block;font-size:11.5px;color:var(--ink-soft);margin-top:4px;word-break:break-word;opacity:.85}
.callout{border:1px solid var(--line);border-left:4px solid var(--honey);background:color-mix(in oklab,var(--honey) 7%,var(--panel));
  border-radius:12px;padding:16px 20px}
.callout h3{margin:0 0 8px;font-size:15px;font-family:system-ui,sans-serif;color:var(--honey-2,var(--honey))}
.callout ul{margin:0;padding-left:18px}
.callout li{margin:7px 0;font-size:13.5px;color:var(--ink)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:22px}
.shot{margin:0}
.phone{border-radius:22px;overflow:hidden;border:1px solid var(--line);background:#fff;box-shadow:var(--shadow);aspect-ratio:390/844}
.phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
figcaption{display:flex;justify-content:space-between;align-items:baseline;margin-top:9px;gap:8px}
.cap-l{font-size:12.5px;color:var(--ink-soft);font-weight:600}
.cap-s{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
.cap-s.hi{color:var(--hi)} .cap-s.mid{color:var(--mid)} .cap-s.lo{color:var(--lo)} .cap-s.crit{color:var(--crit)}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-soft)}
footer b{color:var(--ink)}
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">Constructor · DESIGN-LOOP · Round 0 baseline</div>
    <h1>How far today's app sits from «Πεύκο &amp; Μέλι»</h1>
    <p class="sub">A blind 3-judge panel and seven scripted mechanical gates, run on the current app over a seeded fixture at 390×844@2×. This is the floor the elevation rounds climb from — not a verdict on the work, a measurement of the distance to the target.</p>
  </header>

  <div class="hero">
    <div>
      <div class="score"><span class="now">${rec.panel.overall.toFixed(2)}</span><span class="of">/ 10 today</span></div>
      <div class="meter"><span style="width:${pctToTarget}%"></span></div>
      <div class="mnote">Target <b>8.5</b> · gap <b>${gap}</b> · ${pctToTarget}% of the way</div>
    </div>
    <div>
      <div class="status">
        <span class="pill"><b>${rec.panel.judgesValid}/3</b> judges valid</span>
        <span class="pill"><b>8</b> frames · single theme</span>
        <span class="pill"><b>${gatesFail}/${rec.gates.length}</b> mechanical gates fail</span>
        <span class="pill">board high <b>7.90</b></span>
        <span class="pill">PIN / operator low <b>5.05</b></span>
      </div>
      <p class="mnote" style="margin-top:14px">Lowest dimension × weight → <b style="color:var(--honey)">Warmth &amp; brand (5.75, 15%)</b>: the elevation target the loop would pick first — and exactly what «Πεύκο &amp; Μέλι» supplies.</p>
    </div>
  </div>

  <section>
    <h2>Judged dimensions — median of the blind panel</h2>
    <p class="lead">Each frame scored 1–10 on the seven rubric dimensions; three disjoint personas (field-operator · brand/typography critic · builder-client) on neutral, per-judge-shuffled decks; median taken. Composite = the rubric's weighted mean.</p>
    <div class="tablewrap">
      <table>
        <thead><tr><th scope="col">Screen</th>${DIMS.map(([, l, w]) => `<th scope="col">${l}<span class="w">${w}%</span></th>`).join("")}<th scope="col">Composite</th></tr></thead>
        <tbody>${matrixRows()}</tbody>
        <tfoot>${dimFooter()}</tfoot>
      </table>
    </div>
  </section>

  <section>
    <h2>Mechanical gates — scripted, binary</h2>
    <p class="lead">Computed from the live DOM at capture time (contrast, palette, type, targets) plus the determinism suite. Three fail by design — the «Πεύκο &amp; Μέλι» palette, type scale, and honey signal are simply not implemented yet.</p>
    <div class="gates">${gatesStrip()}</div>
  </section>

  <section>
    <h2>Read the numbers honestly</h2>
    <div class="callout">
      <h3>Why the panel likely reads HIGH</h3>
      <ul>${caveats}</ul>
    </div>
  </section>

  <section>
    <h2>The 8 frames scored</h2>
    <p class="lead">The exact deck the panel saw, in canonical order (the judges saw them shuffled under neutral names). Every frame is the current, unmodified app.</p>
    <div class="gallery">${gallery()}</div>
  </section>

  <footer>
    <p><b>Round 0 stops here — awaiting your ratification of the 8.5 target</b> before any elevation round. Regenerate this whole baseline byte-for-byte with <b>bash scripts/design-gates.sh</b>. Rubric, anti-drift protocol and exit criteria: <b>DESIGN-LOOP.md</b>. Dependency &amp; scope rationale: <b>ADR-0035</b>, DECISIONS.md.</p>
  </footer>
</div>`;

writeFileSync(DEST, html);
console.log(`artifact → ${DEST} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
