// B0b — deterministic Markdown → self-contained HTML renderer for the builder
// deliverable (RULING 2026-07-14b: builders receive a styled HTML file sent by
// email/Viber; plan.md sanctions "Markdown → optional HTML").
//
// Scope: EXACTLY the Markdown subset the report renderers emit (biweekly.ts /
// monthly.ts / separation.ts) — #/##/### headings, **bold** inline, "- " list
// items, | pipe | tables with a | --- | separator row, fully-wrapped _italic_
// lines/items, single-line HTML comments (the INSIGHTS paste markers),
// paragraphs, blank lines. Hand-rolled, zero dependencies (Article VIII).
//
// Security (escape-first policy): every content character is HTML-entity-
// escaped BEFORE any inline markup is applied, so user-entered text that
// reaches a report (next_action, names, micro-areas, unit codes) is XSS-safe
// by construction. The only unescaped pass-through is a WHOLE line that is a
// single well-formed HTML comment (the template's INSIGHTS markers) — guarded
// so a crafted line with an early terminator can never break out.
//
// Article III: pure string function — no wall clock, no randomness, no ICU.
// Same Markdown in ⇒ same HTML bytes out.

// ─── Escaping ────────────────────────────────────────────────────────────────

/** HTML-entity-escapes content (&, <, >, ") — applied before ANY markup. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ─── Inline markup (on already-escaped text) ─────────────────────────────────

/** Escapes, applies **bold**, then paints € figures with the honey money signal. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Honey signal on money (IMPACT-LOOP Round 2): wrap "238.000 €" etc. Runs on
    // already-escaped text, and € never appears inside a tag, so markup is untouched.
    .replace(/(\d[\d.,]*\s*€)/g, '<span class="eur">$1</span>');
}

/**
 * Content of a paragraph or list item: a FULLY-wrapped `_…_` segment renders
 * as <em> (the footer + insight-placeholder form the reports emit); partial
 * underscores stay literal, so unit codes like "A_1" can never false-italicize.
 */
function content(text: string): string {
  const wrapped = /^_([^_]*)_$/.exec(text);
  return wrapped === null ? inline(text) : `<em>${inline(wrapped[1]!)}</em>`;
}

// ─── Line classification ─────────────────────────────────────────────────────

/**
 * True only for a line that is ONE well-formed HTML comment: it must end with
 * the ONLY `-->` in the line and contain no `--!>` (an alternative comment
 * terminator per the HTML spec). Anything else — including a crafted
 * "<!-- x --><script>…" breakout — is treated as content and escaped.
 */
function isCommentLine(line: string): boolean {
  return (
    line.startsWith("<!--") &&
    line.endsWith("-->") &&
    line.indexOf("-->") === line.length - 3 &&
    !line.includes("--!>")
  );
}

/** Table-separator row: every cell is dashes only (e.g. "| --- | --- |"). */
function isTableSeparator(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^-{3,}$/.test(cell));
}

/** "| a | b |" → ["a", "b"] (outer pipes stripped, cells trimmed). */
function splitCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// ─── Block renderer ──────────────────────────────────────────────────────────

/** Renders the report Markdown subset to an HTML body fragment. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim() === "") continue;

    // Headings — the reports emit exactly three levels.
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    // INSIGHTS paste markers stay machine-findable HTML comments.
    if (isCommentLine(line)) {
      out.push(line);
      continue;
    }

    // List: a run of consecutive "- " lines becomes one <ul>.
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        items.push(`<li>${content(lines[i]!.slice(2))}</li>`);
        i++;
      }
      i--;
      out.push(`<ul>\n${items.join("\n")}\n</ul>`);
      continue;
    }

    // Table: a run of consecutive "|" lines; row 2 as "| --- |" marks a header.
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        rows.push(splitCells(lines[i]!));
        i++;
      }
      i--;
      const rawRows = rows.map((cells) => cells);
      let bodyRows = rawRows;
      let thead = "";
      if (rawRows.length >= 2 && isTableSeparator(`| ${rawRows[1]!.join(" | ")} |`)) {
        const header = rawRows[0]!.map((cell) => `<th>${content(cell)}</th>`).join("");
        thead = `<thead><tr>${header}</tr></thead>\n`;
        bodyRows = rawRows.slice(2);
      }
      const tbody = bodyRows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${content(cell)}</td>`).join("")}</tr>`)
        .join("\n");
      out.push(`<table>\n${thead}<tbody>\n${tbody}\n</tbody>\n</table>`);
      continue;
    }

    // Anything else is a paragraph line.
    out.push(`<p>${content(line)}</p>`);
  }

  return out.join("\n");
}

// ─── Document shell ──────────────────────────────────────────────────────────

// Inline, dependency-free CSS: system-ui fonts, phone-readable measure,
// print-friendly page breaks. No external resource of any kind — the document
// travels as an email attachment.
// «Πεύκο & Μέλι» tokens embedded (the report is a standalone emailed document —
// no access to the app's index.html). Serif headings for gravitas (Literata-
// evoking via a system serif; self-hosted Literata is a follow-up), pinned type
// scale in px (13/15/17/20/24), tabular figures so € reads as data.
const STYLE = `:root{--paper:#f7f3ea;--card:#fffdf8;--card-2:#f1ebdd;--ink:#2a2320;--ink-muted:#6f665b;--line-strong:#d7cbb3;--pine:#14555a;--honey-ink:#7a5a1e}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.55;color:var(--ink);background:var(--paper);font-variant-numeric:tabular-nums}
.eur{color:var(--honey-ink);font-weight:700}
main{max-width:44em;margin:0 auto;padding:1.5em 1.25em 3em;background:var(--card)}
h1{font-family:Georgia,"Times New Roman",serif;font-size:24px;line-height:1.3;margin:0 0 .75em;padding-bottom:.4em;border-bottom:3px solid var(--pine);color:var(--ink)}
h2{font-family:Georgia,"Times New Roman",serif;font-size:20px;margin:1.8em 0 .6em;padding-bottom:.25em;border-bottom:1px solid var(--line-strong);color:var(--pine)}
h3{font-size:17px;margin:1.4em 0 .5em;color:var(--ink)}
p{margin:.5em 0}
ul{margin:.5em 0;padding-left:1.4em}
li{margin:.35em 0}
em{color:var(--ink-muted)}
table{border-collapse:collapse;width:100%;margin:.75em 0}
th,td{border:1px solid var(--line-strong);padding:.45em .65em;text-align:left}
th{background:var(--card-2)}
@media print{body{background:#fff}main{max-width:none;padding:0}h2,h3{break-after:avoid}li,tr{break-inside:avoid}}`;

/** The document title: the first H1's text, else a fixed Greek fallback. */
function titleOf(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const h1 = /^# (.*)$/.exec(line);
    if (h1 !== null) return escapeHtml(h1[1]!);
  }
  return "Αναφορά";
}

/**
 * Wraps report Markdown into ONE self-contained Greek HTML document —
 * lang="el", viewport meta, inline CSS, zero external resources.
 */
export function htmlDocument(markdown: string): string {
  return `<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleOf(markdown)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${markdownToHtml(markdown)}
</main>
</body>
</html>
`;
}
