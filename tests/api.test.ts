// T009 — src/api/server.ts: thin Bun.serve HTTP boundary over src/db/queries.ts.
// Tests drive REAL HTTP via fetch against an ephemeral-port server (port 0) with an
// injected :memory: DB. Every test tears down BOTH handles (server.stop(true) +
// db.close()) in afterEach so `bun test` exits promptly — a leaked handle is a bug.
// Coverage: happy path per endpoint, Article II rejection per write (400 + Greek
// JSON), viewing-without-interest (400), and consistent 400/404 semantics.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { initDb } from "../src/db/init";
import { createLead } from "../src/db/queries";
import { makeServer } from "../src/api/server";

const GREEK = /\p{Script=Greek}/u;
const BLANKS = ["", "   ", "\t", "\n\t"];

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

function addProject(): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', 'Αύρα', 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`,
  );
  return lastId();
}

function lastId(): number {
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function count(table: "buyers" | "opportunities" | "sales_events"): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
}

function addBuyer(projectId: number): number {
  return createLead(db, {
    projectId,
    sourceChannel: "spitogatos",
    handledBy: "Χρήστος",
    nextAction: "Τηλεφώνημα για ραντεβού",
  }).buyerId;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectGreekError(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as { error: string };
  expect(typeof body.error).toBe("string");
  expect(body.error).toMatch(GREEK); // FR-11: user-facing errors are Greek
}

const LEAD_BODY = {
  sourceChannel: "spitogatos",
  handledBy: "Χρήστος",
  nextAction: "Τηλεφώνημα για ραντεβού",
};

// ─── POST /leads ─────────────────────────────────────────────────────────────

describe("POST /leads", () => {
  test("happy path: 201 with buyerId/opportunityId/pseudonym, row persisted", async () => {
    const projectId = addProject();
    const res = await post("/leads", { projectId, ...LEAD_BODY, segment: "first_home" });
    expect(res.status).toBe(201);

    const r = (await res.json()) as { buyerId: number; opportunityId: number; pseudonym: string };
    expect(r.pseudonym).toBe(`#${r.buyerId}`);

    const opp = db
      .query("SELECT stage, next_action FROM opportunities WHERE id = ?")
      .get(r.opportunityId) as any;
    expect(opp.stage).toBe("Lead");
    expect(opp.next_action).toBe("Τηλεφώνημα για ραντεβού");
  });

  test("Article II: blank next_action → 400 Greek JSON, nothing written", async () => {
    const projectId = addProject();
    for (const blank of BLANKS) {
      const res = await post("/leads", { projectId, ...LEAD_BODY, nextAction: blank });
      await expectGreekError(res, 400);
    }
    expect(count("buyers")).toBe(0);
    expect(count("opportunities")).toBe(0);
  });

  test("missing required field (projectId) → 400 Greek JSON", async () => {
    const res = await post("/leads", { ...LEAD_BODY });
    await expectGreekError(res, 400);
  });

  test("Article IV: PII-shaped key in payload → 400, no buyer written", async () => {
    const projectId = addProject();
    const res = await post("/leads", { projectId, ...LEAD_BODY, name: "Γιάννης" });
    await expectGreekError(res, 400);
    expect(count("buyers")).toBe(0);
  });

  test("nonexistent projectId → 404 Greek JSON", async () => {
    const res = await post("/leads", { projectId: 999, ...LEAD_BODY });
    await expectGreekError(res, 404);
  });
});

// ─── POST /viewings ──────────────────────────────────────────────────────────

describe("POST /viewings", () => {
  test("happy path: 201, temperature derived from interest", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const res = await post("/viewings", {
      projectId,
      buyerId,
      interest: 5,
      handledBy: "Λωίδα",
      nextAction: "Αποστολή κάτοψης",
    });
    expect(res.status).toBe(201);
    const r = (await res.json()) as { opportunityId: number; temperature: string };
    expect(r.temperature).toBe("hot");
    expect(db.query("SELECT stage FROM opportunities WHERE id = ?").get(r.opportunityId)).toEqual({
      stage: "Επίσκεψη",
    });
  });

  test("viewing without interest → 400 Greek JSON (interest is required)", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const res = await post("/viewings", {
      projectId,
      buyerId,
      handledBy: "Λωίδα",
      nextAction: "Αποστολή κάτοψης",
    });
    await expectGreekError(res, 400);
  });

  test("interest outside 1..5 → 400 Greek JSON, no event written", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const before = count("sales_events");
    for (const interest of [0, 6, 2.5]) {
      const res = await post("/viewings", {
        projectId,
        buyerId,
        interest,
        handledBy: "Λωίδα",
        nextAction: "Αποστολή κάτοψης",
      });
      await expectGreekError(res, 400);
    }
    expect(count("sales_events")).toBe(before);
  });

  test("Article II: blank next_action → 400 Greek JSON", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const res = await post("/viewings", {
      projectId,
      buyerId,
      interest: 4,
      handledBy: "Λωίδα",
      nextAction: "  \t ",
    });
    await expectGreekError(res, 400);
  });

  test("nonexistent buyerId → 404 Greek JSON", async () => {
    const projectId = addProject();
    const res = await post("/viewings", {
      projectId,
      buyerId: 999,
      interest: 4,
      handledBy: "Λωίδα",
      nextAction: "Αποστολή κάτοψης",
    });
    await expectGreekError(res, 404);
  });
});

