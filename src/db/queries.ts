// T007 — queries layer: owns ALL SQL for capture + pipeline (CLAUDE.md system design).
// Every write mirrors Article II in JS (throw on blank next_action BEFORE touching the
// DB); the schema CHECK stays the backstop. Buyers here are ANALYTICAL ONLY — any
// PII-shaped input key is rejected at runtime (Article IV). Multi-statement writes run
// inside db.transaction. Grain: ONE opportunity per buyer↔project (UNIQUE constraint);
// logging a viewing/offer with no prior opportunity CREATES it on the spot.

import type { Database } from "bun:sqlite";
import { temperature, type Temperature } from "../domain/temperature";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Stage =
  | "Lead"
  | "Επίσκεψη"
  | "Προσφορά"
  | "Κράτηση"
  | "Συμβόλαιο"
  | "Fallthrough";

/** Forward-only funnel rank (ADR-0013). Fallthrough is terminal-from-any-live-stage. */
const STAGE_RANK: Record<Stage, number> = {
  Lead: 0,
  "Επίσκεψη": 1,
  "Προσφορά": 2,
  "Κράτηση": 3,
  "Συμβόλαιο": 4,
  Fallthrough: 5,
};

const CLOSED_STAGES: ReadonlySet<Stage> = new Set(["Συμβόλαιο", "Fallthrough"]);

export interface CreateLeadInput {
  projectId: number;
  sourceChannel: string;
  handledBy: string;
  nextAction: string;
  nextOwner?: string;
  segment?: string;
  budgetBand?: string;
  financing?: string;
  areaPref?: string;
  focusUnitId?: number;
  note?: string;
  /** ISO-8601 timestamp override (defaults to now) — keeps tests deterministic. */
  at?: string;
}

export interface CreateLeadResult {
  buyerId: number;
  opportunityId: number;
  pseudonym: string;
}

export interface LogViewingInput {
  projectId: number;
  buyerId: number;
  interest: number;
  handledBy: string;
  nextAction: string;
  unitId?: number;
  nextOwner?: string;
  note?: string;
  at?: string;
}

export interface LogOfferInput {
  projectId: number;
  buyerId: number;
  amount: number;
  handledBy: string;
  nextAction: string;
  unitId?: number;
  nextOwner?: string;
  note?: string;
  at?: string;
}

export interface LogEventResult {
  opportunityId: number;
  eventId: number;
  temperature: Temperature;
  /** true when the buyer↔project opportunity did not exist and was created on the spot */
  created: boolean;
}

export interface AdvanceOpportunityInput {
  opportunityId: number;
  stage: Stage;
  nextAction: string;
  nextOwner?: string;
  at?: string;
}

export interface PipelineCard {
  opportunityId: number;
  pseudonym: string;
  unitCode: string | null;
  stage: Stage;
  temperature: Temperature;
  offerAmount: number | null;
  nextAction: string;
  nextOwner: string;
  updatedAt: string;
}

export interface ActivityCounters {
  inquiries: number;
  viewings: number;
  offers: number;
  liveOpportunities: number;
}

// ─── Guards (run BEFORE any DB statement) ────────────────────────────────────

/** Article II mirrored in JS: JS trim() covers all Unicode whitespace. */
function assertNextAction(nextAction: string): void {
  if (typeof nextAction !== "string" || nextAction.trim().length === 0) {
    throw new Error(
      "Article II: next_action must be non-empty — no opportunity or event without a next action",
    );
  }
}

const PII_KEY = /(name|phone|email|mail|tel)/i;

/** Article IV: this layer is analytical-only — PII belongs to buyer_identity (T008a). */
function assertNoPiiKeys(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (PII_KEY.test(key)) {
      throw new Error(
        `Article IV: PII key "${key}" rejected — buyer PII lives only in buyer_identity (encrypted), never in analytical queries`,
      );
    }
  }
}

function nowIso(at?: string): string {
  return at ?? new Date().toISOString();
}

