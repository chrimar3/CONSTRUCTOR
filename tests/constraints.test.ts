// T007 — src/db/queries.ts: typed capture/pipeline queries over bun:sqlite.
// T008 — Article II negative paths (raw SQL layer + guard layer) and Article IV
// independence of every analytical query from buyer_identity.
// Tests are named after the requirement they pin (Article II, Article IV, grain,
// forward-only stage, deterministic ordering) so failures read as violations.

import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import {
  activityCounters,
  advanceOpportunity,
  createLead,
  listPipeline,
  logOffer,
  logViewing,
} from "../src/db/queries";

const BLANKS = ["", "   ", "\t", "\n\t", "\r\n", " \t\r\n "];
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let db: Database;

function addProject(name = "Αύρα"): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', ?, 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`,
    [name],
  );
  return lastId();
}

function lastId(): number {
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function count(table: "buyers" | "opportunities" | "sales_events"): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
}

function addUnit(projectId: number, code = "A1"): number {
  db.run(
    `INSERT INTO units (project_id, unit_code, asking_initial, asking_current)
     VALUES (?, ?, 250000, 250000)`,
    [projectId, code],
  );
  return lastId();
}

function lead(projectId: number, overrides: Record<string, unknown> = {}) {
  return createLead(db, {
    projectId,
    sourceChannel: "spitogatos",
    handledBy: "Χρήστος",
    nextAction: "Τηλεφώνημα για ραντεβού",
    ...overrides,
  });
}

function oppRow(id: number) {
  return db.query("SELECT * FROM opportunities WHERE id = ?").get(id) as any;
}

function eventRows(opportunityId: number) {
  return db
    .query("SELECT * FROM sales_events WHERE opportunity_id = ? ORDER BY id")
    .all(opportunityId) as any[];
}

beforeEach(() => {
  db = initDb(":memory:");
});

// ─── createLead ────────────────────────────────────────────────────────────

describe("createLead", () => {
  test("creates analytical buyer with pseudonym '#<id>' and a Lead opportunity", () => {
    const projectId = addProject();
    const r = lead(projectId, { segment: "first_home", budgetBand: "250-400k" });

    const buyer = db.query("SELECT * FROM buyers WHERE id = ?").get(r.buyerId) as any;
    expect(buyer.pseudonym).toBe(`#${r.buyerId}`);
    expect(r.pseudonym).toBe(`#${r.buyerId}`);
    expect(buyer.segment).toBe("first_home");
    expect(buyer.source_channel).toBe("spitogatos");

    const opp = oppRow(r.opportunityId);
    expect(opp.stage).toBe("Lead");
    expect(opp.temperature).toBe("warm"); // ADR: new lead = warm
    expect(opp.buyer_id).toBe(r.buyerId);
    expect(opp.project_id).toBe(projectId);
    expect(opp.updated_at).toMatch(ISO_8601);
  });

  test("logs an 'inquiry' sales_event carrying handled_by and next_action", () => {
    const projectId = addProject();
    const r = lead(projectId);
    const events = eventRows(r.opportunityId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("inquiry");
    expect(events[0].handled_by).toBe("Χρήστος");
    expect(events[0].next_action).toBe("Τηλεφώνημα για ραντεβού");
  });

  test("next_owner defaults to handledBy and is overridable", () => {
    const projectId = addProject();
    const a = lead(projectId);
    expect(oppRow(a.opportunityId).next_owner).toBe("Χρήστος");
    const b = lead(projectId, { nextOwner: "Λωίδα" });
    expect(oppRow(b.opportunityId).next_owner).toBe("Λωίδα");
  });

  test("Article II: blank next_action throws BEFORE any row is written", () => {
    const projectId = addProject();
    for (const blank of BLANKS) {
      expect(() => lead(projectId, { nextAction: blank })).toThrow(/next_action/);
    }
    expect(count("buyers")).toBe(0);
    expect(count("opportunities")).toBe(0);
    expect(count("sales_events")).toBe(0);
  });

  test("Article IV: PII keys (name/phone/email) are rejected at runtime", () => {
    const projectId = addProject();
    for (const pii of [
      { name: "Γιάννης Παπαδόπουλος" },
      { phone: "6941234567" },
      { email: "g@example.com" },
      { fullName: "Γ. Παπαδόπουλος" },
    ]) {
      expect(() => lead(projectId, pii)).toThrow(/Article IV/);
    }
    expect(count("buyers")).toBe(0);
  });
});

// ─── DB-layer backstop (Article II CHECK + grain UNIQUE) ────────────────────

describe("DB layer backstop", () => {
  test("Article II: raw INSERT of opportunity with whitespace next_action fails the CHECK", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const blank of BLANKS) {
      expect(() =>
        db.run(
          `INSERT INTO opportunities (project_id, buyer_id, stage, temperature, next_action, next_owner, updated_at)
           VALUES (?, ?, 'Lead', 'warm', ?, 'Χρήστος', '2026-07-13T10:00:00.000Z')`,
          [addProject("Άλλο"), r.buyerId, blank],
        ),
      ).toThrow(/CHECK/);
    }
  });

  test("Article II: raw INSERT of sales_event with whitespace next_action fails the CHECK", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const blank of BLANKS) {
      expect(() =>
        db.run(
          `INSERT INTO sales_events (opportunity_id, event_type, event_date, handled_by, next_action)
           VALUES (?, 'viewing', '2026-07-13', 'Χρήστος', ?)`,
          [r.opportunityId, blank],
        ),
      ).toThrow(/CHECK/);
    }
  });

  test("grain: UNIQUE(buyer_id, project_id) rejects a second opportunity for the same pair", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(() =>
      db.run(
        `INSERT INTO opportunities (project_id, buyer_id, stage, temperature, next_action, next_owner, updated_at)
         VALUES (?, ?, 'Lead', 'warm', 'κάτι', 'Χρήστος', '2026-07-13T10:00:00.000Z')`,
        [projectId, r.buyerId],
      ),
    ).toThrow(/UNIQUE/);
  });
});