// ─── POST /offers ────────────────────────────────────────────────────────────

describe("POST /offers", () => {
  test("happy path: 201, temperature forced hot", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const res = await post("/offers", {
      projectId,
      buyerId,
      amount: 240000,
      handledBy: "Γιολάντα",
      nextAction: "Μεταφορά προσφοράς στον εργολάβο",
    });
    expect(res.status).toBe(201);
    const r = (await res.json()) as { opportunityId: number; temperature: string };
    expect(r.temperature).toBe("hot");
    const ev = db
      .query("SELECT amount FROM sales_events WHERE event_type = 'offer'")
      .get() as any;
    expect(ev.amount).toBe(240000);
  });

  test("Article II: blank next_action → 400 Greek JSON", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    const res = await post("/offers", {
      projectId,
      buyerId,
      amount: 240000,
      handledBy: "Γιολάντα",
      nextAction: "",
    });
    await expectGreekError(res, 400);
  });

  test("non-positive / missing amount → 400 Greek JSON", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    for (const body of [
      { projectId, buyerId, amount: -5, handledBy: "Γιολάντα", nextAction: "Ενημέρωση" },
      { projectId, buyerId, handledBy: "Γιολάντα", nextAction: "Ενημέρωση" },
    ]) {
      const res = await post("/offers", body);
      await expectGreekError(res, 400);
    }
  });
});

// ─── GET /pipeline ───────────────────────────────────────────────────────────

describe("GET /pipeline", () => {
  test("happy path: 200 with the project's board cards", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId);
    await post("/viewings", {
      projectId,
      buyerId,
      interest: 4,
      handledBy: "Χρήστος",
      nextAction: "Δεύτερη επίσκεψη",
    });

    const res = await fetch(`${base}/pipeline?project=${projectId}`);
    expect(res.status).toBe(200);
    const cards = (await res.json()) as any[];
    expect(cards).toHaveLength(1);
    expect(cards[0].pseudonym).toBe(`#${buyerId}`);
    expect(cards[0].stage).toBe("Επίσκεψη");
    expect(cards[0].temperature).toBe("hot");
    expect(cards[0].nextAction).toBe("Δεύτερη επίσκεψη");
  });

  test("missing or non-integer project param → 400 Greek JSON", async () => {
    for (const qs of ["", "?project=", "?project=abc"]) {
      const res = await fetch(`${base}/pipeline${qs}`);
      await expectGreekError(res, 400);
    }
  });
});

// ─── GET /counters ───────────────────────────────────────────────────────────

describe("GET /counters", () => {
  test("happy path: 200 with per-project activity counters", async () => {
    const projectId = addProject();
    const buyerId = addBuyer(projectId); // 1 inquiry
    await post("/viewings", {
      projectId,
      buyerId,
      interest: 3,
      handledBy: "Χρήστος",
      nextAction: "Επόμενο ραντεβού",
    });

    const res = await fetch(`${base}/counters?project=${projectId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      inquiries: 1,
      viewings: 1,
      offers: 0,
      liveOpportunities: 1,
    });
  });

  test("missing or non-integer project param → 400 Greek JSON", async () => {
    const res = await fetch(`${base}/counters?project=1.5`);
    await expectGreekError(res, 400);
  });
});

// ─── Consistent 400/404 semantics ────────────────────────────────────────────

describe("boundary semantics", () => {
  test("unknown route → 404 Greek JSON", async () => {
    const res = await fetch(`${base}/nope`);
    await expectGreekError(res, 404);
  });

  test("wrong method on a known path → 404 Greek JSON", async () => {
    const res = await fetch(`${base}/pipeline`, { method: "POST" });
    await expectGreekError(res, 404);
  });

  test("malformed JSON body → 400 Greek JSON", async () => {
    const res = await fetch(`${base}/leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    await expectGreekError(res, 400);
  });

  test("non-object JSON body (array) → 400 Greek JSON", async () => {
    const res = await post("/leads", [1, 2, 3]);
    await expectGreekError(res, 400);
  });
});
