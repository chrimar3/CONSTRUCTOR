// T011 — Day-0 migration (US-7 / FR-10 / SC-6): load an EXISTING pipeline from a
// structured JSON file so the team opens a populated board on first launch.
//
// File shape (ADR-0020): three arrays — projects (with nested units), analytical
// buyers, opportunities (with nested sales_events history) — referenced by natural
// keys (project_name, pseudonym, unit_code), never raw ids. The file is a
// DECLARATIVE snapshot of a pipeline that already exists: stage/temperature are
// stored as stated (migrated facts), not re-derived. NO PII may appear anywhere —
// buyers are pseudonyms-only (Article IV; the example file is committed).
//
// The whole file is validated BEFORE any DB statement (a bad record anywhere
// means nothing is written), loaded in ONE transaction, and idempotent on re-run:
// insert-if-absent by natural key; an existing opportunity keeps its history
// (its events are skipped with it).

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { initDb } from "./init";

// ─── Seed file shape ─────────────────────────────────────────────────────────

export interface SeedUnit {
  unit_code: string;
  floor?: number;
  sqm?: number;
  rooms?: number;
  orientation?: string;
  /** stored as features_json */
  features?: Record<string, unknown>;
  asking_initial: number;
  /** defaults to asking_initial (no in-system price history yet at Day-0) */
  asking_current?: number;
  status?: string;
}

export interface SeedProject {
  builder_name: string;
  project_name: string;
  area: string;
  micro_area: string; // Article V: project + micro-area precision, never coarse
  total_units: number;
  listed_at: string;
  exclusivity_start?: string;
  exclusivity_end?: string;
  exclusivity_phase?: string;
  commission_model?: string;
  units: SeedUnit[];
}

export interface SeedBuyer {
  pseudonym: string; // analytical only — NO PII in this file (Article IV)
  source_channel: string;
  segment?: string;
  budget_band?: string;
  financing?: string;
  area_pref?: string;
  created_at: string;
}

export interface SeedEvent {
  type: "inquiry" | "viewing" | "offer"; // Phase B event types are NOT loadable
  date: string;
  /** unit_code within the opportunity's project */
  unit?: string;
  interest?: number; // required 1..5 for viewings
  amount?: number; // required positive integer € for offers
  note?: string;
  handled_by: string;
  next_action: string; // Article II — every event carries one
}

export interface SeedOpportunity {
  project: string; // ref: projects[].project_name
  buyer: string; // ref: buyers[].pseudonym
  focus_unit?: string; // ref: unit_code within the project
  stage: string;
  temperature: string;
  next_action: string; // Article II
  next_owner: string;
  updated_at: string;
  events: SeedEvent[];
}

export interface SeedFile {
  projects: SeedProject[];
  buyers: SeedBuyer[];
  opportunities: SeedOpportunity[];
}

export interface SeedCounts {
  projects: number;
  units: number;
  buyers: number;
  opportunities: number;
  events: number;
}

export interface SeedSummary {
  inserted: SeedCounts;
  skipped: SeedCounts;
}

// ─── Validation vocabulary (stored-key universes, data-model.md) ─────────────

const STAGES = new Set(["Lead", "Επίσκεψη", "Προσφορά", "Κράτηση", "Συμβόλαιο", "Fallthrough"]);
const TEMPERATURES = new Set(["hot", "warm", "cold"]);
// Loadable history is the Phase-A capture universe only — reservation/contract
// stay dark (Phase B); a migration file cannot smuggle them in.
const EVENT_TYPES = new Set(["inquiry", "viewing", "offer"]);
const UNIT_STATUSES = new Set(["live", "reserved", "sold", "withdrawn"]);