// ─── logViewing ──────────────────────────────────────────────────────────────

describe("logViewing", () => {
  test("appends a viewing event and sets temperature from interest (5 → hot)", () => {
    const projectId = addProject();
    const r = lead(projectId);
    const v = logViewing(db, {
      projectId,
      buyerId: r.buyerId,
      interest: 5,
      handledBy: "Λωίδα",
      nextAction: "Αποστολή κάτοψης",
    });
    expect(v.created).toBe(false);
    expect(v.temperature).toBe("hot");
    const opp = oppRow(v.opportunityId);
    expect(opp.temperature).toBe("hot");
    expect(opp.next_action).toBe("Αποστολή κάτοψης");
    expect(opp.next_owner).toBe("Λωίδα");
    const events = eventRows(v.opportunityId);
    expect(events).toHaveLength(2); // inquiry + viewing
    expect(events[1].event_type).toBe("viewing");
    expect(events[1].interest).toBe(5);
    expect(events[1].handled_by).toBe("Λωίδα");
  });

  test("advances stage Lead → Επίσκεψη", () => {
    const projectId = addProject();
    const r = lead(projectId);
    const v = logViewing(db, {
      projectId, buyerId: r.buyerId, interest: 3,
      handledBy: "Χρήστος", nextAction: "Δεύτερη επίσκεψη",
    });
    expect(oppRow(v.opportunityId).stage).toBe("Επίσκεψη");
  });

  test("grain edge case: viewing with NO prior opportunity creates it on the spot", () => {
    const projectId = addProject();
    const other = addProject("Άλλο"); // opportunity exists on OTHER project only
    const r = lead(other);
    const v = logViewing(db, {
      projectId, buyerId: r.buyerId, interest: 4,
      handledBy: "Γιολάντα", nextAction: "Πρόταση για προσφορά",
    });
    expect(v.created).toBe(true);
    const opp = oppRow(v.opportunityId);
    expect(opp.project_id).toBe(projectId);
    expect(opp.stage).toBe("Επίσκεψη");
    expect(opp.temperature).toBe("hot");
  });

  test("unit routing: event.unit_id AND opportunity.focus_unit_id both set", () => {
    const projectId = addProject();
    const unitId = addUnit(projectId);
    const r = lead(projectId);
    const v = logViewing(db, {
      projectId, buyerId: r.buyerId, unitId, interest: 3,
      handledBy: "Χρήστος", nextAction: "Επανάκληση",
    });
    expect(oppRow(v.opportunityId).focus_unit_id).toBe(unitId);
    expect(eventRows(v.opportunityId)[1].unit_id).toBe(unitId);
  });

  test("stage never regresses: opportunity at Προσφορά stays Προσφορά after a viewing", () => {
    const projectId = addProject();
    const r = lead(projectId);
    logOffer(db, {
      projectId, buyerId: r.buyerId, amount: 230000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση",
    });
    const v = logViewing(db, {
      projectId, buyerId: r.buyerId, interest: 2,
      handledBy: "Χρήστος", nextAction: "Επίσκεψη σε άλλο διαμέρισμα",
    });
    expect(oppRow(v.opportunityId).stage).toBe("Προσφορά");
    expect(oppRow(v.opportunityId).temperature).toBe("cold"); // latest interest wins
  });

  test("Article II: blank next_action throws and writes nothing", () => {
    const projectId = addProject();
    const r = lead(projectId);
    const before = eventRows(r.opportunityId).length;
    for (const blank of BLANKS) {
      expect(() =>
        logViewing(db, {
          projectId, buyerId: r.buyerId, interest: 3,
          handledBy: "Χρήστος", nextAction: blank,
        }),
      ).toThrow(/next_action/);
    }
    expect(eventRows(r.opportunityId).length).toBe(before);
  });

  test("invalid interest throws RangeError before any write", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const bad of [0, 6, 2.5, NaN]) {
      expect(() =>
        logViewing(db, {
          projectId, buyerId: r.buyerId, interest: bad,
          handledBy: "Χρήστος", nextAction: "κάτι",
        }),
      ).toThrow(RangeError);
    }
    expect(eventRows(r.opportunityId)).toHaveLength(1);
  });
});