function lastId(db: Database): number {
  return Number(
    (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface OppRow {
  id: number;
  stage: Stage;
}

function findOpportunity(db: Database, buyerId: number, projectId: number): OppRow | null {
  return db
    .query<OppRow, [number, number]>(
      "SELECT id, stage FROM opportunities WHERE buyer_id = ? AND project_id = ?",
    )
    .get(buyerId, projectId);
}

/** Forward-only stage move: returns the further of current/target, never regresses. */
function maxStage(current: Stage, target: Stage): Stage {
  return STAGE_RANK[target] > STAGE_RANK[current] ? target : current;
}

/**
 * Shared write path for logViewing/logOffer: upserts the buyer↔project opportunity
 * (creating it on the spot per the spec edge case), applies temperature + forward-only
 * stage, mirrors the event unit into focus_unit_id, appends the sales_event — all in
 * one transaction.
 */
function logEvent(
  db: Database,
  args: {
    projectId: number;
    buyerId: number;
    eventType: "viewing" | "offer";
    stageFloor: Stage;
    temp: Temperature;
    handledBy: string;
    nextAction: string;
    unitId?: number;
    nextOwner?: string;
    interest?: number;
    amount?: number;
    note?: string;
    at?: string;
  },
): LogEventResult {
  const ts = nowIso(args.at);
  const nextOwner = args.nextOwner ?? args.handledBy;

  return db.transaction((): LogEventResult => {
    const existing = findOpportunity(db, args.buyerId, args.projectId);
    let opportunityId: number;
    const created = existing === null;

    if (existing === null) {
      // Spec edge case: no prior opportunity — create it on the spot at the event's stage.
      db.run(
        `INSERT INTO opportunities (project_id, buyer_id, focus_unit_id, stage, temperature, next_action, next_owner, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          args.projectId,
          args.buyerId,
          args.unitId ?? null,
          args.stageFloor,
          args.temp,
          args.nextAction,
          nextOwner,
          ts,
        ],
      );
      opportunityId = lastId(db);
    } else {
      opportunityId = existing.id;
      db.run(
        `UPDATE opportunities
         SET stage = ?, temperature = ?, next_action = ?, next_owner = ?, updated_at = ?,
             focus_unit_id = COALESCE(?, focus_unit_id)
         WHERE id = ?`,
        [
          maxStage(existing.stage, args.stageFloor),
          args.temp,
          args.nextAction,
          nextOwner,
          ts,
          args.unitId ?? null,
          opportunityId,
        ],
      );
    }

    db.run(
      `INSERT INTO sales_events (opportunity_id, unit_id, event_type, event_date, interest, amount, note, handled_by, next_action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opportunityId,
        args.unitId ?? null,
        args.eventType,
        ts,
        args.interest ?? null,
        args.amount ?? null,
        args.note ?? null,
        args.handledBy,
        args.nextAction,
      ],
    );

    return { opportunityId, eventId: lastId(db), temperature: args.temp, created };
  })();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * US-1: capture a new lead. Creates the analytical buyer (pseudonym "#<id>"),
 * the Lead opportunity (warm, ADR-0014) and the 'inquiry' sales_event atomically.
 */
export function createLead(db: Database, input: CreateLeadInput): CreateLeadResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  assertNextAction(input.nextAction);
  const ts = nowIso(input.at);
  const nextOwner = input.nextOwner ?? input.handledBy;

  return db.transaction((): CreateLeadResult => {
    // Pseudonym must equal "#<id>" — allocate the id explicitly inside the
    // transaction so they can never diverge (ADR-0014, adopts v1 ADR-0008).
    const buyerId =
      Number(
        (db.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM buyers").get() as {
          id: number;
        }).id,
      );
    const pseudonym = `#${buyerId}`;

    db.run(
      `INSERT INTO buyers (id, pseudonym, segment, budget_band, financing, area_pref, source_channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buyerId,
        pseudonym,
        input.segment ?? null,
        input.budgetBand ?? null,
        input.financing ?? null,
        input.areaPref ?? null,
        input.sourceChannel,
        ts,
      ],
    );

    db.run(
      `INSERT INTO opportunities (project_id, buyer_id, focus_unit_id, stage, temperature, next_action, next_owner, updated_at)
       VALUES (?, ?, ?, 'Lead', 'warm', ?, ?, ?)`,
      [input.projectId, buyerId, input.focusUnitId ?? null, input.nextAction, nextOwner, ts],
    );
    const opportunityId = lastId(db);

    db.run(
      `INSERT INTO sales_events (opportunity_id, unit_id, event_type, event_date, note, handled_by, next_action)
       VALUES (?, ?, 'inquiry', ?, ?, ?, ?)`,
      [
        opportunityId,
        input.focusUnitId ?? null,
        ts,
        input.note ?? null,
        input.handledBy,
        input.nextAction,
      ],
    );

    return { buyerId, opportunityId, pseudonym };
  })();
}

/**
 * US-2: log a viewing. Temperature derives from interest (temperature()), the
 * stage floor is Επίσκεψη (forward-only), and the viewed unit becomes the
 * opportunity's focus unit.
 */
export function logViewing(db: Database, input: LogViewingInput): LogEventResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  assertNextAction(input.nextAction);
  const temp = temperature(input.interest); // throws RangeError before any write

  return logEvent(db, {
    projectId: input.projectId,
    buyerId: input.buyerId,
    eventType: "viewing",
    stageFloor: "Επίσκεψη",
    temp,
    handledBy: input.handledBy,
    nextAction: input.nextAction,
    unitId: input.unitId,
    nextOwner: input.nextOwner,
    interest: input.interest,
    note: input.note,
    at: input.at,
  });
}

/**
 * US-3: log an offer. Offers force temperature 'hot' (data-model derived logic);
 * the stage floor is Προσφορά (forward-only).
 */
export function logOffer(db: Database, input: LogOfferInput): LogEventResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  assertNextAction(input.nextAction);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new RangeError(`offer amount must be a positive integer €, got ${input.amount}`);
  }

  return logEvent(db, {
    projectId: input.projectId,
    buyerId: input.buyerId,
    eventType: "offer",
    stageFloor: "Προσφορά",
    temp: "hot",
    handledBy: input.handledBy,
    nextAction: input.nextAction,
    unitId: input.unitId,
    nextOwner: input.nextOwner,
    amount: input.amount,
    note: input.note,
    at: input.at,
  });
}

/**
 * Moves an opportunity's stage strictly forward (never regresses, never re-opens a
 * closed one). Fallthrough is reachable from any live stage (ADR-0013). Updates
 * the opportunity row only — reservation/contract EVENT capture is Phase B.
 */
export function advanceOpportunity(db: Database, input: AdvanceOpportunityInput): void {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  assertNextAction(input.nextAction);
  if (!(input.stage in STAGE_RANK)) {
    throw new RangeError(`unknown stage: "${input.stage}"`);
  }

  const current = db
    .query<{ stage: Stage; next_owner: string }, [number]>(
      "SELECT stage, next_owner FROM opportunities WHERE id = ?",
    )
    .get(input.opportunityId);
  if (current === null) {
    throw new Error(`opportunity ${input.opportunityId} not found`);
  }
  if (CLOSED_STAGES.has(current.stage)) {
    throw new Error(
      `opportunity ${input.opportunityId} is closed (${current.stage}) and cannot advance`,
    );
  }
  if (STAGE_RANK[input.stage] <= STAGE_RANK[current.stage]) {
    throw new Error(
      `stage moves forward only: ${current.stage} → ${input.stage} is not an advance`,
    );
  }

  db.run(
    `UPDATE opportunities SET stage = ?, next_action = ?, next_owner = ?, updated_at = ? WHERE id = ?`,
    [
      input.stage,
      input.nextAction,
      input.nextOwner ?? current.next_owner,
      nowIso(input.at),
      input.opportunityId,
    ],
  );
}

/**
 * US-4: the live board. Analytical fields only (pseudonym, never buyer_identity —
 * Article IV). Deterministic needs-attention-first total order (ADR-0013, adopts
 * v1 ADR-0007): temperature hot→warm→cold, stage furthest first, stalest first,
 * id ASC. Closed stages (Συμβόλαιο, Fallthrough) are outcomes, not work items.
 */
export function listPipeline(db: Database, projectId: number): PipelineCard[] {
  return db
    .query<PipelineCard, [number]>(
      `SELECT o.id            AS opportunityId,
              b.pseudonym     AS pseudonym,
              u.unit_code     AS unitCode,
              o.stage         AS stage,
              o.temperature   AS temperature,
              (SELECT e.amount FROM sales_events e
                WHERE e.opportunity_id = o.id AND e.event_type = 'offer'
                ORDER BY e.id DESC LIMIT 1) AS offerAmount,
              o.next_action   AS nextAction,
              o.next_owner    AS nextOwner,
              o.updated_at    AS updatedAt
       FROM opportunities o
       JOIN buyers b ON b.id = o.buyer_id
       LEFT JOIN units u ON u.id = o.focus_unit_id
       WHERE o.project_id = ?
         AND o.stage NOT IN ('Συμβόλαιο', 'Fallthrough')
       ORDER BY CASE o.temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
                CASE o.stage WHEN 'Κράτηση' THEN 0 WHEN 'Προσφορά' THEN 1 WHEN 'Επίσκεψη' THEN 2 ELSE 3 END,
                o.updated_at ASC,
                o.id ASC`,
    )
    .all(projectId);
}

/**
 * Per-project activity counters: event totals (kept even after an opportunity
 * closes — the work happened) + live-opportunity count (closed stages excluded,
 * matching the board filter).
 */
export function activityCounters(db: Database, projectId: number): ActivityCounters {
  const row = db
    .query<
      { inquiries: number; viewings: number; offers: number },
      [number]
    >(
      `SELECT COALESCE(SUM(e.event_type = 'inquiry'), 0) AS inquiries,
              COALESCE(SUM(e.event_type = 'viewing'), 0) AS viewings,
              COALESCE(SUM(e.event_type = 'offer'), 0)   AS offers
       FROM sales_events e
       JOIN opportunities o ON o.id = e.opportunity_id
       WHERE o.project_id = ?`,
    )
    .get(projectId)!;

  const live = db
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM opportunities
       WHERE project_id = ? AND stage NOT IN ('Συμβόλαιο', 'Fallthrough')`,
    )
    .get(projectId)!;

  return {
    inquiries: Number(row.inquiries),
    viewings: Number(row.viewings),
    offers: Number(row.offers),
    liveOpportunities: Number(live.n),
  };
}
