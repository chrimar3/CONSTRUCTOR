// T011a — Comps entry (FR-12): operator-entered known neighbourhood SALE prices
// (never asking), labelled by source, plus the merge query the monthly comparative
// (T016) consumes: own sold units (units.sale_price NOT NULL) auto-count as
// 'own_transaction' alongside comps rows for a micro_area. No automated external
// or portal ingestion — ever (FR-12 locked clarification).

import { Database } from "bun:sqlite";
import { initDb } from "./init";

export type CompSource = "own_transaction" | "manual_known_sale";

const COMP_SOURCES: readonly CompSource[] = ["own_transaction", "manual_known_sale"];

export interface AddCompInput {
  area: string;
  microArea: string; // Article V: micro-area precision required, never coarse
  salePrice: number; // actual SALE price in €, never an asking price
  source: CompSource;
  sqm?: number;
  rooms?: number;
  saleDate?: string; // ISO date
  enteredBy?: string; // required when source = 'manual_known_sale'
  note?: string;
}

/** One comparable in the merged micro-area view (comps rows + own sold units). */
export interface CompRow {
  area: string;
  microArea: string;
  sqm: number | null;
  rooms: number | null;
  salePrice: number;
  saleDate: string | null;
  source: CompSource;
}

export interface AddCompResult extends CompRow {
  id: number;
  enteredBy: string | null;
  note: string | null;
}

const PII_KEY = /(name|phone|email|mail|tel)/i;

/** Article IV: comps are market data — a buyer-shaped key here is always a bug. */
function assertNoPiiKeys(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (PII_KEY.test(key)) {
      throw new Error(
        `Article IV: PII key "${key}" rejected — buyer PII lives only in buyer_identity (encrypted), never in comps`,
      );
    }
  }
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Stores one neighbourhood comparable. Validates BEFORE any DB statement:
 * source must be declared ('own_transaction' | 'manual_known_sale'), micro_area
 * is Article V-mandatory, sale_price is a positive integer € and is an actual
 * SALE price (asking prices are not comps), manual entries carry entered_by.
 */
