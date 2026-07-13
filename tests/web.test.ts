// T012 — web client (pipeline board + three capture sheets) served by bun run dev.
// Pragmatic test split (interactive tap/flow behavior is CHECKPOINT 1 human
// verification on a phone viewport):
//   1. the server serves the HTML route (200 text/html) and the bundled client JS;
//   2. the TSX bundle builds clean via Bun.build (a broken App.tsx fails the suite);
//   3. the supporting API surface the board/sheets need (projects, units, buyerId
//      on pipeline cards) — test-first at query + HTTP level;
//   4. extracted pure web helpers (amount parsing, live counter preview, Greek
//      formatting) — unit-tested;
//   5. FR-11: the new option-grid enum keys (source/segment/budget) render only
//      via src/domain/labels.ts maps.
// Every server test tears down BOTH handles (server.stop(true) + db.close()).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { initDb } from "../src/db/init";
import { makeServer } from "../src/api/server";
import { createLead, listPipeline, listProjects, listUnits } from "../src/db/queries";
import { budgetBandLabel, segmentLabel, sourceChannelLabel } from "../src/domain/labels";
import {
  canSubmit,
  counterNextAction,
  counterPreview,
  formatPct,
  parseAmount,
} from "../src/web/helpers";

const GREEK = /\p{Script=Greek}/u;
const APP_TSX = fileURLToPath(new URL("../src/web/App.tsx", import.meta.url));

let db: Database;
let server: Server;
let base: string;

beforeEach(() => {
  db = initDb(":memory:");
  server = makeServer(db); // port 0 → ephemeral
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  server.stop(true); // force-close — a leaked handle keeps `bun test` alive
  db.close();
});

// ─── Arrangement helpers (DB-level, not under test) ─────────────────────────

function lastId(): number {
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function addProject(name = "Αύρα"): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', ?, 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`,
    [name],
  );
  return lastId();
}