// ─── logOffer ────────────────────────────────────────────────────────────────

describe("logOffer", () => {
  test("forces temperature 'hot' and advances stage to Προσφορά", () => {
    const projectId = addProject();
    const r = lead(projectId);
    logViewing(db, {
      projectId, buyerId: r.buyerId, interest: 1, // cold
      handledBy: "Χρήστος", nextAction: "Επανάκληση",
    });
    const o = logOffer(db, {
      projectId, buyerId: r.buyerId, amount: 231300,
      handledBy: "Λωίδα", nextAction: "Μεταφορά προσφοράς στον εργολάβο",
    });
    const opp = oppRow(o.opportunityId);
    expect(opp.temperature).toBe("hot");
    expect(opp.stage).toBe("Προσφορά");
    const offers = eventRows(o.opportunityId).filter((e) => e.event_type === "offer");
    expect(offers).toHaveLength(1);
    expect(offers[0].amount).toBe(231300);
    expect(offers[0].handled_by).toBe("Λωίδα");
  });

  test("grain edge case: offer with NO prior opportunity creates it on the spot", () => {
    const projectId = addProject();
    const other = addProject("Άλλο");
    const r = lead(other);
    const unitId = addUnit(projectId);
    const o = logOffer(db, {
      projectId, buyerId: r.buyerId, unitId, amount: 240000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση στον αγοραστή",
    });
    expect(o.created).toBe(true);
    const opp = oppRow(o.opportunityId);
    expect(opp.stage).toBe("Προσφορά");
    expect(opp.temperature).toBe("hot");
    expect(opp.focus_unit_id).toBe(unitId);
    expect(eventRows(o.opportunityId)[0].unit_id).toBe(unitId);
  });

  test("stage never regresses: offer on a Κράτηση opportunity keeps Κράτηση", () => {
    const projectId = addProject();
    const r = lead(projectId);
    advanceOpportunity(db, {
      opportunityId: r.opportunityId, stage: "Κράτηση",
      nextAction: "Προετοιμασία συμβολαίου",
    });
    const o = logOffer(db, {
      projectId, buyerId: r.buyerId, amount: 200000,
      handledBy: "Χρήστος", nextAction: "Ενημέρωση εργολάβου",
    });
    expect(oppRow(o.opportunityId).stage).toBe("Κράτηση");
  });

  test("non-positive or non-integer amount throws RangeError", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const bad of [0, -1000, 1000.5, NaN]) {
      expect(() =>
        logOffer(db, {
          projectId, buyerId: r.buyerId, amount: bad,
          handledBy: "Χρήστος", nextAction: "κάτι",
        }),
      ).toThrow(RangeError);
    }
  });

  test("Article II: blank next_action throws and writes nothing", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const blank of BLANKS) {
      expect(() =>
        logOffer(db, {
          projectId, buyerId: r.buyerId, amount: 200000,
          handledBy: "Χρήστος", nextAction: blank,
        }),
      ).toThrow(/next_action/);
    }
    expect(eventRows(r.opportunityId)).toHaveLength(1);
  });
});