const ALLOWED_PROJECT_KEYS = new Set([
  "builder_name", "project_name", "area", "micro_area", "total_units", "listed_at",
  "exclusivity_start", "exclusivity_end", "exclusivity_phase", "commission_model", "units",
]);
const ALLOWED_UNIT_KEYS = new Set([
  "unit_code", "floor", "sqm", "rooms", "orientation", "features",
  "asking_initial", "asking_current", "status",
]);
const ALLOWED_BUYER_KEYS = new Set([
  "pseudonym", "segment", "budget_band", "financing", "area_pref", "source_channel", "created_at",
]);
const ALLOWED_OPPORTUNITY_KEYS = new Set([
  "project", "buyer", "focus_unit", "stage", "temperature",
  "next_action", "next_owner", "updated_at", "events",
]);
const ALLOWED_EVENT_KEYS = new Set([
  "type", "date", "unit", "interest", "amount", "note", "handled_by", "next_action",
]);

/** Same pattern as the queries-layer Article IV guard. */
const PII_KEY = /(name|phone|email|mail|tel)/i;

// ─── Validation helpers (all run BEFORE any DB statement) ────────────────────

function fail(where: string, problem: string): never {
  throw new Error(`seed: ${where} — ${problem}`);
}

function assertKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
  piiChecked: boolean,
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.has(key)) continue;
    if (piiChecked && PII_KEY.test(key)) {
      fail(where, `Article IV: PII key "${key}" rejected — the seed file is pseudonyms-only; buyer PII lives only in buyer_identity (encrypted)`);
    }
    fail(where, `unknown key "${key}"`);
  }
}

function reqString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    fail(where, `"${key}" must be a non-empty string`);
  }
  return v;
}

function optString(obj: Record<string, unknown>, key: string, where: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(where, `"${key}" must be a string`);
  return v;
}