function addUnit(projectId: number, code: string, asking = 300000, status = "live"): number {
  db.run(
    `INSERT INTO units (project_id, unit_code, asking_initial, asking_current, status)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, code, asking, asking, status],
  );
  return lastId();
}

// ─── 1. Web routes: the app is served by the same dev server ────────────────

describe("T012 web routes", () => {
  test("GET / serves the app shell: 200 text/html with root mount + /app.js + Greek chrome", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toContain("/app.js");
    expect(html).toMatch(GREEK); // FR-11: user-facing chrome is Greek
  });

  test("GET /app.js serves the bundled client: 200 javascript, non-trivial body", async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/javascript/);
    const js = await res.text();
    expect(js.length).toBeGreaterThan(1000); // react + app actually bundled
    expect(js).not.toContain('from "react"'); // no bare specifiers left for the browser
  });

  test("API routes still respond after web routes were added (no route shadowing)", async () => {
    const projectId = addProject();
    const res = await fetch(`${base}/pipeline?project=${projectId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ─── 2. The TSX bundle builds clean (Bun.build in a test) ───────────────────

describe("T012 client bundle", () => {
  test("Bun.build bundles src/web/App.tsx clean for the browser", async () => {
    const result = await Bun.build({
      entrypoints: [APP_TSX],
      target: "browser",
    });
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });
});

// ─── 3. Supporting API surface for board + sheets ────────────────────────────

describe("T012 queries: listProjects / listUnits / buyerId on cards", () => {
  test("listProjects returns id + names + micro_area for every project, id ASC", () => {
    const a = addProject("Αύρα");
    const b = addProject("Ήλιος");
    const rows = listProjects(db);
    expect(rows.map((r) => r.id)).toEqual([a, b]);
    expect(rows[0]).toEqual({
      id: a,
      builderName: "Δομική ΑΕ",
      projectName: "Αύρα",
      area: "Κυψέλη",
      microArea: "Πλατεία Κύπρου, block Α",
    });
  });

  test("listUnits is scoped to the project and deterministically ordered by unit_code", () => {
    const p = addProject();
    const other = addProject("Άλλο");
    addUnit(other, "Z9");
    const b2 = addUnit(p, "B2", 250000);
    const a1 = addUnit(p, "A1", 300000, "reserved");
    const rows = listUnits(db, p);
    expect(rows.map((r) => r.id)).toEqual([a1, b2]);
    expect(rows[0]).toEqual({ id: a1, unitCode: "A1", askingCurrent: 300000, status: "reserved" });
    expect(rows[1]).toEqual({ id: b2, unitCode: "B2", askingCurrent: 250000, status: "live" });
  });

  test("pipeline cards carry buyerId so sheets can capture against a board buyer", () => {
    const p = addProject();
    const r = createLead(db, {
      projectId: p,
      sourceChannel: "spitogatos",
      handledBy: "Χρήστος",
      nextAction: "Τηλεφώνημα για ραντεβού",
    });
    const card = listPipeline(db, p)[0]!;
    expect(card.buyerId).toBe(r.buyerId);
    expect(card.pseudonym).toBe(`#${r.buyerId}`);
  });
});

describe("T012 HTTP: GET /projects and GET /units", () => {
  test("GET /projects → 200 JSON array of projects", async () => {
    const a = addProject();
    const res = await fetch(`${base}/projects`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: number; projectName: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(a);
    expect(rows[0]!.projectName).toBe("Αύρα");
  });

  test("GET /units?project=N → 200 JSON array scoped to the project", async () => {
    const p = addProject();
    addUnit(p, "A1");
    const res = await fetch(`${base}/units?project=${p}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ unitCode: string }>;
    expect(rows.map((r) => r.unitCode)).toEqual(["A1"]);
  });

  test("GET /units without a valid project param → 400 Greek JSON error", async () => {
    const res = await fetch(`${base}/units`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(GREEK);
  });
});

// ─── 3b. T012a — session operator identity ships in the client ──────────────
// Interactive tap/flow behavior stays CHECKPOINT 1 human verification (T012
// convention); this pins that the locked UX element — a "Ποιος είσαι;" selector
// persisted via sessionStorage — is actually part of the served bundle.

describe("T012a client: session operator selector", () => {
  test("the served bundle carries the Ποιος είσαι; selector and sessionStorage persistence", async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain("Ποιος είσαι;");
    expect(js).toContain("sessionStorage");
    // all three operators are selectable in the client
    for (const name of ["Χρήστος", "Λωίδα", "Γιολάντα"]) {
      expect(js).toContain(name);
    }
  });
});

// ─── 4. Pure web helpers ─────────────────────────────────────────────────────

describe("T012 helpers: parseAmount", () => {
  test("parses digit groups with Greek thousand separators", () => {
    expect(parseAmount("250.000")).toBe(250000);
    expect(parseAmount("250000")).toBe(250000);
    expect(parseAmount(" 1.250.500 ")).toBe(1250500);
  });

  test("empty, zero and non-numeric input parse to null (no preview, submit stays disabled)", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("T012 helpers: counterPreview (live pct-below + suggested counter)", () => {
  test("below asking → same numbers as the domain counter (0.6 weight, €500 rounding)", () => {
    const s = counterPreview(300000, "270.000");
    expect(s).toEqual({ pctBelow: 0.1, suggested: 288000 });
  });

  test("at/above asking → null (no counter applies)", () => {
    expect(counterPreview(300000, "300.000")).toBeNull();
    expect(counterPreview(300000, "310.000")).toBeNull();
  });

  test("unknown asking or unparseable amount → null, never a throw", () => {
    expect(counterPreview(null, "270.000")).toBeNull();
    expect(counterPreview(undefined, "270.000")).toBeNull();
    expect(counterPreview(0, "270.000")).toBeNull();
    expect(counterPreview(300000, "")).toBeNull();
  });
});

describe("T012 helpers: Greek formatting", () => {
  test("formatPct renders Greek decimal comma, at most one decimal", () => {
    expect(formatPct(0.1)).toBe("10%");
    expect(formatPct(0.125)).toBe("12,5%");
    expect(formatPct(0.16666)).toBe("16,7%");
  });

  test("counterNextAction is a Greek one-tap next action carrying €-amount and pseudonym", () => {
    const s = counterNextAction(288000, "#5");
    expect(s).toMatch(GREEK);
    expect(s).toContain("288.000 €");
    expect(s).toContain("#5");
  });
});

// ─── 4b. T013 — pure canSubmit predicate (Article II at the UI) ──────────────
// The submit button of every capture sheet is driven by this ONE pure predicate
// (headlessly testable — no DOM). Article II: empty/whitespace next_action can
// never submit; per-sheet required fields (source / buyer+interest / buyer+amount)
// gate alongside it so extracting the predicate never loosens the sheets.

describe("T013 canSubmit: Article II — blank next_action blocks every sheet", () => {
  test("empty next_action → false on all three sheets even with every other field set", () => {
    expect(canSubmit({ kind: "lead", source: "spitogatos", nextAction: "" })).toBe(false);
    expect(canSubmit({ kind: "viewing", buyerId: 1, interest: 4, nextAction: "" })).toBe(false);
    expect(canSubmit({ kind: "offer", buyerId: 1, amount: "250.000", nextAction: "" })).toBe(false);
  });

  test("whitespace-only next_action (spaces, tab, newline, CR) → false on all three sheets", () => {
    for (const blank of ["   ", "\t", "\n", "\r", " \t\n\r "]) {
      expect(canSubmit({ kind: "lead", source: "spitogatos", nextAction: blank })).toBe(false);
      expect(canSubmit({ kind: "viewing", buyerId: 1, interest: 4, nextAction: blank })).toBe(false);
      expect(canSubmit({ kind: "offer", buyerId: 1, amount: "250.000", nextAction: blank })).toBe(false);
    }
  });

  test("non-blank next_action (even padded) with all required fields → true on all three sheets", () => {
    const next = "  Τηλεφώνημα την Τρίτη  "; // trims to non-empty → submittable
    expect(canSubmit({ kind: "lead", source: "spitogatos", nextAction: next })).toBe(true);
    expect(canSubmit({ kind: "viewing", buyerId: 1, interest: 4, nextAction: next })).toBe(true);
    expect(canSubmit({ kind: "offer", buyerId: 1, amount: "250.000", nextAction: next })).toBe(true);
  });
});

describe("T013 canSubmit: per-sheet required fields still gate", () => {
  const next = "Τηλεφώνημα για ραντεβού";

  test("lead: no source → false", () => {
    expect(canSubmit({ kind: "lead", source: null, nextAction: next })).toBe(false);
  });

  test("viewing: no interest → false (brief-pinned), no buyer → false", () => {
    expect(canSubmit({ kind: "viewing", buyerId: 1, interest: null, nextAction: next })).toBe(false);
    expect(canSubmit({ kind: "viewing", buyerId: null, interest: 4, nextAction: next })).toBe(false);
  });

  test("offer: unparseable/zero amount → false, no buyer → false", () => {
    expect(canSubmit({ kind: "offer", buyerId: 1, amount: "", nextAction: next })).toBe(false);
    expect(canSubmit({ kind: "offer", buyerId: 1, amount: "abc", nextAction: next })).toBe(false);
    expect(canSubmit({ kind: "offer", buyerId: 1, amount: "0", nextAction: next })).toBe(false);
    expect(canSubmit({ kind: "offer", buyerId: null, amount: "250.000", nextAction: next })).toBe(false);
  });
});

// ─── 4c. T013 — the served bundle is actually wired to the predicate ─────────

describe("T013 client: sheets drive submit through the shared canSubmit predicate", () => {
  test("the served bundle carries canSubmit (Article II gate ships to the browser)", async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain("canSubmit");
  });
});

// ─── 5. FR-11: option-grid enum keys render via labels.ts only ───────────────

describe("FR-11: source/segment/budget option labels come from labels.ts", () => {
  const SOURCES = ["spitogatos", "xe", "referral", "walkin", "social"];
  const SEGMENTS = ["first_home", "investor", "upgrader", "foreign"];
  const BUDGETS = ["<150k", "150-250k", "250-400k", "400k+"];

  test("every source_channel key has a non-empty label", () => {
    for (const key of SOURCES) {
      expect(sourceChannelLabel(key).trim().length).toBeGreaterThan(0);
    }
  });

  test("every segment key has a non-empty Greek label", () => {
    for (const key of SEGMENTS) {
      const label = segmentLabel(key);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).toMatch(GREEK);
    }
  });

  test("every budget_band key has a non-empty label", () => {
    for (const key of BUDGETS) {
      expect(budgetBandLabel(key).trim().length).toBeGreaterThan(0);
    }
  });

  test("unknown keys throw RangeError (a raw key must never render)", () => {
    expect(() => sourceChannelLabel("facebook")).toThrow(RangeError);
    expect(() => segmentLabel("vip")).toThrow(RangeError);
    expect(() => budgetBandLabel("1M+")).toThrow(RangeError);
  });
});