// ─── advanceOpportunity ──────────────────────────────────────────────────────

describe("advanceOpportunity", () => {
  test("moves stage forward and refreshes next_action/next_owner/updated_at", () => {
    const projectId = addProject();
    const r = lead(projectId);
    advanceOpportunity(db, {
      opportunityId: r.opportunityId, stage: "Κράτηση",
      nextAction: "Κατάθεση προκαταβολής", nextOwner: "Γιολάντα",
      at: "2026-07-14T09:00:00.000Z",
    });
    const opp = oppRow(r.opportunityId);
    expect(opp.stage).toBe("Κράτηση");
    expect(opp.next_action).toBe("Κατάθεση προκαταβολής");
    expect(opp.next_owner).toBe("Γιολάντα");
    expect(opp.updated_at).toBe("2026-07-14T09:00:00.000Z");
  });

  test("never regresses: Προσφορά → Lead throws", () => {
    const projectId = addProject();
    const r = lead(projectId);
    logOffer(db, {
      projectId, buyerId: r.buyerId, amount: 200000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση",
    });
    expect(() =>
      advanceOpportunity(db, {
        opportunityId: r.opportunityId, stage: "Lead", nextAction: "κάτι",
      }),
    ).toThrow(/forward/);
    expect(() =>
      advanceOpportunity(db, {
        opportunityId: r.opportunityId, stage: "Προσφορά", nextAction: "κάτι",
      }),
    ).toThrow(/forward/);
    expect(oppRow(r.opportunityId).stage).toBe("Προσφορά");
  });

  test("Fallthrough is reachable from any live stage; closed stages cannot advance", () => {
    const projectId = addProject();
    const r = lead(projectId);
    advanceOpportunity(db, {
      opportunityId: r.opportunityId, stage: "Fallthrough",
      nextAction: "Καταγραφή λόγου απώλειας",
    });
    expect(oppRow(r.opportunityId).stage).toBe("Fallthrough");
    expect(() =>
      advanceOpportunity(db, {
        opportunityId: r.opportunityId, stage: "Κράτηση", nextAction: "κάτι",
      }),
    ).toThrow(/closed/);
  });

  test("unknown stage or missing opportunity throws", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(() =>
      advanceOpportunity(db, {
        opportunityId: r.opportunityId, stage: "Παζάρι" as any, nextAction: "κάτι",
      }),
    ).toThrow(RangeError);
    expect(() =>
      advanceOpportunity(db, { opportunityId: 9999, stage: "Κράτηση", nextAction: "κάτι" }),
    ).toThrow(/opportunity/i);
  });

  test("Article II: blank next_action throws, stage untouched", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const blank of BLANKS) {
      expect(() =>
        advanceOpportunity(db, {
          opportunityId: r.opportunityId, stage: "Κράτηση", nextAction: blank,
        }),
      ).toThrow(/next_action/);
    }
    expect(oppRow(r.opportunityId).stage).toBe("Lead");
  });
});

// ─── listPipeline ────────────────────────────────────────────────────────────

