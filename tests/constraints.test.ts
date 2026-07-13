import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import {
  createLead,
  logViewing,
  logOffer,
  advanceOpportunity,
  listPipeline,
  activityCounters,
} from "../src/db/queries";

const TEST_DB = "/tmp/constructor-constraints-test.db";

let db: Database;

/** Fresh DB per test with two projects and two units on project 1. */
beforeEach(() => {
  if (db) db.close();
  rmSync(TEST_DB, { force: true });
  db = initDb(TEST_DB);
  db.run(
    `INSERT INTO projects (id, builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES (1, 'Δομήσεις ΑΕ', 'Κυψέλη Ένα', 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 10, '2026-01-01'),
            (2, 'Δομήσεις ΑΕ', 'Παγκράτι Δύο', 'Παγκράτι', 'Πλατεία Προσκόπων', 6, '2026-02-01')`
  );
  db.run(
    `INSERT INTO units (id, project_id, unit_code, asking_initial, asking_current)
     VALUES (11, 1, 'A1', 250000, 250000),
            (12, 1, 'B2', 300000, 300000),
            (21, 2, 'Γ1', 200000, 200000)`
  );
});

afterAll(() => {
  db?.close();
  rmSync(TEST_DB, { force: true });
});

const LEAD = {
  projectId: 1,
  buyer: { sourceChannel: "referral", segment: "first_home", budgetBand: "250-400k" },
  handledBy: "Χρήστος",
  nextAction: "Τηλέφωνο για ραντεβού",
} as const;

function count(table: string): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
}

describe("Article II — next_action enforced at the query layer (throw before any write)", () => {
  const empties = ["", "   ", "\n\t"];

  test("createLead rejects empty/whitespace next_action and writes nothing", () => {
    for (const bad of empties) {
      expect(() => createLead(db, { ...LEAD, nextAction: bad })).toThrow(/next_action/);
    }
    expect(count("buyers")).toBe(0);
    expect(count("opportunities")).toBe(0);
    expect(count("sales_events")).toBe(0);
  });

  test("logViewing rejects empty next_action and writes nothing", () => {
    const { buyerId } = createLead(db, LEAD);
    const before = count("sales_events");
    expect(() =>
      logViewing(db, {
        projectId: 1,
        buyerId,
        unitId: 11,
        interest: 4,
        handledBy: "Λωίδα",
        nextAction: "  ",
      })
    ).toThrow(/next_action/);
    expect(count("sales_events")).toBe(before);
  });

  test("logOffer rejects empty next_action and writes nothing", () => {
    const { buyerId } = createLead(db, LEAD);
    const before = count("sales_events");
    expect(() =>
      logOffer(db, {
        projectId: 1,
        buyerId,
        unitId: 11,
        amount: 240000,
        handledBy: "Γιολάντα",
        nextAction: "",
      })
    ).toThrow(/next_action/);
    expect(count("sales_events")).toBe(before);
  });

  test("advanceOpportunity rejects empty next_action", () => {
    const { opportunityId } = createLead(db, LEAD);
    expect(() => advanceOpportunity(db, opportunityId, "Επίσκεψη", " ")).toThrow(/next_action/);
  });
});