export function addComp(db: Database, input: AddCompInput): AddCompResult {
  assertNoPiiKeys(input as unknown as Record<string, unknown>);

  if (!COMP_SOURCES.includes(input.source)) {
    throw new Error(
      `FR-12: comp source must be one of ${COMP_SOURCES.join(" | ")}, got ${JSON.stringify(input.source)} — every comp is labelled by where the sale price is known from`,
    );
  }
  if (isBlank(input.microArea)) {
    throw new Error(
      "Article V: micro_area must be non-empty at micro-area precision (e.g. \"Κυψέλη · Πλατεία Κύπρου, block Α\") — never coarse, never missing",
    );
  }
  if (isBlank(input.area)) {
    throw new Error("FR-12: area must be non-empty — comps must stay locatable");
  }
  if (!Number.isInteger(input.salePrice) || input.salePrice <= 0) {
    throw new RangeError(
      `comp sale_price must be a positive integer € and an actual SALE price (never asking), got ${input.salePrice}`,
    );
  }
  if (input.source === "manual_known_sale" && isBlank(input.enteredBy)) {
    throw new Error(
      "FR-12: entered_by is required for manual_known_sale comps — manual market data must be accountable to an operator",
    );
  }

  return db.transaction((): AddCompResult => {
    db.run(
      `INSERT INTO comps (area, micro_area, sqm, rooms, sale_price, sale_date, source, entered_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.area,
        input.microArea,
        input.sqm ?? null,
        input.rooms ?? null,
        input.salePrice,
        input.saleDate ?? null,
        input.source,
        input.enteredBy ?? null,
        input.note ?? null,
      ],
    );
    const id = Number(
      (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
    );
    return {
      id,
      area: input.area,
      microArea: input.microArea,
      sqm: input.sqm ?? null,
      rooms: input.rooms ?? null,
      salePrice: input.salePrice,
      saleDate: input.saleDate ?? null,
      source: input.source,
      enteredBy: input.enteredBy ?? null,
      note: input.note ?? null,
    };
  })();
}

/**
 * The FR-12 merge the monthly comparative consumes: comps rows for a micro_area
 * UNION ALL own sold units (units.sale_price NOT NULL, located via their
 * project's micro_area) auto-labelled 'own_transaction'. Own sales are never
 * double-entered (Article VII) — they count automatically. Ordering is
 * deterministic (Article III): compound-SELECT ORDER BY may only name result
 * columns (no expressions), NULLs sort first consistently, and any remaining
 * ties are field-identical rows — byte-identical output either way.
 */
export function compsForMicroArea(db: Database, microArea: string): CompRow[] {
  const rows = db
    .query<
      {
        area: string;
        micro_area: string;
        sqm: number | null;
        rooms: number | null;
        sale_price: number;
        sale_date: string | null;
        source: CompSource;
      },
      [string, string]
    >(
      `SELECT area, micro_area, sqm, rooms, sale_price, sale_date, source
         FROM comps
        WHERE micro_area = ?
       UNION ALL
       SELECT p.area, p.micro_area, u.sqm, u.rooms, u.sale_price,
              NULL AS sale_date, 'own_transaction' AS source
         FROM units u
         JOIN projects p ON p.id = u.project_id
        WHERE u.sale_price IS NOT NULL AND p.micro_area = ?
        ORDER BY sale_price ASC, source ASC, sale_date ASC, sqm ASC, rooms ASC`,
    )
    .all(microArea, microArea);

  return rows.map((r) => ({
    area: r.area,
    microArea: r.micro_area,
    sqm: r.sqm === null ? null : Number(r.sqm),
    rooms: r.rooms === null ? null : Number(r.rooms),
    salePrice: Number(r.sale_price),
    saleDate: r.sale_date,
    source: r.source,
  }));
}

// ─── CLI: bun run comp:add -- --area=… --micro-area=… --price=… --source=… ───

const USAGE = `Χρήση: bun run comp:add -- --area="Κυψέλη" --micro-area="Κυψέλη · Πλατεία Κύπρου, block Α" \\
       --price=185000 --source=manual_known_sale --entered-by=Χρήστος \\
       [--sqm=78] [--rooms=2] [--date=2026-06-15] [--note="…"]

Καταχώρηση συγκριτικού πώλησης (comp) για τη μηνιαία σύγκριση micro-area (FR-12).

ΠΡΟΣΟΧΗ: το --price είναι ΠΡΑΓΜΑΤΙΚΗ τιμή ΠΩΛΗΣΗΣ — ποτέ ζητούμενη (asking) τιμή.

  --source       manual_known_sale = γνωστή πώληση στη γειτονιά, καταχωρείται χειροκίνητα
                 own_transaction   = δική μας πώληση (σπάνια χρειάζεται: οι πωλημένες
                 μονάδες του συστήματος μετρούν ΑΥΤΟΜΑΤΑ ως own_transaction — μην τις
                 ξανακαταχωρείς)
  --entered-by   υποχρεωτικό για manual_known_sale (Χρήστος / Λωίδα / Γιολάντα)
  --micro-area   υποχρεωτικό, σε ακρίβεια micro-area — ποτέ γενικό ("Αθήνα")`;

if (import.meta.main) {
  const { parseArgs } = await import("node:util");

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        area: { type: "string" },
        "micro-area": { type: "string" },
        price: { type: "string" },
        source: { type: "string" },
        "entered-by": { type: "string" },
        sqm: { type: "string" },
        rooms: { type: "string" },
        date: { type: "string" },
        note: { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (e) {
    console.error(
      `Σφάλμα comp:add: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`,
    );
    process.exit(1);
  }

  const v = parsed.values as Record<string, string | boolean | undefined>;
  if (v.help === true || Bun.argv.length <= 2) {
    console.log(USAGE);
    process.exit(v.help === true ? 0 : 1);
  }

  const db = initDb();
  try {
    const stored = addComp(db, {
      area: v.area as string,
      microArea: v["micro-area"] as string,
      salePrice: v.price === undefined ? NaN : Number(v.price),
      source: v.source as CompSource,
      sqm: v.sqm === undefined ? undefined : Number(v.sqm),
      rooms: v.rooms === undefined ? undefined : Number(v.rooms),
      saleDate: v.date as string | undefined,
      enteredBy: v["entered-by"] as string | undefined,
      note: v.note as string | undefined,
    });
    console.log(
      `Καταχωρήθηκε comp #${stored.id}: ${stored.microArea} — τιμή πώλησης €${stored.salePrice} (${stored.source}).`,
    );
  } catch (e) {
    console.error(
      `Σφάλμα comp:add: ${e instanceof Error ? e.message : String(e)} — δεν αποθηκεύτηκε τίποτα.\n\n${USAGE}`,
    );
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