describe("listPipeline", () => {
  test("card fields: pseudonym, unit code, stage, temperature, offer amount, next_action, next_owner", () => {
    const projectId = addProject();
    const unitId = addUnit(projectId, "B2");
    const r = lead(projectId);
    logOffer(db, {
      projectId, buyerId: r.buyerId, unitId, amount: 245000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση €248.000",
    });
    const rows = listPipeline(db, projectId);
    expect(rows).toHaveLength(1);
    const card = rows[0]!;
    expect(card.pseudonym).toBe(`#${r.buyerId}`);
    expect(card.unitCode).toBe("B2");
    expect(card.stage).toBe("Προσφορά");
    expect(card.temperature).toBe("hot");
    expect(card.offerAmount).toBe(245000);
    expect(card.nextAction).toBe("Αντιπρόταση €248.000");
    expect(card.nextOwner).toBe("Χρήστος");
  });

  test("offerAmount is the LATEST offer; null when no offer yet; unitCode null without focus unit", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(listPipeline(db, projectId)[0]!.offerAmount).toBeNull();
    expect(listPipeline(db, projectId)[0]!.unitCode).toBeNull();
    logOffer(db, { projectId, buyerId: r.buyerId, amount: 200000, handledBy: "Χρήστος", nextAction: "α" });
    logOffer(db, { projectId, buyerId: r.buyerId, amount: 215000, handledBy: "Χρήστος", nextAction: "β" });
    expect(listPipeline(db, projectId)[0]!.offerAmount).toBe(215000);
  });

  test("ADR closed-stage filter: Συμβόλαιο and Fallthrough never appear on the board", () => {
    const projectId = addProject();
    const a = lead(projectId);
    const b = lead(projectId);
    const c = lead(projectId);
    advanceOpportunity(db, { opportunityId: a.opportunityId, stage: "Συμβόλαιο", nextAction: "Αρχειοθέτηση" });
    advanceOpportunity(db, { opportunityId: b.opportunityId, stage: "Fallthrough", nextAction: "Καταγραφή λόγου" });
    const rows = listPipeline(db, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.opportunityId).toBe(c.opportunityId);
  });

  test("deterministic needs-attention order: temperature, then furthest stage, then stalest, then id", () => {
    const projectId = addProject();
    // warm fresh lead (created later timestamps via `at`)
    const warmLead = lead(projectId, { at: "2026-07-10T10:00:00.000Z" });
    // hot offer, recently touched
    const hotOffer = lead(projectId, { at: "2026-07-01T10:00:00.000Z" });
    logOffer(db, {
      projectId, buyerId: hotOffer.buyerId, amount: 230000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση", at: "2026-07-12T10:00:00.000Z",
    });
    // hot viewing, stale — same temperature as hotOffer but earlier stage
    const hotViewing = lead(projectId, { at: "2026-07-01T09:00:00.000Z" });
    logViewing(db, {
      projectId, buyerId: hotViewing.buyerId, interest: 5,
      handledBy: "Χρήστος", nextAction: "Δεύτερη επίσκεψη", at: "2026-07-02T10:00:00.000Z",
    });
    // cold viewing
    const coldViewing = lead(projectId, { at: "2026-07-01T08:00:00.000Z" });
    logViewing(db, {
      projectId, buyerId: coldViewing.buyerId, interest: 1,
      handledBy: "Χρήστος", nextAction: "Επανεκτίμηση", at: "2026-07-03T10:00:00.000Z",
    });

    const order = listPipeline(db, projectId).map((r) => r.opportunityId);
    expect(order).toEqual([
      hotOffer.opportunityId,   // hot, furthest stage (Προσφορά)
      hotViewing.opportunityId, // hot, Επίσκεψη
      warmLead.opportunityId,   // warm
      coldViewing.opportunityId, // cold
    ]);

    // same input → same output (strict total order)
    expect(listPipeline(db, projectId).map((r) => r.opportunityId)).toEqual(order);
  });

  test("staleness + id tiebreak within same temperature and stage", () => {
    const projectId = addProject();
    const fresh = lead(projectId, { at: "2026-07-12T10:00:00.000Z" });
    const stale = lead(projectId, { at: "2026-07-01T10:00:00.000Z" });
    const twinA = lead(projectId, { at: "2026-07-05T10:00:00.000Z" });
    const twinB = lead(projectId, { at: "2026-07-05T10:00:00.000Z" });
    const order = listPipeline(db, projectId).map((r) => r.opportunityId);
    expect(order).toEqual([
      stale.opportunityId,
      twinA.opportunityId, // equal updated_at → lower id first
      twinB.opportunityId,
      fresh.opportunityId,
    ]);
  });

  test("Article IV: cards expose the pseudonym only — no PII-shaped keys in any row", () => {
    const projectId = addProject();
    lead(projectId);
    for (const row of listPipeline(db, projectId)) {
      for (const key of Object.keys(row)) {
        expect(key.toLowerCase()).not.toMatch(/(name|phone|email)/);
      }
    }
  });
});