describe("Article II — next_action enforced at the DB layer (SQL CHECK is the last line)", () => {
  // T008: raw db.run bypasses queries.ts entirely — the CHECK must hold on its own.
  const blanks = ["", " ", "   ", "\t", "\n\t", "\r\n", " \n "];

  test("raw opportunity insert with blank/whitespace next_action fails the CHECK and writes nothing", () => {
    const { buyerId } = createLead(db, LEAD);
    const before = count("opportunities");
    for (const blank of blanks) {
      expect(() =>
        db
          .query(
            `INSERT INTO opportunities (project_id, buyer_id, stage, temperature, next_action, next_owner, updated_at)
             VALUES (?, ?, 'Lead', 'warm', ?, 'Χρήστος', '2026-07-13T00:00:00.000Z')`
          )
          .run(2, buyerId, blank)
      ).toThrow(/CHECK constraint failed.*next_action/);
    }
    expect(count("opportunities")).toBe(before);
  });

  test("raw sales_event insert with blank/whitespace next_action fails the CHECK and writes nothing", () => {
    const { opportunityId } = createLead(db, LEAD);
    const before = count("sales_events");
    for (const blank of blanks) {
      expect(() =>
        db
          .query(
            `INSERT INTO sales_events (opportunity_id, event_type, event_date, handled_by, next_action)
             VALUES (?, 'viewing', '2026-07-13', 'Λωίδα', ?)`
          )
          .run(opportunityId, blank)
      ).toThrow(/CHECK constraint failed.*next_action/);
    }
    expect(count("sales_events")).toBe(before);
  });

  test("raw NULL next_action is equally rejected (NOT NULL is part of the same guarantee)", () => {
    const { opportunityId, buyerId } = createLead(db, LEAD);
    expect(() =>
      db
        .query(
          `INSERT INTO opportunities (project_id, buyer_id, stage, temperature, next_action, next_owner, updated_at)
           VALUES (?, ?, 'Lead', 'warm', NULL, 'Χρήστος', '2026-07-13T00:00:00.000Z')`
        )
        .run(2, buyerId)
    ).toThrow(/NOT NULL constraint failed/);
    expect(() =>
      db
        .query(
          `INSERT INTO sales_events (opportunity_id, event_type, event_date, handled_by, next_action)
           VALUES (?, 'viewing', '2026-07-13', 'Λωίδα', NULL)`
        )
        .run(opportunityId)
    ).toThrow(/NOT NULL constraint failed/);
  });
});

