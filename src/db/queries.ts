/**
 * Query layer — owns ALL SQL (CLAUDE.md system design). Pure bun:sqlite,
 * no ORM (Article VIII). Every write:
 *   - throws on empty/whitespace next_action BEFORE touching the DB
 *     (Article II at the query layer; the SQL CHECK is the last line),
 *   - records handled_by + next_action on the event row,
 *   - stamps opportunities.updated_at with an ISO-8601 timestamp,
 *   - wraps multi-statement writes in a transaction.
 *
 * Buyers created here are ANALYTICAL ONLY (Article IV): pseudonym, segment,
 * budget band, source channel… PII (name/phone/email) is rejected outright —
 * identity has its own encrypted path (T008a) and is never read here.
 */
import type { Database } from "bun:sqlite";
import { temperature, type Temperature } from "../domain/temperature";

// ---------------------------------------------------------------- stages ---

/** INTERNAL stored keys exactly as in schema.sql — rendered only via labels.ts (FR-11). */
export type Stage = "Lead" | "Επίσκεψη" | "Προσφορά" | "Κράτηση" | "Συμβόλαιο" | "Fallthrough";

/** Forward-only ordering. Fallthrough is terminal: reachable from anywhere, never left. */
const STAGE_ORDER: Record<Stage, number> = {
  Lead: 0,
  "Επίσκεψη": 1,
  "Προσφορά": 2,
  "Κράτηση": 3,
  "Συμβόλαιο": 4,
  Fallthrough: 5,
};

/** Stages that are off the live board (closed one way or the other). */
const CLOSED_STAGES: readonly Stage[] = ["Συμβόλαιο", "Fallthrough"];

// ---------------------------------------------------------------- guards ---

function assertNextAction(nextAction: string): string {
  if (typeof nextAction !== "string" || nextAction.trim().length === 0) {
    throw new Error("Article II: next_action must be non-empty — no record without a next action");
  }
  return nextAction;
}

const PII_KEYS = ["name", "phone", "email", "name_enc", "phone_enc", "email_enc"] as const;

