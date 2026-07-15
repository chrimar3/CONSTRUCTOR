// DESIGN-LOOP Round 0 — capture harness (puppeteer-core + system Chrome, no
// Chromium download; the ADR-logged devDependency). Reuses the PRODUCTION code
// paths (makeServer / initDb / seed / renderReport) against an ISOLATED fixture
// DB so it never touches the operator's constructor.db.
//
// It drives the SPA through its 8 canonical states at 390×844@2x, writes one
// screenshot per state, and collects a computed-style audit (colors+area, font
// sizes, interactive-target sizes, text/background pairs) that gates.ts scores.
//
// Single theme: the app currently ships ONE (light) theme — no dark theme
// exists yet, so the baseline is 8 frames, not 16. The second theme is future
// elevation work (recorded in the Round-0 report).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { initDb } from "../../src/db/init";
import { seed, type SeedFile } from "../../src/db/seed";
import { makeServer } from "../../src/api/server";
import { renderReport } from "../../src/report/cli";
import { htmlDocument } from "../../src/report/html";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.DESIGN_OUT ?? "artifacts/design/round-0";
const FIXTURE_DB = join(OUT, "baseline.db");
const SEED_FILE = process.env.DESIGN_SEED ?? "seed.example.json";
const PIN = "482915"; // throwaway — activates the PIN gate so it can be captured
const BUILDER = "Παπαδόπουλος";
const PROJECT = "Κυψέλη-Α";
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

