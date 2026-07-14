// T007 — queries layer: owns ALL SQL for capture + pipeline (CLAUDE.md system design).
// Every write mirrors Article II in JS (throw on blank next_action BEFORE touching the
// DB); the schema CHECK stays the backstop. Buyers here are ANALYTICAL ONLY — any
// PII-shaped input key is rejected at runtime (Article IV). Multi-statement writes run
// inside db.transaction. Grain: ONE opportunity per buyer↔project (UNIQUE constraint);
// logging a viewing/offer with no prior opportunity CREATES it on the spot.

import type { Database } from "bun:sqlite";
import { counter, type CounterSuggestion } from "../domain/counter";
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

export interface LogOfferResult extends LogEventResult {
  /**
   * T010 — counter() suggestion against the offer's unit (falling back to the
   * opportunity's focus unit, ADR-0018); null when the offer is at/above asking
   * or no unit is in play. Locked math: ADR-0003 (0.6 weight, €500 rounding).
   */
  counter: CounterSuggestion | null;
}

export interface UpdateAskingPriceInput {
  unitId: number;
  newPrice: number;
  reason?: string;
  /** ISO-8601 timestamp override (defaults to now) — keeps tests deterministic. */
  at?: string;
}

export interface UpdateAskingPriceResult {
  unitId: number;
  oldPrice: number;
  newPrice: number;
  changedAt: string;
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
  /** Analytical buyer id (pseudonym owner) — lets the web sheets capture against a board buyer (T012). */
  buyerId: number;
  pseudonym: string;
  unitCode: string | null;
  stage: Stage;
  temperature: Temperature;
  offerAmount: number | null;
  nextAction: string;
  nextOwner: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: number;
  builderName: string;
  projectName: string;
  area: string;
  microArea: string;
}

/** T017 — name-resolved project reference for the report CLI (incl. the default anchor). */
export interface ProjectRef {
  id: number;
  builderName: string;
  projectName: string;
  listedAt: string;
}

export interface UnitOption {
  id: number;
  unitCode: string;
  askingCurrent: number;
  status: string;
}

export interface ActivityCounters {
  inquiries: number;
  viewings: number;
  offers: number;
  liveOpportunities: number;
}

/** T014 — event totals inside a half-open report window [start, endExclusive). */
export interface WindowActivity {
  inquiries: number;
  viewings: number;
  offers: number;
}

/** T014 — per-unit report row: in-window activity + the unit's current asking. */
export interface UnitWindowActivity {
  unitId: number;
  unitCode: string;
  askingCurrent: number;
  /** T016 — needed by the monthly comps-based € target (€/m² × unit m²). */
  sqm: number | null;
  /** T016 — stored unit status key; the monthly report selects active inventory by it. */
  status: string;
  viewings: number;
  offers: number;
  /** LATEST in-window offer by event id (the live position), never MAX (ADR-0013). */
  latestOfferAmount: number | null;
}