// ─── activityCounters ────────────────────────────────────────────────────────

describe("activityCounters", () => {
  test("counts inquiries/viewings/offers and live opportunities per project", () => {
    const projectId = addProject();
    const other = addProject("Άλλο");
    const a = lead(projectId);
    const b = lead(projectId);
    lead(other); // must not leak into projectId counters
    logViewing(db, { projectId, buyerId: a.buyerId, interest: 4, handledBy: "Χρήστος", nextAction: "α" });
    logViewing(db, { projectId, buyerId: b.buyerId, interest: 2, handledBy: "Λωίδα", nextAction: "β" });
    logOffer(db, { projectId, buyerId: a.buyerId, amount: 230000, handledBy: "Χρήστος", nextAction: "γ" });

    expect(activityCounters(db, projectId)).toEqual({
      inquiries: 2,
      viewings: 2,
      offers: 1,
      liveOpportunities: 2,
    });
  });

  test("closed stages leave the live counter (events still counted, ADR)", () => {
    const projectId = addProject();
    const a = lead(projectId);
    lead(projectId);
    advanceOpportunity(db, { opportunityId: a.opportunityId, stage: "Fallthrough", nextAction: "Καταγραφή" });
    const c = activityCounters(db, projectId);
    expect(c.liveOpportunities).toBe(1);
    expect(c.inquiries).toBe(2);
  });

  test("empty project returns zeros, not nulls", () => {
    const projectId = addProject();
    expect(activityCounters(db, projectId)).toEqual({
      inquiries: 0,
      viewings: 0,
      offers: 0,
      liveOpportunities: 0,
    });
  });
});

// ─── T008 · Article II — the guard fires BEFORE any DB statement ─────────────
// Mechanism: a CLOSED database handle. If any write function touched the DB
// before validating next_action, the closed handle would surface a DB error
// (not the Article II message). No mocks — real handle, real ordering proof.