interface Audit {
  frame: string;
  // color usage: normalized css color string → painted area (px², bg only)
  paintedByColor: Record<string, number>;
  // every distinct color the frame USES (bg, text, border) — for off-palette count
  usedColors: string[];
  fontSizes: number[];
  // interactive elements smaller than 44 in either axis
  smallTargets: { tag: string; w: number; h: number; label: string }[];
  // text runs paired with their effective (first opaque ancestor) background
  textPairs: { color: string; bg: string; size: number }[];
  // total interactive elements (for touch-target share)
  interactiveCount: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-page audit: read computed styles the mechanical gates need. */
const AUDIT_FN = `(() => {
  const els = Array.from(document.querySelectorAll('*'));
  const paintedByColor = {};
  const used = new Set();
  const sizes = new Set();
  const small = [];
  const pairs = [];
  let interactiveCount = 0;
  const isInteractive = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'button' || t === 'a' || t === 'input' || t === 'select' || t === 'textarea') return true;
    const r = el.getAttribute('role');
    return r === 'button' || r === 'link' || typeof el.onclick === 'function';
  };
  const opaque = (c) => c && c !== 'transparent' && !/rgba\\([^)]*,\\s*0\\s*\\)/.test(c);
  const effectiveBg = (el) => {
    let n = el;
    while (n && n instanceof Element) {
      const bg = getComputedStyle(n).backgroundColor;
      if (opaque(bg)) return bg;
      n = n.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  for (const el of els) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const bg = cs.backgroundColor;
    if (opaque(bg) && area > 0) {
      paintedByColor[bg] = (paintedByColor[bg] || 0) + area;
      used.add(bg);
    }
    if (opaque(cs.color)) used.add(cs.color);
    if (opaque(cs.borderTopColor) && parseFloat(cs.borderTopWidth) > 0) used.add(cs.borderTopColor);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    // Only RENDERED text counts — skip <head> metadata (title/style/script) which
    // carry text nodes but never paint, and anything with no layout box.
    const rendered = !/^(HEAD|TITLE|STYLE|SCRIPT|META|LINK|NOSCRIPT|BASE)$/.test(el.tagName) && el.getClientRects().length > 0;
    if (hasText && rendered) {
      const size = Math.round(parseFloat(cs.fontSize));
      if (size > 0) sizes.add(size);
      const disabled = el.matches && (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true');
      if (!disabled) pairs.push({ color: cs.color, bg: effectiveBg(el), size });
    }
    if (isInteractive(el) && rect.width > 0 && rect.height > 0) {
      interactiveCount++;
      if (rect.width < 44 || rect.height < 44) {
        small.push({ tag: el.tagName.toLowerCase(), w: Math.round(rect.width), h: Math.round(rect.height), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) });
      }
    }
  }
  return { paintedByColor, usedColors: Array.from(used), fontSizes: Array.from(sizes).sort((a,b)=>a-b), smallTargets: small, textPairs: pairs, interactiveCount };
})()`;

async function auditPage(page: Page, frame: string): Promise<Audit> {
  const a = (await page.evaluate(AUDIT_FN)) as Omit<Audit, "frame">;
  return { frame, ...a };
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.jpeg`), type: "jpeg", quality: 92 });
}

async function clickByText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((t) => {
    const el = Array.from(document.querySelectorAll("button, a, [role=button]")).find(
      (e) => (e.textContent || "").trim().includes(t),
    ) as HTMLElement | undefined;
    if (el) { el.click(); return true; }
    return false;
  }, text);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // ── isolated fixture DB (never constructor.db) ──
  const db = initDb(FIXTURE_DB);
  const data = JSON.parse(readFileSync(SEED_FILE, "utf8")) as SeedFile;
  seed(db, data);
  const server = makeServer(db, 0, { pin: PIN });
  const base = `http://127.0.0.1:${server.port}`;
  const audits: Audit[] = [];
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"],
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // 1) PIN gate — /projects 401s on load → PinGate renders.
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.waitForSelector('input[aria-label="PIN ομάδας"]', { timeout: 8000 });
    await sleep(250);
    await shoot(page, "frame-1-pin");
    audits.push(await auditPage(page, "pin"));

    // enter PIN → OperatorGate
    await page.type('input[aria-label="PIN ομάδας"]', PIN, { delay: 20 });
    await clickByText(page, "Είσοδος");
    await page.waitForFunction(
      () => document.body.textContent?.includes("Ποιος είσαι"),
      { timeout: 8000 },
    );
    await sleep(250);
    await shoot(page, "frame-2-operator");
    audits.push(await auditPage(page, "operator"));

    // 3) Board — pick operator Χρήστος
    await clickByText(page, "Χρήστος");
    await page.waitForFunction(
      () => document.body.textContent?.includes("ΠΩΛΗΣΕΙΣ"),
      { timeout: 8000 },
    );
    await sleep(400);
    await shoot(page, "frame-3-board");
    audits.push(await auditPage(page, "board"));

    // 4-6) The three capture sheets (open → shoot → back)
    for (const [n, open, name] of [
      [4, "Νέος", "frame-4-sheet-lead"],
      [5, "Επίσκεψη", "frame-5-sheet-viewing"],
      [6, "Προσφορά", "frame-6-sheet-offer"],
    ] as const) {
      await clickByText(page, open);
      await sleep(500);
      await shoot(page, name);
      audits.push(await auditPage(page, name.replace("frame-" + n + "-", "")));
      // close via the back button (aria-label Πίσω)
      await page.evaluate(() => {
        const b = document.querySelector('[aria-label="Πίσω"]') as HTMLElement | null;
        b?.click();
      });
      await sleep(300);
    }

    // 7-8) The two builder reports — rendered from the fixture DB, loaded as HTML.
    for (const [period, name] of [
      ["biweekly", "frame-7-report-biweekly"],
      ["monthly", "frame-8-report-monthly"],
    ] as const) {
      const md = renderReport(db, { builder: BUILDER, project: PROJECT, period });
      const html = htmlDocument(md);
      writeFileSync(join(OUT, `${name}.html`), html);
      const rpage = await browser.newPage();
      await rpage.setViewport(VIEWPORT);
      await rpage.setContent(html, { waitUntil: "load" });
      await sleep(300);
      await rpage.screenshot({ path: join(OUT, `${name}.jpeg`), type: "jpeg", quality: 92, fullPage: true });
      audits.push(await auditPage(rpage, name.replace(/frame-\d+-/, "")));
      await rpage.close();
    }

    writeFileSync(join(OUT, "audit.json"), JSON.stringify(audits, null, 2));
    console.log(`captured ${audits.length} frames → ${OUT}`);
  } finally {
    await browser?.close();
    server.stop(true);
    db.close();
  }
}

main().catch((e) => {
  console.error("capture failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