function assertNoPII(buyer: Record<string, unknown>): void {
  for (const key of PII_KEYS) {
    if (key in buyer) {
      throw new Error(
        `Article IV: PII field '${key}' is not accepted here — identity goes through the encrypted buyer_identity path only`
      );
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return nowIso().slice(0, 10);
}

// ----------------------------------------------------------------- types ---

export interface AnalyticalBuyerInput {
  sourceChannel: string; // spitogatos|xe|referral|walkin|social
  segment?: string; // first_home|investor|upgrader|foreign
  budgetBand?: string; // '<150k'|'150-250k'|'250-400k'|'400k+'
  financing?: string; // cash|mortgage|spiti_mou_2
  areaPref?: string;
}

export interface CreateLeadInput {
  projectId: number;
  buyer: AnalyticalBuyerInput;
  focusUnitId?: number | null;
  handledBy: string; // Χρήστος | Λωίδα | Γιολάντα (validated at the API boundary, T012a)
  nextAction: string;
  nextOwner?: string; // defaults to handledBy
  note?: string | null;
  eventDate?: string; // ISO date; defaults to today
}

export interface CreateLeadResult {
  buyerId: number;
  opportunityId: number;
  pseudonym: string;
}

interface EventInputBase {
  projectId: number;
  buyerId: number;
  unitId: number;
  handledBy: string;
  nextAction: string;
  nextOwner?: string;
  note?: string | null;
  eventDate?: string;
}

export interface LogViewingInput extends EventInputBase {
  interest: number; // 1..5
}

export interface LogOfferInput extends EventInputBase {
  amount: number; // €
}

export interface LogEventResult {
  opportunityId: number;
  eventId: number;
  /** true when the event created the opportunity on the spot (no prior lead). */
  created: boolean;
  temperature: Temperature;
  stage: Stage;
}

export interface AdvanceResult {
  opportunityId: number;
  stage: Stage;
  /** false when the target was not forward of the current stage (no regression). */
  advanced: boolean;
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
  live: number;
  viewings: number;
  offers: number;
}

// ---------------------------------------------------------------- writes ---

/**
 * US-1: new inquiry → analytical buyer (pseudonym "#<id>") + opportunity at
 * stage Lead + an 'inquiry' event. New leads start 'warm' (ADR-0008).
 */
export function createLead(db: Database, input: CreateLeadInput): CreateLeadResult {
  assertNextAction(input.nextAction);
  assertNoPII(input.buyer as unknown as Record<string, unknown>);

  const now = nowIso();
  const eventDate = input.eventDate ?? todayIso();
  const nextOwner = input.nextOwner ?? input.handledBy;

  return db.transaction((): CreateLeadResult => {
    const nextId =
      db.query<{ n: number }, []>("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM buyers").get()!.n;
    const pseudonym = `#${nextId}`;

    db.query(
      `INSERT INTO buyers (id, pseudonym, segment, budget_band, financing, area_pref, source_channel, consent_flag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      nextId,
      pseudonym,
      input.buyer.segment ?? null,
      input.buyer.budgetBand ?? null,
      input.buyer.financing ?? null,
      input.buyer.areaPref ?? null,
      input.buyer.sourceChannel,
      now
    );

    const opp = db
      .query(
        `INSERT INTO opportunities (project_id, buyer_id, focus_unit_id, stage, temperature, next_action, next_owner, updated_at)
         VALUES (?, ?, ?, 'Lead', 'warm', ?, ?, ?)`
      )
      .run(input.projectId, nextId, input.focusUnitId ?? null, input.nextAction, nextOwner, now);
    const opportunityId = Number(opp.lastInsertRowid);

    db.query(
      `INSERT INTO sales_events (opportunity_id, unit_id, event_type, event_date, note, handled_by, next_action)
       VALUES (?, ?, 'inquiry', ?, ?, ?, ?)`
    ).run(opportunityId, input.focusUnitId ?? null, eventDate, input.note ?? null, input.handledBy, input.nextAction);

    return { buyerId: nextId, opportunityId, pseudonym };
  })();
}

/**
 * Finds the buyer↔project opportunity or creates it on the spot (spec edge
 * case: viewing/offer with no prior lead). Stage advances FORWARD ONLY;
 * temperature always follows the latest signal. The event's unit becomes the
 * opportunity's focus_unit_id.
 */
function upsertOpportunityForEvent(
  db: Database,
  input: EventInputBase,
  eventStage: Stage,
  temp: Temperature,
  now: string
): { opportunityId: number; created: boolean; stage: Stage } {
  const nextOwner = input.nextOwner ?? input.handledBy;
  const existing = db
    .query<{ id: number; stage: Stage }, [number, number]>(
      "SELECT id, stage FROM opportunities WHERE buyer_id = ? AND project_id = ?"
    )
    .get(input.buyerId, input.projectId);

  if (!existing) {
    const res = db
      .query(
        `INSERT INTO opportunities (project_id, buyer_id, focus_unit_id, stage, temperature, next_action, next_owner, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.projectId, input.buyerId, input.unitId, eventStage, temp, input.nextAction, nextOwner, now);
    return { opportunityId: Number(res.lastInsertRowid), created: true, stage: eventStage };
  }

  const stage = STAGE_ORDER[eventStage] > STAGE_ORDER[existing.stage] ? eventStage : existing.stage;
  db.query(
    `UPDATE opportunities
     SET stage = ?, temperature = ?, focus_unit_id = ?, next_action = ?, next_owner = ?, updated_at = ?
     WHERE id = ?`
  ).run(stage, temp, input.unitId, input.nextAction, nextOwner, now, existing.id);
  return { opportunityId: existing.id, created: false, stage };
}

function logEvent(
  db: Database,
  input: EventInputBase,
  eventType: "viewing" | "offer",
  eventStage: Stage,
  temp: Temperature,
  extra: { interest?: number; amount?: number }
): LogEventResult {
  const now = nowIso();
  const eventDate = input.eventDate ?? todayIso();

  return db.transaction((): LogEventResult => {
    const opp = upsertOpportunityForEvent(db, input, eventStage, temp, now);
    const ev = db
      .query(
        `INSERT INTO sales_events (opportunity_id, unit_id, event_type, event_date, interest, amount, note, handled_by, next_action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opp.opportunityId,
        input.unitId,
        eventType,
        eventDate,
        extra.interest ?? null,
        extra.amount ?? null,
        input.note ?? null,
        input.handledBy,
        input.nextAction
      );
    return {
      opportunityId: opp.opportunityId,
      eventId: Number(ev.lastInsertRowid),
      created: opp.created,
      temperature: temp,
      stage: opp.stage,
    };
  })();
}

/** US-2: viewing → stage ≥ Επίσκεψη, temperature derived from interest (1..5). */
export function logViewing(db: Database, input: LogViewingInput): LogEventResult {
  assertNextAction(input.nextAction);
  const temp = temperature(input.interest); // throws RangeError on bad interest
  return logEvent(db, input, "viewing", "Επίσκεψη", temp, { interest: input.interest });
}

/** US-3: offer → stage ≥ Προσφορά, temperature forced hot, amount recorded. */
export function logOffer(db: Database, input: LogOfferInput): LogEventResult {
  assertNextAction(input.nextAction);
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new RangeError(`offer amount must be a positive number, got ${input.amount}`);
  }
  return logEvent(db, input, "offer", "Προσφορά", "hot", { amount: input.amount });
}

/**
 * Manual stage move. Forward only — a target at or behind the current stage
 * leaves the stage untouched (advanced: false) but still refreshes
 * next_action / next_owner / updated_at (Article II: the move itself needs a
 * next action).
 */
export function advanceOpportunity(
  db: Database,
  opportunityId: number,
  targetStage: Stage,
  nextAction: string,
  nextOwner?: string
): AdvanceResult {
  assertNextAction(nextAction);
  if (!(targetStage in STAGE_ORDER)) {
    throw new Error(`unknown stage '${targetStage}' — must be a stored key from schema.sql`);
  }

  const current = db
    .query<{ stage: Stage; next_owner: string }, [number]>(
      "SELECT stage, next_owner FROM opportunities WHERE id = ?"
    )
    .get(opportunityId);
  if (!current) {
    throw new Error(`opportunity ${opportunityId} not found`);
  }

  const advanced = STAGE_ORDER[targetStage] > STAGE_ORDER[current.stage];
  const stage = advanced ? targetStage : current.stage;
  db.query(
    "UPDATE opportunities SET stage = ?, next_action = ?, next_owner = ?, updated_at = ? WHERE id = ?"
  ).run(stage, nextAction, nextOwner ?? current.next_owner, nowIso(), opportunityId);

  return { opportunityId, stage, advanced };
}

// ---------------------------------------------------------------- reads ----

/**
 * US-4 board. Needs-attention-first, deterministic (ADR-0007):
 *   1. temperature hot → warm → cold (hottest buyer risk first),
 *   2. stage furthest along first (an offer on the table outranks a lead),
 *   3. stalest updated_at first (longest untouched needs eyes),
 *   4. id ascending as the final total-order tiebreak.
 * Closed stages (Συμβόλαιο, Fallthrough) are off the board.
 * offerAmount = the LATEST offer event (by event_date, then id).
 * Analytical surface only — never joins buyer_identity (Article IV).
 */
export function listPipeline(db: Database, projectId: number): PipelineCard[] {
  return db
    .query<PipelineCard, [number]>(
      `SELECT
         o.id            AS opportunityId,
         b.pseudonym     AS pseudonym,
         u.unit_code     AS unitCode,
         o.stage         AS stage,
         o.temperature   AS temperature,
         (SELECT se.amount FROM sales_events se
           WHERE se.opportunity_id = o.id AND se.event_type = 'offer'
           ORDER BY se.event_date DESC, se.id DESC LIMIT 1) AS offerAmount,
         o.next_action   AS nextAction,
         o.next_owner    AS nextOwner,
         o.updated_at    AS updatedAt
       FROM opportunities o
       JOIN buyers b ON b.id = o.buyer_id
       LEFT JOIN units u ON u.id = o.focus_unit_id
       WHERE o.project_id = ?
         AND o.stage NOT IN ('Συμβόλαιο', 'Fallthrough')
       ORDER BY
         CASE o.temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
         CASE o.stage WHEN 'Κράτηση' THEN 0 WHEN 'Προσφορά' THEN 1 WHEN 'Επίσκεψη' THEN 2 ELSE 3 END,
         o.updated_at ASC,
         o.id ASC`
    )
    .all(projectId);
}

/** US-4 per-project counters: live opportunities / viewings / offers. */
export function activityCounters(db: Database, projectId: number): ActivityCounters {
  const live = db
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM opportunities
       WHERE project_id = ? AND stage NOT IN ('Συμβόλαιο', 'Fallthrough')`
    )
    .get(projectId)!.n;

  const byType = (type: string): number =>
    db
      .query<{ n: number }, [number, string]>(
        `SELECT COUNT(*) AS n FROM sales_events se
         JOIN opportunities o ON o.id = se.opportunity_id
         WHERE o.project_id = ? AND se.event_type = ?`
      )
      .get(projectId, type)!.n;

  return { live, viewings: byType("viewing"), offers: byType("offer") };
}

export { CLOSED_STAGES, STAGE_ORDER };