describe("Article II guard ordering (T008)", () => {
  test("control: a valid write on a closed handle fails at the DB, not with the Article II message", () => {
    const projectId = addProject();
    const closed = initDb(":memory:");
    closed.close();
    let err: unknown;
    try {
      createLead(closed, {
        projectId,
        sourceChannel: "referral",
        handledBy: "Χρήστος",
        nextAction: "Τηλεφώνημα",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined(); // the handle is genuinely dead …
    expect(String(err)).not.toMatch(/next_action/); // … and dies in the DB, not the guard
  });

  test("createLead/logViewing/logOffer/advanceOpportunity reject blank next_action before any DB statement", () => {
    const closed = initDb(":memory:");
    closed.close();
    for (const blank of BLANKS) {
      // Each call runs against the CLOSED handle: reaching the DB at all would
      // raise a closed-database error instead of the Article II message.
      expect(() =>
        createLead(closed, {
          projectId: 1, sourceChannel: "referral",
          handledBy: "Χρήστος", nextAction: blank,
        }),
      ).toThrow(/next_action/);
      expect(() =>
        logViewing(closed, {
          projectId: 1, buyerId: 1, interest: 3,
          handledBy: "Χρήστος", nextAction: blank,
        }),
      ).toThrow(/next_action/);
      expect(() =>
        logOffer(closed, {
          projectId: 1, buyerId: 1, amount: 200000,
          handledBy: "Χρήστος", nextAction: blank,
        }),
      ).toThrow(/next_action/);
      expect(() =>
        advanceOpportunity(closed, {
          opportunityId: 1, stage: "Κράτηση", nextAction: blank,
        }),
      ).toThrow(/next_action/);
    }
  });
});

// ─── T008 · Article IV — analytical layer independent of buyer_identity ──────

/**
 * Extracts the SQL-bearing string literals from a TypeScript source: every
 * backtick/quoted literal that contains a SQL keyword. Comments are never
 * captured (they are not string literals), and non-SQL strings (error
 * messages) are filtered out by the keyword test.
 */
function sqlLiteralsIn(source: string): string[] {
  const literals = [
    ...source.matchAll(/`[^`]*`/gs),
    ...source.matchAll(/"[^"\n]*"/g),
    ...source.matchAll(/'[^'\n]*'/g),
  ].map((m) => m[0]);
  return literals.filter((s) => /\b(SELECT|INSERT|UPDATE|DELETE|JOIN|FROM)\b/i.test(s));
}

describe("Article IV: queries layer never touches buyer_identity (T008)", () => {
  const QUERIES_PATH = new URL("../src/db/queries.ts", import.meta.url);

  test("no SQL statement in src/db/queries.ts references buyer_identity", () => {
    const source = readFileSync(QUERIES_PATH, "utf-8");
    const sql = sqlLiteralsIn(source);
    // Guard against a vacuous pass: the extractor must actually find the layer's SQL.
    expect(sql.length).toBeGreaterThanOrEqual(10);
    for (const statement of sql) {
      expect(statement).not.toMatch(/buyer_identity/i);
    }
  });

  test("v_buyer_pool aggregates ready buyers with buyer_identity EMPTY", () => {
    const projectId = addProject();
    lead(projectId, { segment: "first_home", areaPref: "Κυψέλη", budgetBand: "250-400k" });
    lead(projectId, { segment: "first_home", areaPref: "Κυψέλη", budgetBand: "250-400k" });
    lead(projectId, { segment: "investor", areaPref: "Κυψέλη", budgetBand: "400k+" });

    // The PII table is genuinely empty — the pool number needs no identity at all.
    expect(
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM buyer_identity").get()!.n,
    ).toBe(0);

    const pool = db
      .query("SELECT * FROM v_buyer_pool ORDER BY segment")
      .all() as Array<Record<string, unknown>>;
    expect(pool).toEqual([
      { segment: "first_home", area_pref: "Κυψέλη", budget_band: "250-400k", ready_buyers: 2 },
      { segment: "investor", area_pref: "Κυψέλη", budget_band: "400k+", ready_buyers: 1 },
    ]);
  });

  test("listPipeline, activityCounters and v_buyer_pool survive DROP TABLE buyer_identity (right-to-erasure hard case)", () => {
    const projectId = addProject();
    const unitId = addUnit(projectId, "B2");
    const a = lead(projectId, { segment: "first_home", areaPref: "Κυψέλη", budgetBand: "250-400k" });
    const b = lead(projectId, { segment: "investor", areaPref: "Κυψέλη", budgetBand: "400k+" });
    logViewing(db, {
      projectId, buyerId: a.buyerId, unitId, interest: 4,
      handledBy: "Λωίδα", nextAction: "Πρόταση για προσφορά",
    });
    logOffer(db, {
      projectId, buyerId: a.buyerId, unitId, amount: 240000,
      handledBy: "Χρήστος", nextAction: "Αντιπρόταση €245.000",
    });

    db.run("DROP TABLE buyer_identity");

    const rows = listPipeline(db, projectId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.opportunityId).toBe(a.opportunityId); // hot offer first
    expect(rows[0]!.pseudonym).toBe(`#${a.buyerId}`);
    expect(rows[0]!.unitCode).toBe("B2");
    expect(rows[0]!.offerAmount).toBe(240000);
    expect(rows[1]!.opportunityId).toBe(b.opportunityId);

    expect(activityCounters(db, projectId)).toEqual({
      inquiries: 2,
      viewings: 1,
      offers: 1,
      liveOpportunities: 2,
    });

    const pool = db
      .query("SELECT * FROM v_buyer_pool ORDER BY segment")
      .all() as Array<Record<string, unknown>>;
    expect(pool).toEqual([
      { segment: "first_home", area_pref: "Κυψέλη", budget_band: "250-400k", ready_buyers: 1 },
      { segment: "investor", area_pref: "Κυψέλη", budget_band: "400k+", ready_buyers: 1 },
    ]);
  });
});