describe("Article IV — buyers here are analytical only", () => {
  test("createLead refuses PII fields (name/phone/email) in the buyer payload", () => {
    for (const pii of [{ name: "Γιάννης" }, { phone: "6900000000" }, { email: "x@y.gr" }]) {
      expect(() =>
        // deliberately smuggling PII past the type system
        createLead(db, { ...LEAD, buyer: { ...LEAD.buyer, ...pii } as never })
      ).toThrow(/PII|Article IV/);
    }
    expect(count("buyers")).toBe(0);
  });

  test("createLead generates a pseudonym and never touches buyer_identity", () => {
    const { pseudonym } = createLead(db, LEAD);
    expect(pseudonym).toMatch(/^#\d+$/);
    expect(count("buyer_identity")).toBe(0);
  });
});

describe("Article IV — analytical queries are fully independent of buyer_identity (T008)", () => {
  /**
   * Source audit: extract every string literal from src/db/queries.ts that
   * carries SQL (SELECT/INSERT/UPDATE/DELETE) and assert none references
   * buyer_identity. Comments/error messages may name the table (they document
   * the separation); the SQL itself must never touch it.
   */
  test("the SQL text in src/db/queries.ts never references buyer_identity", () => {
    const source = readFileSync(join(import.meta.dir, "../src/db/queries.ts"), "utf-8");
    const noComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const literals = noComments.match(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g) ?? [];
    const sqlStrings = literals.filter((s) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s));

    expect(sqlStrings.length).toBeGreaterThan(10); // audit must not be vacuous
    for (const sql of sqlStrings) {
      expect(sql).not.toMatch(/buyer_identity/i);
    }
  });

  /** Seed 4 analytical buyers (via createLead) — buyer_identity stays at 0 rows. */
  function seedBuyerPool(): void {
    const variants = [
      { segment: "first_home", budgetBand: "250-400k", areaPref: "Κυψέλη" },
      { segment: "first_home", budgetBand: "250-400k", areaPref: "Κυψέλη" },
      { segment: "investor", budgetBand: "<150k", areaPref: "Παγκράτι" },
      { segment: "investor", budgetBand: "150-250k", areaPref: "Παγκράτι" },
    ];
    for (const v of variants) {
      createLead(db, { ...LEAD, buyer: { sourceChannel: "spitogatos", ...v } });
    }
    expect(count("buyer_identity")).toBe(0); // precondition: PII table is empty
  }

  test("v_buyer_pool returns correct segment/budget_band counts with zero rows in buyer_identity", () => {
    seedBuyerPool();
    const pool = db
      .query<{ segment: string; area_pref: string; budget_band: string; ready_buyers: number }, []>(
        "SELECT segment, area_pref, budget_band, ready_buyers FROM v_buyer_pool ORDER BY segment, budget_band"
      )
      .all();
    // Lexicographic ORDER BY: '150-250k' ('1' = 0x31) sorts before '<150k' ('<' = 0x3C).
    expect(pool).toEqual([
      { segment: "first_home", area_pref: "Κυψέλη", budget_band: "250-400k", ready_buyers: 2 },
      { segment: "investor", area_pref: "Παγκράτι", budget_band: "150-250k", ready_buyers: 1 },
      { segment: "investor", area_pref: "Παγκράτι", budget_band: "<150k", ready_buyers: 1 },
    ]);
  });

  test("listPipeline and activityCounters return correctly with buyer_identity empty", () => {
    seedBuyerPool();
    const cards = listPipeline(db, 1);
    expect(cards).toHaveLength(4);
    expect(cards.every((c) => /^#\d+$/.test(c.pseudonym))).toBe(true); // pseudonyms, never names
    expect(activityCounters(db, 1)).toEqual({ live: 4, viewings: 0, offers: 0 });
  });

  test("analytical surface survives buyer_identity being DROPPED (hard independence proof)", () => {
    seedBuyerPool();
    const { buyerId } = createLead(db, {
      ...LEAD,
      buyer: { sourceChannel: "xe", segment: "upgrader", budgetBand: "400k+" },
    });
    logViewing(db, {
      projectId: 1, buyerId, unitId: 11, interest: 4,
      handledBy: "Λωίδα", nextAction: "Πρόταση τιμής",
    });

    db.run("DROP TABLE buyer_identity"); // if any query touched it, everything below would throw

    const pool = db
      .query<{ ready_buyers: number }, []>("SELECT ready_buyers FROM v_buyer_pool")
      .all();
    expect(pool.reduce((sum, r) => sum + r.ready_buyers, 0)).toBe(5);
    expect(listPipeline(db, 1)).toHaveLength(5);
    expect(activityCounters(db, 1)).toEqual({ live: 5, viewings: 1, offers: 0 });
  });
});

describe("createLead", () => {
  test("creates buyer + opportunity at stage Lead + an inquiry event with handled_by/next_action", () => {
    const { buyerId, opportunityId } = createLead(db, { ...LEAD, focusUnitId: 11 });

    const opp = db
      .query<{ stage: string; focus_unit_id: number; next_action: string; next_owner: string }, [number]>(
        "SELECT stage, focus_unit_id, next_action, next_owner FROM opportunities WHERE id = ?"
      )
      .get(opportunityId)!;
    expect(opp.stage).toBe("Lead");
    expect(opp.focus_unit_id).toBe(11);
    expect(opp.next_action).toBe(LEAD.nextAction);
    expect(opp.next_owner).toBe("Χρήστος"); // defaults to handledBy

    const ev = db
      .query<{ event_type: string; handled_by: string; next_action: string }, [number]>(
        "SELECT event_type, handled_by, next_action FROM sales_events WHERE opportunity_id = ?"
      )
      .get(opportunityId)!;
    expect(ev.event_type).toBe("inquiry");
    expect(ev.handled_by).toBe("Χρήστος");
    expect(ev.next_action).toBe(LEAD.nextAction);

    expect(buyerId).toBeGreaterThan(0);
  });
});

describe("Grain — one opportunity per buyer↔project; events create it on the spot", () => {
  test("logViewing with no prior lead on that project creates the opportunity (spec edge case)", () => {
    const { buyerId } = createLead(db, LEAD); // lead on project 1
    const res = logViewing(db, {
      projectId: 2, // no opportunity here yet
      buyerId,
      unitId: 21,
      interest: 3,
      handledBy: "Λωίδα",
      nextAction: "Δεύτερη επίσκεψη",
    });
    expect(res.created).toBe(true);

    const opp = db
      .query<{ stage: string; temperature: string; focus_unit_id: number }, [number]>(
        "SELECT stage, temperature, focus_unit_id FROM opportunities WHERE id = ?"
      )
      .get(res.opportunityId)!;
    expect(opp.stage).toBe("Επίσκεψη");
    expect(opp.temperature).toBe("warm"); // interest 3
    expect(opp.focus_unit_id).toBe(21);
  });

  test("logOffer with no prior lead creates the opportunity at Προσφορά, hot", () => {
    const { buyerId } = createLead(db, LEAD);
    const res = logOffer(db, {
      projectId: 2,
      buyerId,
      unitId: 21,
      amount: 190000,
      handledBy: "Γιολάντα",
      nextAction: "Αντιπρόταση στον αγοραστή",
    });
    expect(res.created).toBe(true);

    const opp = db
      .query<{ stage: string; temperature: string }, [number]>(
        "SELECT stage, temperature FROM opportunities WHERE id = ?"
      )
      .get(res.opportunityId)!;
    expect(opp.stage).toBe("Προσφορά");
    expect(opp.temperature).toBe("hot");
  });

  test("repeated events for the same buyer↔project reuse ONE opportunity row", () => {
    const { buyerId, opportunityId } = createLead(db, LEAD);
    const v = logViewing(db, {
      projectId: 1, buyerId, unitId: 11, interest: 4,
      handledBy: "Χρήστος", nextAction: "Στείλε κάτοψη",
    });
    const o = logOffer(db, {
      projectId: 1, buyerId, unitId: 11, amount: 240000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση",
    });
    expect(v.opportunityId).toBe(opportunityId);
    expect(o.opportunityId).toBe(opportunityId);
    expect(count("opportunities")).toBe(1);
  });

  test("the event's unit lands on sales_events.unit_id AND opportunities.focus_unit_id", () => {
    const { buyerId, opportunityId } = createLead(db, { ...LEAD, focusUnitId: 11 });
    const res = logViewing(db, {
      projectId: 1, buyerId, unitId: 12, interest: 5,
      handledBy: "Λωίδα", nextAction: "Πρόταση τιμής",
    });
    const ev = db
      .query<{ unit_id: number }, [number]>("SELECT unit_id FROM sales_events WHERE id = ?")
      .get(res.eventId)!;
    expect(ev.unit_id).toBe(12);
    const opp = db
      .query<{ focus_unit_id: number }, [number]>(
        "SELECT focus_unit_id FROM opportunities WHERE id = ?"
      )
      .get(opportunityId)!;
    expect(opp.focus_unit_id).toBe(12);
  });
});

describe("Stage machine — forward only, temperature per latest signal", () => {
  test("viewing advances Lead → Επίσκεψη and derives temperature from interest", () => {
    const { buyerId, opportunityId } = createLead(db, LEAD);
    logViewing(db, {
      projectId: 1, buyerId, unitId: 11, interest: 2,
      handledBy: "Χρήστος", nextAction: "Επανεκτίμηση ενδιαφέροντος",
    });
    const opp = db
      .query<{ stage: string; temperature: string }, [number]>(
        "SELECT stage, temperature FROM opportunities WHERE id = ?"
      )
      .get(opportunityId)!;
    expect(opp.stage).toBe("Επίσκεψη");
    expect(opp.temperature).toBe("cold");
  });

  test("a viewing AFTER an offer never regresses the stage (temperature still updates)", () => {
    const { buyerId, opportunityId } = createLead(db, LEAD);
    logOffer(db, {
      projectId: 1, buyerId, unitId: 11, amount: 230000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση",
    });
    logViewing(db, {
      projectId: 1, buyerId, unitId: 12, interest: 3,
      handledBy: "Λωίδα", nextAction: "Δεύτερη επίσκεψη στο B2",
    });
    const opp = db
      .query<{ stage: string; temperature: string }, [number]>(
        "SELECT stage, temperature FROM opportunities WHERE id = ?"
      )
      .get(opportunityId)!;
    expect(opp.stage).toBe("Προσφορά"); // no regression
    expect(opp.temperature).toBe("warm"); // latest signal wins
  });

  test("logViewing validates interest through temperature()", () => {
    const { buyerId } = createLead(db, LEAD);
    expect(() =>
      logViewing(db, {
        projectId: 1, buyerId, unitId: 11, interest: 7,
        handledBy: "Χρήστος", nextAction: "x",
      })
    ).toThrow(RangeError);
  });

  test("advanceOpportunity moves forward, stamps ISO-8601 updated_at, and never regresses", () => {
    const { opportunityId } = createLead(db, LEAD);
    const fwd = advanceOpportunity(db, opportunityId, "Κράτηση", "Υπογραφή κράτησης", "Λωίδα");
    expect(fwd.stage).toBe("Κράτηση");
    expect(fwd.advanced).toBe(true);

    const row = db
      .query<{ stage: string; updated_at: string; next_owner: string }, [number]>(
        "SELECT stage, updated_at, next_owner FROM opportunities WHERE id = ?"
      )
      .get(opportunityId)!;
    expect(row.stage).toBe("Κράτηση");
    expect(row.next_owner).toBe("Λωίδα");
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const back = advanceOpportunity(db, opportunityId, "Lead", "Παραμένει σε κράτηση");
    expect(back.stage).toBe("Κράτηση"); // forward only
    expect(back.advanced).toBe(false);
  });

  test("advanceOpportunity throws on unknown opportunity or unknown stage", () => {
    expect(() => advanceOpportunity(db, 999, "Επίσκεψη", "x")).toThrow(/opportunity/i);
    const { opportunityId } = createLead(db, LEAD);
    expect(() =>
      advanceOpportunity(db, opportunityId, "Sold" as never, "x")
    ).toThrow(/stage/i);
  });
});

describe("listPipeline — cards + deterministic needs-attention-first ordering", () => {
  test("card carries pseudonym, unit code, stage, temperature, offer amount, next_action, next_owner", () => {
    const { buyerId } = createLead(db, { ...LEAD, focusUnitId: 11 });
    logOffer(db, {
      projectId: 1, buyerId, unitId: 11, amount: 240000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση €246.000", nextOwner: "Λωίδα",
    });
    const [card] = listPipeline(db, 1);
    expect(card.pseudonym).toBe("#1");
    expect(card.unitCode).toBe("A1");
    expect(card.stage).toBe("Προσφορά");
    expect(card.temperature).toBe("hot");
    expect(card.offerAmount).toBe(240000);
    expect(card.nextAction).toBe("Αντιπρόταση €246.000");
    expect(card.nextOwner).toBe("Λωίδα");
  });

  test("offerAmount is the LATEST offer; null when no offer yet", () => {
    const a = createLead(db, LEAD);
    logOffer(db, {
      projectId: 1, buyerId: a.buyerId, unitId: 11, amount: 230000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση", eventDate: "2026-07-01",
    });
    logOffer(db, {
      projectId: 1, buyerId: a.buyerId, unitId: 11, amount: 242000,
      handledBy: "Χρήστος", nextAction: "Κλείσιμο", eventDate: "2026-07-10",
    });
    const b = createLead(db, {
      ...LEAD,
      buyer: { sourceChannel: "spitogatos" },
    });
    const cards = listPipeline(db, 1);
    expect(cards.find((c) => c.opportunityId === a.opportunityId)?.offerAmount).toBe(242000);
    expect(cards.find((c) => c.opportunityId === b.opportunityId)?.offerAmount).toBeNull();
  });

  test("orders hot before warm before cold; stalest first within a band; id as final tiebreak", () => {
    // cold: lead + interest-2 viewing
    const cold = createLead(db, LEAD);
    logViewing(db, {
      projectId: 1, buyerId: cold.buyerId, unitId: 11, interest: 2,
      handledBy: "Χρήστος", nextAction: "Follow-up σε 2 εβδομάδες",
    });
    // warm: fresh lead (default) — see ADR-0008
    const warm = createLead(db, { ...LEAD, buyer: { sourceChannel: "xe" } });
    // hot: offer
    const hot = createLead(db, { ...LEAD, buyer: { sourceChannel: "social" } });
    logOffer(db, {
      projectId: 1, buyerId: hot.buyerId, unitId: 12, amount: 290000,
      handledBy: "Γιολάντα", nextAction: "Αντιπρόταση",
    });

    const order = listPipeline(db, 1).map((c) => c.opportunityId);
    expect(order).toEqual([hot.opportunityId, warm.opportunityId, cold.opportunityId]);
  });

  test("within the same temperature band, the stalest updated_at comes first", () => {
    const older = createLead(db, LEAD);
    const newer = createLead(db, { ...LEAD, buyer: { sourceChannel: "walkin" } });
    db.run(
      `UPDATE opportunities SET updated_at = '2026-06-01T00:00:00.000Z' WHERE id = ${older.opportunityId}`
    );
    db.run(
      `UPDATE opportunities SET updated_at = '2026-07-12T00:00:00.000Z' WHERE id = ${newer.opportunityId}`
    );
    const order = listPipeline(db, 1).map((c) => c.opportunityId);
    expect(order).toEqual([older.opportunityId, newer.opportunityId]);
  });

  test("is scoped to the project and excludes closed stages (Συμβόλαιο, Fallthrough)", () => {
    const p1 = createLead(db, LEAD);
    createLead(db, { ...LEAD, projectId: 2, buyer: { sourceChannel: "referral" } });
    const closed = createLead(db, { ...LEAD, buyer: { sourceChannel: "social" } });
    advanceOpportunity(db, closed.opportunityId, "Συμβόλαιο", "Αρχειοθέτηση φακέλου");

    const cards = listPipeline(db, 1);
    expect(cards.map((c) => c.opportunityId)).toEqual([p1.opportunityId]);
  });
});

describe("activityCounters(projectId)", () => {
  test("counts live opportunities, viewings, offers for the project only", () => {
    const a = createLead(db, LEAD);
    const b = createLead(db, { ...LEAD, buyer: { sourceChannel: "xe" } });
    logViewing(db, {
      projectId: 1, buyerId: a.buyerId, unitId: 11, interest: 4,
      handledBy: "Χρήστος", nextAction: "Πρόταση",
    });
    logViewing(db, {
      projectId: 1, buyerId: b.buyerId, unitId: 12, interest: 3,
      handledBy: "Λωίδα", nextAction: "Δεύτερη επίσκεψη",
    });
    logOffer(db, {
      projectId: 1, buyerId: a.buyerId, unitId: 11, amount: 240000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση",
    });
    // noise on project 2
    const c = createLead(db, { ...LEAD, projectId: 2, buyer: { sourceChannel: "social" } });
    logViewing(db, {
      projectId: 2, buyerId: c.buyerId, unitId: 21, interest: 5,
      handledBy: "Γιολάντα", nextAction: "Πρόταση",
    });

    expect(activityCounters(db, 1)).toEqual({ live: 2, viewings: 2, offers: 1 });
    expect(activityCounters(db, 2)).toEqual({ live: 1, viewings: 1, offers: 0 });
  });

  test("empty project → all zeros", () => {
    expect(activityCounters(db, 2)).toEqual({ live: 0, viewings: 0, offers: 0 });
  });
});