/** T016 — one sold unit's price realization (v_price_realization view). */
export interface UnitRealization {
  unitId: number;
  unitCode: string;
  askingInitial: number;
  salePrice: number;
  /** sale_price / asking_initial as a fraction (e.g. 0.92) — straight from the view. */
  realization: number;
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
export function logOffer(db: Database, input: LogOfferInput): LogOfferResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  assertNextAction(input.nextAction);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new RangeError(`offer amount must be a positive integer €, got ${input.amount}`);
  }

  const result = logEvent(db, {
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

  // T010 — counter suggestion for the captured offer (ADR-0018). The effective
  // unit is the offer's own unit, else the opportunity's existing focus unit;
  // after logEvent, focus_unit_id holds exactly COALESCE(event unit, prior focus),
  // so one read gives the effective asking_current. A non-positive stored asking
  // (data-quality issue) yields no suggestion rather than failing a committed
  // capture — the counter is advisory, the capture is the record.
  const unit = db
    .query<{ asking: number }, [number]>(
      `SELECT u.asking_current AS asking
       FROM opportunities o
       JOIN units u ON u.id = o.focus_unit_id
       WHERE o.id = ?`,
    )
    .get(result.opportunityId);
  const asking = unit === null ? null : Number(unit.asking);

  return {
    ...result,
    counter: asking !== null && asking > 0 ? counter(asking, input.amount) : null,
  };
}

/**
 * T010a: change a unit's asking price. Updates `units.asking_current` AND appends
 * exactly one `price_changes` audit row (old/new/reason/changed_at ISO) in ONE
 * transaction — both or neither, so the live price can never diverge from its
 * history. `asking_initial` is never touched (it is the realization baseline).
 * No next_action here by design: this write creates no opportunity/event, so
 * Article II does not apply (ADR-0019).
 */
export function updateAskingPrice(
  db: Database,
  input: UpdateAskingPriceInput,
): UpdateAskingPriceResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);
  if (!Number.isInteger(input.newPrice) || input.newPrice <= 0) {
    throw new RangeError(
      `asking price must be a positive integer €, got ${input.newPrice}`,
    );
  }
  const ts = nowIso(input.at);

  return db.transaction((): UpdateAskingPriceResult => {
    // Read old price INSIDE the transaction so the logged old_price can never
    // race a concurrent update on the same connection.
    const unit = db
      .query<{ asking: number }, [number]>(
        "SELECT asking_current AS asking FROM units WHERE id = ?",
      )
      .get(input.unitId);
    if (unit === null) {
      throw new Error(`unit ${input.unitId} not found`);
    }
    const oldPrice = Number(unit.asking);

    db.run("UPDATE units SET asking_current = ? WHERE id = ?", [
      input.newPrice,
      input.unitId,
    ]);
    db.run(
      `INSERT INTO price_changes (unit_id, changed_at, old_price, new_price, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [input.unitId, ts, oldPrice, input.newPrice, input.reason ?? null],
    );

    return { unitId: input.unitId, oldPrice, newPrice: input.newPrice, changedAt: ts };
  })();
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
              b.id            AS buyerId,
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
 * T012: project list for the board's project selector. Analytical/read-only —
 * Article V surfaces micro_area alongside the names.
 */
export function listProjects(db: Database): ProjectSummary[] {
  return db
    .query<ProjectSummary, []>(
      `SELECT id             AS id,
              builder_name   AS builderName,
              project_name   AS projectName,
              area           AS area,
              micro_area     AS microArea
       FROM projects
       ORDER BY id ASC`,
    )
    .all();
}

/**
 * T012: unit options for the capture sheets' structured unit grids (Article I —
 * tap a unit code, never type it). All statuses returned; presentation decides
 * what is selectable. Deterministic order: unit_code, then id.
 */
export function listUnits(db: Database, projectId: number): UnitOption[] {
  return db
    .query<UnitOption, [number]>(
      `SELECT id              AS id,
              unit_code       AS unitCode,
              asking_current  AS askingCurrent,
              status          AS status
       FROM units
       WHERE project_id = ?
       ORDER BY unit_code ASC, id ASC`,
    )
    .all(projectId);
}

/**
 * T014: single project header data for reports (analytical only — Article IV).
 * Returns null when the project does not exist; the report boundary decides
 * how to surface that (it is a caller error, not report data).
 */
export function getProject(db: Database, projectId: number): ProjectSummary | null {
  return db
    .query<ProjectSummary, [number]>(
      `SELECT id             AS id,
              builder_name   AS builderName,
              project_name   AS projectName,
              area           AS area,
              micro_area     AS microArea
       FROM projects
       WHERE id = ?`,
    )
    .get(projectId);
}

/**
 * T014: activity totals for a report window. Half-open [start, endExclusive) on
 * event_date string comparison — an event exactly on a boundary lands in exactly
 * ONE of two adjacent windows (FR-13, no double-counting across reports).
 */
export function activityInWindow(
  db: Database,
  projectId: number,
  start: string,
  endExclusive: string,
): WindowActivity {
  const row = db
    .query<{ inquiries: number; viewings: number; offers: number }, [number, string, string]>(
      `SELECT COALESCE(SUM(e.event_type = 'inquiry'), 0) AS inquiries,
              COALESCE(SUM(e.event_type = 'viewing'), 0) AS viewings,
              COALESCE(SUM(e.event_type = 'offer'), 0)   AS offers
       FROM sales_events e
       JOIN opportunities o ON o.id = e.opportunity_id
       WHERE o.project_id = ? AND e.event_date >= ? AND e.event_date < ?`,
    )
    .get(projectId, start, endExclusive)!;

  return {
    inquiries: Number(row.inquiries),
    viewings: Number(row.viewings),
    offers: Number(row.offers),
  };
}

/**
 * T014: per-unit breakdown for a report window. EVERY unit of the project is
 * returned (a silent unit is exactly the cold metric Article VI must pair with a
 * recommendation), with in-window viewing/offer counts and the LATEST in-window
 * offer by event id. Deterministic order: unit_code, then id.
 */
export function unitActivityInWindow(
  db: Database,
  projectId: number,
  start: string,
  endExclusive: string,
): UnitWindowActivity[] {
  return db
    .query<
      UnitWindowActivity,
      [string, string, string, string, number]
    >(
      `SELECT u.id           AS unitId,
              u.unit_code    AS unitCode,
              u.asking_current AS askingCurrent,
              u.sqm          AS sqm,
              u.status       AS status,
              COALESCE(SUM(e.event_type = 'viewing'), 0) AS viewings,
              COALESCE(SUM(e.event_type = 'offer'), 0)   AS offers,
              (SELECT e2.amount FROM sales_events e2
                WHERE e2.unit_id = u.id AND e2.event_type = 'offer'
                  AND e2.event_date >= ? AND e2.event_date < ?
                ORDER BY e2.id DESC LIMIT 1) AS latestOfferAmount
       FROM units u
       LEFT JOIN sales_events e
         ON e.unit_id = u.id AND e.event_date >= ? AND e.event_date < ?
       WHERE u.project_id = ?
       GROUP BY u.id
       ORDER BY u.unit_code ASC, u.id ASC`,
    )
    .all(start, endExclusive, start, endExclusive, projectId)
    .map((row) => ({
      unitId: Number(row.unitId),
      unitCode: row.unitCode,
      askingCurrent: Number(row.askingCurrent),
      sqm: row.sqm === null ? null : Number(row.sqm),
      status: row.status,
      viewings: Number(row.viewings),
      offers: Number(row.offers),
      latestOfferAmount: row.latestOfferAmount === null ? null : Number(row.latestOfferAmount),
    }));
}

/**
 * T016: price realization per sold unit — reads the schema's deterministic
 * v_price_realization view (sale_price / asking_initial, sold units only) and
 * joins units for display fields. Deterministic order: unit_code, then id.
 */
export function priceRealization(db: Database, projectId: number): UnitRealization[] {
  return db
    .query<UnitRealization, [number]>(
      `SELECT v.unit_id        AS unitId,
              u.unit_code      AS unitCode,
              u.asking_initial AS askingInitial,
              u.sale_price     AS salePrice,
              v.realization    AS realization
       FROM v_price_realization v
       JOIN units u ON u.id = v.unit_id
       WHERE v.project_id = ?
       ORDER BY u.unit_code ASC, u.id ASC`,
    )
    .all(projectId)
    .map((row) => ({
      unitId: Number(row.unitId),
      unitCode: row.unitCode,
      askingInitial: Number(row.askingInitial),
      salePrice: Number(row.salePrice),
      realization: Number(row.realization),
    }));
}

/**
 * T016: units still available for sale — the absorption forecast's remaining
 * stock. status = 'live' only: reserved units are on their way out and
 * sold/withdrawn units are no longer inventory.
 */
export function liveUnitCount(db: Database, projectId: number): number {
  const row = db
    .query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM units WHERE project_id = ? AND status = 'live'",
    )
    .get(projectId)!;
  return Number(row.n);
}

/**
 * T017: name-addressed project resolution for the report CLI (read-only). The
 * operator addresses a project as builder name + project name; ties (same name
 * twice under one builder) resolve deterministically to the lowest id.
 */
export function findProject(
  db: Database,
  builderName: string,
  projectName: string,
): ProjectRef | null {
  return db
    .query<ProjectRef, [string, string]>(
      `SELECT id           AS id,
              builder_name AS builderName,
              project_name AS projectName,
              listed_at    AS listedAt
       FROM projects
       WHERE builder_name = ? AND project_name = ?
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(builderName, projectName);
}

/** T017: does any project exist for this builder? (distinguishes the two Greek CLI errors) */
export function builderExists(db: Database, builderName: string): boolean {
  return (
    db
      .query<{ one: number }, [string]>(
        "SELECT 1 AS one FROM projects WHERE builder_name = ? LIMIT 1",
      )
      .get(builderName) !== null
  );
}

/**
 * T017: the most recent event DAY ("YYYY-MM-DD") recorded for a project, or null
 * when it has no events. This is the CLI's data-derived default as-of — Article
 * III forbids the wall clock anywhere in the report path, so "run it today"
 * defaults to the day of the latest recorded activity. MAX over full strings
 * first (date-only sorts before same-day timestamps, harmless for the day), then
 * substr to the day at the SQL layer.
 */
export function latestEventDay(db: Database, projectId: number): string | null {
  const row = db
    .query<{ day: string | null }, [number]>(
      `SELECT MAX(substr(e.event_date, 1, 10)) AS day
       FROM sales_events e
       JOIN opportunities o ON o.id = e.opportunity_id
       WHERE o.project_id = ?`,
    )
    .get(projectId);
  return row === null ? null : row.day;
}

export interface SeparationRow {
  handledBy: string;
  events: number;
}

/**
 * T019 (SC-5): per-operator event counts from the v_separation view — the
 * separation test proving handled_by attribution is queryable from day one.
 * The view has no inherent order (GROUP BY), so a deterministic ORDER BY —
 * busiest operator first, ties broken by name in byte order — keeps the
 * separation report byte-stable across runs (Article III). Read-only, global
 * across projects (the view aggregates ALL sales_events by design).
 */
export function separationCounts(db: Database): SeparationRow[] {
  return db
    .query<{ handled_by: string; events: number }, []>(
      `SELECT handled_by, events FROM v_separation
       ORDER BY events DESC, handled_by ASC`,
    )
    .all()
    .map((row) => ({ handledBy: row.handled_by, events: Number(row.events) }));
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