function reqPositiveInt(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    fail(where, `"${key}" must be a positive integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

function optNumber(obj: Record<string, unknown>, key: string, where: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(where, `"${key}" must be a number`);
  return v;
}

function assertNextAction(value: unknown, where: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(where, "Article II: next_action must be non-empty — no opportunity or event without a next action");
  }
}

function assertArray(value: unknown, key: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail("file", `"${key}" must be an array`);
}

/**
 * Validates the ENTIRE file (shape, enums, Article II/IV/V invariants, natural-key
 * uniqueness and reference resolution) without touching the database. Throwing here
 * guarantees a bad file writes nothing.
 */
function validate(data: SeedFile): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    fail("file", "seed file must be a JSON object with projects/buyers/opportunities arrays");
  }
  const raw = data as unknown as Record<string, unknown>;
  assertKeys(raw, new Set(["projects", "buyers", "opportunities"]), "file", false);
  assertArray(raw.projects, "projects");
  assertArray(raw.buyers, "buyers");
  assertArray(raw.opportunities, "opportunities");

  const unitCodes = new Map<string, Set<string>>(); // project_name → unit codes
  for (const [i, p] of data.projects.entries()) {
    const where = `projects[${i}]`;
    assertKeys(p as unknown as Record<string, unknown>, ALLOWED_PROJECT_KEYS, where, false);
    const rec = p as unknown as Record<string, unknown>;
    const name = reqString(rec, "project_name", where);
    reqString(rec, "builder_name", where);
    reqString(rec, "area", where);
    const micro = rec.micro_area;
    if (typeof micro !== "string" || micro.trim().length === 0) {
      fail(where, "Article V: micro_area is required at project + micro-area precision (e.g. \"Κυψέλη · Πλατεία Κύπρου, block Α\") — never coarse, never empty");
    }
    reqPositiveInt(rec, "total_units", where);
    reqString(rec, "listed_at", where);
    optString(rec, "exclusivity_start", where);
    optString(rec, "exclusivity_end", where);
    optString(rec, "exclusivity_phase", where);
    optString(rec, "commission_model", where);
    if (unitCodes.has(name)) fail(where, `duplicate project_name "${name}" in file`);
    const codes = new Set<string>();
    unitCodes.set(name, codes);

    assertArray(rec.units, `${where}.units`);
    for (const [j, u] of p.units.entries()) {
      const uw = `${where}.units[${j}]`;
      assertKeys(u as unknown as Record<string, unknown>, ALLOWED_UNIT_KEYS, uw, false);
      const urec = u as unknown as Record<string, unknown>;
      const code = reqString(urec, "unit_code", uw);
      if (codes.has(code)) fail(uw, `duplicate unit_code "${code}" in project "${name}"`);
      codes.add(code);
      reqPositiveInt(urec, "asking_initial", uw);
      if (urec.asking_current !== undefined) reqPositiveInt(urec, "asking_current", uw);
      optNumber(urec, "floor", uw);
      optNumber(urec, "sqm", uw);
      optNumber(urec, "rooms", uw);
      optString(urec, "orientation", uw);
      if (urec.features !== undefined && (urec.features === null || typeof urec.features !== "object" || Array.isArray(urec.features))) {
        fail(uw, `"features" must be an object`);
      }
      const status = optString(urec, "status", uw);
      if (status !== null && !UNIT_STATUSES.has(status)) {
        fail(uw, `unknown unit status "${status}" (expected ${[...UNIT_STATUSES].join("|")})`);
      }
    }
  }

  const pseudonyms = new Set<string>();
  for (const [i, b] of data.buyers.entries()) {
    const where = `buyers[${i}]`;
    assertKeys(b as unknown as Record<string, unknown>, ALLOWED_BUYER_KEYS, where, true);
    const rec = b as unknown as Record<string, unknown>;
    const pseudonym = reqString(rec, "pseudonym", where);
    if (pseudonyms.has(pseudonym)) fail(where, `duplicate pseudonym "${pseudonym}" in file`);
    pseudonyms.add(pseudonym);
    reqString(rec, "source_channel", where);
    reqString(rec, "created_at", where);
    optString(rec, "segment", where);
    optString(rec, "budget_band", where);
    optString(rec, "financing", where);
    optString(rec, "area_pref", where);
  }

  const grain = new Set<string>(); // one opportunity per buyer↔project, in-file too
  for (const [i, o] of data.opportunities.entries()) {
    const where = `opportunities[${i}]`;
    assertKeys(o as unknown as Record<string, unknown>, ALLOWED_OPPORTUNITY_KEYS, where, true);
    const rec = o as unknown as Record<string, unknown>;
    const project = reqString(rec, "project", where);
    const buyer = reqString(rec, "buyer", where);
    if (!unitCodes.has(project)) fail(where, `unknown project reference "${project}"`);
    if (!pseudonyms.has(buyer)) fail(where, `unknown buyer reference "${buyer}"`);
    const grainKey = `${buyer} ${project}`;
    if (grain.has(grainKey)) {
      fail(where, `grain violation: one opportunity per buyer↔project — "${buyer}" already has one for "${project}"`);
    }
    grain.add(grainKey);
    const focusUnit = optString(rec, "focus_unit", where);
    if (focusUnit !== null && !unitCodes.get(project)!.has(focusUnit)) {
      fail(where, `unknown focus_unit "${focusUnit}" in project "${project}"`);
    }
    const stage = reqString(rec, "stage", where);
    if (!STAGES.has(stage)) fail(where, `unknown stage "${stage}" (expected ${[...STAGES].join("|")})`);
    const temp = reqString(rec, "temperature", where);
    if (!TEMPERATURES.has(temp)) fail(where, `unknown temperature "${temp}" (expected hot|warm|cold)`);
    assertNextAction(rec.next_action, where);
    reqString(rec, "next_owner", where);
    reqString(rec, "updated_at", where);

    assertArray(rec.events, `${where}.events`);
    for (const [j, e] of o.events.entries()) {
      const ew = `${where}.events[${j}]`;
      assertKeys(e as unknown as Record<string, unknown>, ALLOWED_EVENT_KEYS, ew, true);
      const erec = e as unknown as Record<string, unknown>;
      const type = reqString(erec, "type", ew);
      if (!EVENT_TYPES.has(type)) {
        fail(ew, `unknown event type "${type}" (expected ${[...EVENT_TYPES].join("|")}; reservation/contract capture is Phase B)`);
      }
      reqString(erec, "date", ew);
      reqString(erec, "handled_by", ew);
      assertNextAction(erec.next_action, ew);
      const unit = optString(erec, "unit", ew);
      if (unit !== null && !unitCodes.get(project)!.has(unit)) {
        fail(ew, `unknown unit "${unit}" in project "${project}"`);
      }
      optString(erec, "note", ew);
      if (type === "viewing") {
        const interest = erec.interest;
        if (typeof interest !== "number" || !Number.isInteger(interest) || interest < 1 || interest > 5) {
          fail(ew, `a viewing requires interest as an integer 1..5, got ${JSON.stringify(interest)}`);
        }
      } else if (erec.interest !== undefined) {
        fail(ew, `interest is only valid on viewings`);
      }
      if (type === "offer") {
        reqPositiveInt(erec, "amount", ew); // message names "amount"
      } else if (erec.amount !== undefined) {
        fail(ew, `amount is only valid on offers`);
      }
    }
  }
}

// ─── Loader ──────────────────────────────────────────────────────────────────

function getId(db: Database, sql: string, params: (string | number)[]): number | null {
  const row = db.query<{ id: number }, (string | number)[]>(sql).get(...params);
  return row === null ? null : Number(row.id);
}

function lastId(db: Database): number {
  return Number(
    (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
}

/**
 * Loads a validated seed file in ONE transaction. Idempotent: projects match on
 * (builder_name, project_name), units on (project, unit_code), buyers on
 * pseudonym, opportunities on the (buyer, project) grain — existing rows are
 * skipped, and an existing opportunity keeps its already-loaded event history.
 */
export function seed(db: Database, data: SeedFile): SeedSummary {
  validate(data); // throws BEFORE any DB statement — a bad file writes nothing

  const inserted: SeedCounts = { projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 };
  const skipped: SeedCounts = { projects: 0, units: 0, buyers: 0, opportunities: 0, events: 0 };

  db.transaction(() => {
    const projectIds = new Map<string, number>(); // project_name → id
    const unitIds = new Map<string, number>(); // project_name␀unit_code → id

    for (const p of data.projects) {
      let pid = getId(
        db,
        "SELECT id FROM projects WHERE builder_name = ? AND project_name = ?",
        [p.builder_name, p.project_name],
      );
      if (pid === null) {
        db.run(
          `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units,
                                 exclusivity_start, exclusivity_end, exclusivity_phase, commission_model, listed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.builder_name,
            p.project_name,
            p.area,
            p.micro_area,
            p.total_units,
            p.exclusivity_start ?? null,
            p.exclusivity_end ?? null,
            p.exclusivity_phase ?? null,
            p.commission_model ?? null,
            p.listed_at,
          ],
        );
        pid = lastId(db);
        inserted.projects++;
      } else {
        skipped.projects++;
      }
      projectIds.set(p.project_name, pid);

      for (const u of p.units) {
        let uid = getId(db, "SELECT id FROM units WHERE project_id = ? AND unit_code = ?", [
          pid,
          u.unit_code,
        ]);
        if (uid === null) {
          db.run(
            `INSERT INTO units (project_id, unit_code, floor, sqm, rooms, orientation,
                                features_json, asking_initial, asking_current, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              pid,
              u.unit_code,
              u.floor ?? null,
              u.sqm ?? null,
              u.rooms ?? null,
              u.orientation ?? null,
              u.features === undefined ? null : JSON.stringify(u.features),
              u.asking_initial,
              u.asking_current ?? u.asking_initial,
              u.status ?? "live",
            ],
          );
          uid = lastId(db);
          inserted.units++;
        } else {
          skipped.units++;
        }
        unitIds.set(`${p.project_name} ${u.unit_code}`, uid);
      }
    }

    const buyerIds = new Map<string, number>(); // pseudonym → id
    for (const b of data.buyers) {
      let bid = getId(db, "SELECT id FROM buyers WHERE pseudonym = ?", [b.pseudonym]);
      if (bid === null) {
        // Preserve the ADR-0014 invariant (pseudonym "#N" ⇔ id N) so a later
        // createLead (MAX(id)+1) can never mint a pseudonym that already exists.
        const numeric = /^#(\d+)$/.exec(b.pseudonym);
        const explicitId = numeric === null ? null : Number(numeric[1]);
        if (explicitId !== null) {
          const holder = db
            .query<{ pseudonym: string }, [number]>("SELECT pseudonym FROM buyers WHERE id = ?")
            .get(explicitId);
          if (holder !== null) {
            fail(
              `buyers("${b.pseudonym}")`,
              `id ${explicitId} is already held by "${holder.pseudonym}" — a "#N" pseudonym must load as buyer id N`,
            );
          }
        }
        db.run(
          `INSERT INTO buyers (id, pseudonym, segment, budget_band, financing, area_pref, source_channel, consent_flag, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            explicitId, // NULL → SQLite allocates
            b.pseudonym,
            b.segment ?? null,
            b.budget_band ?? null,
            b.financing ?? null,
            b.area_pref ?? null,
            b.source_channel,
            b.created_at,
          ],
        );
        bid = explicitId ?? lastId(db);
        inserted.buyers++;
      } else {
        skipped.buyers++;
      }
      buyerIds.set(b.pseudonym, bid);
    }

    for (const o of data.opportunities) {
      const pid = projectIds.get(o.project)!;
      const bid = buyerIds.get(o.buyer)!;
      const existing = getId(
        db,
        "SELECT id FROM opportunities WHERE buyer_id = ? AND project_id = ?",
        [bid, pid],
      );
      if (existing !== null) {
        // Grain row already loaded — its history came with it the first time.
        skipped.opportunities++;
        skipped.events += o.events.length;
        continue;
      }

      db.run(
        `INSERT INTO opportunities (project_id, buyer_id, focus_unit_id, stage, temperature, next_action, next_owner, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pid,
          bid,
          o.focus_unit === undefined ? null : unitIds.get(`${o.project} ${o.focus_unit}`)!,
          o.stage,
          o.temperature,
          o.next_action,
          o.next_owner,
          o.updated_at,
        ],
      );
      const oppId = lastId(db);
      inserted.opportunities++;

      for (const e of o.events) {
        db.run(
          `INSERT INTO sales_events (opportunity_id, unit_id, event_type, event_date, interest, amount, note, handled_by, next_action)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            oppId,
            e.unit === undefined ? null : unitIds.get(`${o.project} ${e.unit}`)!,
            e.type,
            e.date,
            e.interest ?? null,
            e.amount ?? null,
            e.note ?? null,
            e.handled_by,
            e.next_action,
          ],
        );
        inserted.events++;
      }
    }
  })();

  return { inserted, skipped };
}

