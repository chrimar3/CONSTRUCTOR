// B0b — src/report/html.ts: deterministic hand-rolled renderer for EXACTLY the
// Markdown subset the reports emit (RULING 2026-07-14b: builders receive a
// styled self-contained HTML file; plan.md sanctions "Markdown → optional HTML").
//
// Subset (enumerated from biweekly.ts / monthly.ts / separation.ts output):
// #/##/### headings · **bold** inline · "- " list items · | pipe | tables with
// a | --- | separator row · fully-wrapped _italic_ lines/items · single-line
// HTML comments (INSIGHTS markers) · paragraphs · blank lines.
//
// Security: ALL content is HTML-entity-escaped BEFORE inline markup is applied
// — user-entered text (next_action, names, micro-areas) is XSS-safe by
// construction, pinned with a <script> payload below. Article III: the renderer
// is a pure string function — same Markdown in ⇒ same HTML bytes out, no
// wall-clock/randomness/ICU of its own (spawn test compares bytes twice).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../src/db/init";
import { seed, type SeedFile } from "../src/db/seed";
import { biweeklyReport } from "../src/report/biweekly";
import { htmlDocument, markdownToHtml } from "../src/report/html";

// ─── Renderer unit tests — one per emitted construct ─────────────────────────

describe("markdownToHtml — the report Markdown subset", () => {
  test("headings: # / ## / ### render as h1 / h2 / h3", () => {
    const html = markdownToHtml("# Τίτλος\n\n## Ενότητα\n\n### Μονάδα Β1");
    expect(html).toContain("<h1>Τίτλος</h1>");
    expect(html).toContain("<h2>Ενότητα</h2>");
    expect(html).toContain("<h3>Μονάδα Β1</h3>");
  });

  test("bold: **…** renders as <strong> inside a paragraph", () => {
    const html = markdownToHtml("**Κατασκευαστής:** Κατασκευαστική Άλφα ΑΕ");
    expect(html).toContain("<p><strong>Κατασκευαστής:</strong> Κατασκευαστική Άλφα ΑΕ</p>");
  });

  test("list: consecutive '- ' lines render as ONE <ul> of <li>", () => {
    const html = markdownToHtml("- Επίσκεψη: 3\n- Προσφορά: 0\n- **Σύσταση:** ενέργεια");
    const uls = html.match(/<ul>/g) ?? [];
    expect(uls.length).toBe(1);
    expect(html).toContain("<li>Επίσκεψη: 3</li>");
    expect(html).toContain("<li>Προσφορά: 0</li>");
    expect(html).toContain("<li><strong>Σύσταση:</strong> ενέργεια</li>");
  });

  test("italic: a fully-wrapped _…_ paragraph and list item render as <em>", () => {
    const para = markdownToHtml("_Η αναφορά παράχθηκε ντετερμινιστικά._");
    expect(para).toContain("<p><em>Η αναφορά παράχθηκε ντετερμινιστικά.</em></p>");
    const item = markdownToHtml("- _[Επισήμανση 1 — προς συμπλήρωση]_");
    expect(item).toContain("<li><em>[Επισήμανση 1 — προς συμπλήρωση]</em></li>");
  });

  test("underscores inside plain content are NOT italicized (only full wraps)", () => {
    const html = markdownToHtml("Μονάδα A_1 και A_2");
    expect(html).toContain("<p>Μονάδα A_1 και A_2</p>");
    expect(html).not.toContain("<em>");
  });

  test("table: header + --- separator + rows render as thead th / tbody td", () => {
    const html = markdownToHtml(
      "| Χειριστής | Γεγονότα |\n| --- | --- |\n| Χρήστος | 3 |\n| Λωίδα | 2 |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead><tr><th>Χειριστής</th><th>Γεγονότα</th></tr></thead>");
    expect(html).toContain("<tr><td>Χρήστος</td><td>3</td></tr>");
    expect(html).toContain("<tr><td>Λωίδα</td><td>2</td></tr>");
    expect(html).toContain("</table>");
  });

  test("paragraph: a plain line renders as <p>", () => {
    const html = markdownToHtml("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    expect(html).toContain("<p>Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.</p>");
  });

  test("INSIGHTS marker comment lines pass through verbatim (machine-findable in HTML too)", () => {
    const marker = "<!-- INSIGHTS:START — επικολλήστε εδώ 2–3 επισημάνσεις. -->";
    const html = markdownToHtml(`${marker}\n- _[Επισήμανση 1]_\n<!-- INSIGHTS:END -->`);
    expect(html).toContain(marker);
    expect(html).toContain("<!-- INSIGHTS:END -->");
  });

  test("comment-like line with an EARLY --> terminator is escaped, never passed through", () => {
    // A crafted line that would break out of a real comment must render inert.
    const html = markdownToHtml("<!-- x --><script>alert(1)</script><!-- -->");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("entity escaping: & < > \" in content are escaped", () => {
    const html = markdownToHtml('Πλατεία & <block> "Α"');
    expect(html).toContain("Πλατεία &amp; &lt;block&gt; &quot;Α&quot;");
  });

  test("XSS: a <script> payload in user-entered next_action text renders inert", () => {
    // next_action is operator free text — the exact class the escaping policy exists for.
    const html = markdownToHtml('- Επόμενη ενέργεια: <script>alert("pii")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;pii&quot;)&lt;/script&gt;");
  });

  test("escaping happens BEFORE inline markup: bold still applies around escaped content", () => {
    const html = markdownToHtml("**Σύσταση:** τιμή < 200 & έλεγχος");
    expect(html).toContain("<strong>Σύσταση:</strong> τιμή &lt; 200 &amp; έλεγχος");
  });

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
});

// ─── Document shell ───────────────────────────────────────────────────────────

describe("htmlDocument — self-contained Greek document shell", () => {
  const doc = htmlDocument("# Αναφορά προόδου πωλήσεων — Αυλή Κυψέλης\n\nΣώμα.");

  test('starts with <!doctype html> and <html lang="el">', () => {
    expect(doc).toStartWith('<!doctype html>\n<html lang="el">');
    expect(doc).toEndWith("</html>\n");
  });

  test("head carries charset + viewport meta and inline CSS only", () => {
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(doc).toContain("<style>");
    // Self-contained: travels as an email attachment — no EXTERNAL resource may
    // be fetched. No element refs (src=/href=), no @import, no absolute URL.
    expect(doc).not.toMatch(/src=|href=|@import|https?:\/\//);
    // url() is permitted ONLY as a self-contained data: URI (the embedded webfont
    // subset) — a route/relative ref would be an external fetch in an email.
    for (const m of doc.matchAll(/url\(\s*([^)]*)/g)) {
      expect(m[1]!.replace(/['"]/g, "").trim().startsWith("data:")).toBe(true);
    }
  });

  test("title is the first H1 text", () => {
    expect(doc).toContain("<title>Αναφορά προόδου πωλήσεων — Αυλή Κυψέλης</title>");
  });

  test("title falls back to a fixed Greek name when no H1 exists", () => {
    expect(htmlDocument("Σκέτο κείμενο.")).toContain("<title>Αναφορά</title>");
  });

  test("title content is escaped", () => {
    const evil = htmlDocument("# Έργο </title><script>alert(1)</script>");
    expect(evil).not.toContain("<script>");
    expect(evil).toContain("&lt;/title&gt;&lt;script&gt;");
  });

  test("byte determinism: same Markdown in ⇒ same HTML string out", () => {
    const md = "# Τ\n\n- α\n- β\n\n**Σύσταση:** γ";
    expect(htmlDocument(md)).toBe(htmlDocument(md));
  });
});

// ─── Content identity over a REAL report (Article VI carries through) ────────

const BUILDER = "Κατασκευαστική Άλφα ΑΕ";
const PROJECT = "Αυλή Κυψέλης";

function fixture(): SeedFile {
  return {
    projects: [
      {
        builder_name: BUILDER,
        project_name: PROJECT,
        area: "Κυψέλη",
        micro_area: "Κυψέλη · Πλατεία Κύπρου & block Β",
        total_units: 1,
        listed_at: "2026-03-01T00:00:00.000Z",
        units: [{ unit_code: "Β1", asking_initial: 200000, sqm: 75 }],
      },
      {
        builder_name: "Δομική Βήτα ΕΕ",
        project_name: "Ήσυχο Έργο",
        area: "Γκύζη",
        micro_area: "Γκύζη · Πλατεία Γκύζη, block Ε",
        total_units: 1,
        listed_at: "2026-06-01T00:00:00.000Z",
        units: [{ unit_code: "Ε1", asking_initial: 210000, sqm: 70 }],
      },
    ],
    buyers: [
      { pseudonym: "#1", source_channel: "spitogatos", created_at: "2026-02-20T09:00:00.000Z" },
    ],
    opportunities: [
      {
        project: PROJECT,
        buyer: "#1",
        focus_unit: "Β1",
        stage: "Επίσκεψη",
        temperature: "warm",
        next_action: "Δεύτερη επίσκεψη με τον αγοραστή",
        next_owner: "Χρήστος",
        updated_at: "2026-03-15T12:00:00.000Z",
        events: [
          {
            type: "viewing",
            date: "2026-03-15",
            unit: "Β1",
            interest: 3,
            handled_by: "Χρήστος",
            next_action: "Δεύτερη επίσκεψη με τον αγοραστή",
          },
        ],
      },
    ],
  };
}

describe("content identity — real reports through the renderer", () => {
  test("biweekly HTML carries the Markdown run's key figures and escapes the & in micro_area", () => {
    const db = initDb(":memory:");
    try {
      seed(db, fixture());
      const md = biweeklyReport(db, { projectId: 1, asOf: "2026-03-28" });
      const html = htmlDocument(md);
      expect(md).toContain("15.03.2026 – 28.03.2026");
      expect(html).toContain("15.03.2026 – 28.03.2026");
      expect(html).toContain("Μονάδα Β1");
      expect(html).toContain("200.000 €");
      expect(html).toContain("Κυψέλη · Πλατεία Κύπρου &amp; block Β");
    } finally {
      db.close();
    }
  });

  test("Article VI: zero-figure fixture keeps its Σύσταση line in the HTML output", () => {
    const db = initDb(":memory:");
    try {
      seed(db, fixture());
      // Project 2 has zero events ever — every zero metric must still travel
      // with its adjacent recommendation after the HTML conversion.
      const html = htmlDocument(biweeklyReport(db, { projectId: 2, asOf: "2026-06-14" }));
      expect(html).toContain("<strong>Σύσταση:</strong>");
      expect(html).toContain("Δεν καταγράφηκε δραστηριότητα στην περίοδο αναφοράς.");
    } finally {
      db.close();
    }
  });
});

// ─── CLI: --html composes with every mode, excludes --brief ──────────────────

describe("CLI --html — process-level", () => {
  const CLI_PATH = join(import.meta.dir, "..", "src", "report", "cli.ts");
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "constructor-html-"));
    const fileDb = initDb(join(workDir, "constructor.db"));
    seed(fileDb, fixture());
    fileDb.close();
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    return Bun.spawnSync({
      cmd: [process.execPath, CLI_PATH, ...args],
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  const GOOD_ARGS = [
    `--builder=${BUILDER}`,
    `--project=${PROJECT}`,
    "--period=biweekly",
    "--as-of=2026-03-16",
  ];

  test("--html → exit 0, stdout is a full HTML document with lang=el", () => {
    const result = run([...GOOD_ARGS, "--html"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toStartWith('<!doctype html>\n<html lang="el">');
    expect(result.stderr.toString()).toBe("");
  });

  test("--html output carries the same key figures as the Markdown run", () => {
    const md = run(GOOD_ARGS).stdout.toString();
    const html = run([...GOOD_ARGS, "--html"]).stdout.toString();
    expect(md).toContain("15.03.2026 – 28.03.2026 (14 ημέρες)");
    expect(html).toContain("15.03.2026 – 28.03.2026 (14 ημέρες)");
    expect(html).toContain("Μονάδα Β1");
    expect(html).toContain("200.000 €");
    expect(html).toContain("Σύσταση");
  });

  test("Article III: --html byte-identical across two runs", () => {
    const first = run([...GOOD_ARGS, "--html"]);
    const second = run([...GOOD_ARGS, "--html"]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(Buffer.compare(Buffer.from(first.stdout), Buffer.from(second.stdout))).toBe(0);
  });

  test("--html composes with monthly and quarterly", () => {
    for (const period of ["monthly", "quarterly"] as const) {
      const result = run([
        `--builder=${BUILDER}`,
        `--project=${PROJECT}`,
        `--period=${period}`,
        "--as-of=2026-03-16",
        "--html",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toStartWith("<!doctype html>");
    }
  });

  test("--html composes with --rolling, --as-of and --anchor", () => {
    const result = run([
      ...GOOD_ARGS.slice(0, 3),
      "--anchor=2026-03-01",
      "--as-of=2026-03-16",
      "--rolling",
      "--html",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toStartWith("<!doctype html>");
  });

  test("--separation --html → the separation table as an HTML document", () => {
    const result = run(["--separation", "--html"]);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toStartWith('<!doctype html>\n<html lang="el">');
    expect(out).toContain("<th>Χειριστής</th>");
    expect(out).toContain("<td>Χρήστος</td>");
  });

  test("Article VI: zero-figure project --html still carries a Σύσταση line", () => {
    const result = run([
      "--builder=Δομική Βήτα ΕΕ",
      "--project=Ήσυχο Έργο",
      "--period=biweekly",
      "--as-of=2026-06-14",
      "--html",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Σύσταση");
  });

  test("--html --brief → Greek error on stderr, empty stdout, exit 1 (mutually exclusive)", () => {
    const result = run([...GOOD_ARGS, "--html", "--brief"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    const err = result.stderr.toString();
    expect(err).toContain("--html");
    expect(err).toContain("--brief");
    expect(err).toMatch(/δεν συνδυάζ/);
  });

  test("--help mentions --html", () => {
    const result = run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("--html");
  });
});