// ─── CLI: bun run seed <file.json> ───────────────────────────────────────────

if (import.meta.main) {
  const file = Bun.argv[2];
  if (!file) {
    console.error("Χρήση: bun run seed <αρχείο.json>  (π.χ. bun run seed seed.example.json)");
    process.exit(1);
  }

  let data: SeedFile;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Σφάλμα seed: το "${file}" δεν διαβάζεται ως έγκυρο JSON (${e instanceof Error ? e.message : String(e)})`);
    process.exit(1);
  }

  const db = initDb();
  try {
    const { inserted, skipped } = seed(db, data);
    const skippedTotal =
      skipped.projects + skipped.units + skipped.buyers + skipped.opportunities + skipped.events;
    console.log(
      `Seed ολοκληρώθηκε: ${inserted.projects} έργα, ${inserted.units} μονάδες, ` +
        `${inserted.buyers} αγοραστές, ${inserted.opportunities} ευκαιρίες, ${inserted.events} γεγονότα.` +
        (skippedTotal > 0 ? ` Παραλείφθηκαν ${skippedTotal} εγγραφές που υπήρχαν ήδη.` : ""),
    );
  } catch (e) {
    console.error(`Σφάλμα seed: ${e instanceof Error ? e.message : String(e)} — δεν αποθηκεύτηκε τίποτα.`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
