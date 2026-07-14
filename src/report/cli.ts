// T017 — `bun run report`: the one-command Greek builder report (FR-13,
// Articles III & VI). Resolves the project by BUILDER NAME + PROJECT NAME,
// computes the report window, and writes the renderer's Markdown to stdout.
//
// Window modes (FR-13):
//   DEFAULT (fixed)  Non-overlapping periods of length P (biweekly 14 / monthly
//                    30 / quarterly 90 days) tiled from --anchor (default: the
//                    project's listed_at). The report covers the period that
//                    CONTAINS the as-of day, framed at its canonical boundaries
//                    — consecutive reports can never double-count an event.
//   --rolling        Internal "how are we doing right now": the last P days
//                    ending on the as-of day itself.
//
// Article III reproducibility: --as-of=DATE computes as if run then; when
// omitted, the reference day comes from the DATA (the project's latest event
// day, else listed_at) — NEVER the wall clock (Gate 4 greps this directory).
// Same DB + same flags ⇒ byte-identical stdout.
//
// Product surface: stdout is Greek Markdown; errors are clear Greek on stderr
// with exit 1 (unknown builder/project, bad flags). The internal English layer
// errors never reach the operator from here.

import type { Database } from "bun:sqlite";
import { initDb } from "../db/init";
import { builderExists, findProject, latestEventDay } from "../db/queries";
import { biweeklyReport } from "./biweekly";
import { monthlyReport } from "./monthly";
import { renderBrief } from "./brief";

// ─── Periods (FR-13 tiling lengths) ──────────────────────────────────────────

export type ReportPeriod = "biweekly" | "monthly" | "quarterly";

export const PERIOD_LENGTH_DAYS: Record<ReportPeriod, number> = {
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
};

function isReportPeriod(value: string): value is ReportPeriod {
  return Object.prototype.hasOwnProperty.call(PERIOD_LENGTH_DAYS, value);
}

// ─── Day arithmetic (argful Date only — no wall clock, Article III) ──────────

const DAY_MS = 86_400_000;

/** Renders a UTC epoch-day timestamp back to "YYYY-MM-DD". */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parses a "YYYY-MM-DD"(-prefixed) value to a UTC epoch-day timestamp. Greek
 * RangeError naming the offending flag — this is the operator surface.
 */
function parseDay(value: string, flagLabel: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (match === null) {
    throw new RangeError(
      `Μη έγκυρη ημερομηνία για ${flagLabel}: «${value}» — αναμένεται μορφή YYYY-MM-DD.`,
    );
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * The LAST day (inclusive, "YYYY-MM-DD") of the fixed period containing
 * `asOfDay`, where periods of `periodDays` days tile the calendar from
 * `anchorDay` with no gaps and no overlaps: period k = [anchor + k·P,
 * anchor + (k+1)·P). Two consecutive periods share exactly one boundary
 * instant, so an event on a window edge lands in exactly one window (FR-13).
 * As-of before the anchor tiles backwards (negative k) — still deterministic.
 */
export function fixedPeriodEnd(anchorDay: string, asOfDay: string, periodDays: number): string {
  const anchorMs = parseDay(anchorDay, "--anchor");
  const asOfMs = parseDay(asOfDay, "--as-of");
  const k = Math.floor((asOfMs - anchorMs) / (periodDays * DAY_MS));
  return isoDay(anchorMs + (k + 1) * periodDays * DAY_MS - DAY_MS);
}

// ─── Flag resolution → rendered report ───────────────────────────────────────

export interface ReportFlags {
  builder: string;
  project: string;
  /** Validated here against biweekly|monthly|quarterly (Greek error otherwise). */
  period: string;
  /** Fixed-mode tiling origin; defaults to the project's listed_at. */
  anchor?: string;
  /** Internal mode: last P days ending on as-of instead of the fixed tile. */
  rolling?: boolean;
  /** Reproducibility: compute as if run on this day (default: latest event day, else listed_at). */
  asOf?: string;
  /**
   * T018 — emit the structured insight brief (deterministic JSON raw signals for
   * the human-run /insights step, Article III) instead of the Markdown report.
   * Window selection is identical to the report's.
   */
  brief?: boolean;
}

/**
 * Resolves names → project, picks the window per FR-13, and renders. Throws
 * Greek Error/RangeError for every caller problem; the renderers behind it are
 * total over data (Article VI) and this function adds no numbers of its own —
 * every figure still comes from queries.ts SQL (Article III).
 */
export function renderReport(db: Database, flags: ReportFlags): string {
  if (!isReportPeriod(flags.period)) {
    throw new RangeError(
      `Μη έγκυρη περίοδος «${flags.period}» — επιτρεπτές τιμές: biweekly, monthly, quarterly.`,
    );
  }
  const periodDays = PERIOD_LENGTH_DAYS[flags.period];

  const project = findProject(db, flags.builder, flags.project);
  if (project === null) {
    if (!builderExists(db, flags.builder)) {
      throw new Error(
        `Άγνωστος κατασκευαστής «${flags.builder}» — δεν υπάρχει έργο με αυτόν τον κατασκευαστή.`,
      );
    }
    throw new Error(
      `Άγνωστο έργο «${flags.project}» για τον κατασκευαστή «${flags.builder}».`,
    );
  }

  // Reference day: injected --as-of, else the DATA's latest event day, else
  // listed_at. Validated + normalized to "YYYY-MM-DD" (time parts dropped).
  const asOfRaw = flags.asOf ?? latestEventDay(db, project.id) ?? project.listedAt;
  const asOfDay = isoDay(parseDay(asOfRaw, "--as-of"));

  // Window selection: fixed tile containing as-of (default) or rolling last-P-
  // days. Both renderers compute "the P days ending on asOf" internally, so the
  // fixed tile is selected by handing them the tile's LAST day.
  const anchorDay = isoDay(parseDay(flags.anchor ?? project.listedAt, "--anchor"));
  const effectiveAsOf =
    flags.rolling === true ? asOfDay : fixedPeriodEnd(anchorDay, asOfDay, periodDays);

  if (flags.brief === true) {
    // T018 — same resolved window, structured JSON signals instead of Markdown.
    return renderBrief(db, {
      projectId: project.id,
      asOf: effectiveAsOf,
      periodDays,
      cadence: flags.period,
    });
  }

  if (flags.period === "biweekly") {
    return biweeklyReport(db, { projectId: project.id, asOf: effectiveAsOf });
  }
  return monthlyReport(db, {
    projectId: project.id,
    asOf: effectiveAsOf,
    cadence: flags.period,
  });
}

// ─── CLI entry (bun run report -- …) ─────────────────────────────────────────

const USAGE = `Χρήση: bun run report --builder="Κατασκευαστική Άλφα ΑΕ" --project="Ρετιρέ Κύπρου" \\
       --period=biweekly|monthly|quarterly [--anchor=YYYY-MM-DD] [--rolling] [--as-of=YYYY-MM-DD] [--brief]

Παράγει την αναφορά προόδου πωλήσεων του έργου σε Markdown (ελληνικά) στο stdout.

  --builder    όνομα κατασκευαστή ακριβώς όπως έχει καταχωρηθεί (υποχρεωτικό)
  --project    όνομα έργου ακριβώς όπως έχει καταχωρηθεί (υποχρεωτικό)
  --period     biweekly (14 ημέρες) | monthly (30) | quarterly (90) (υποχρεωτικό)
  --anchor     ημερομηνία αγκύρωσης των σταθερών περιόδων· προεπιλογή: η
               ημερομηνία εισαγωγής του έργου (listed_at)
  --rolling    εσωτερική χρήση: κυλιόμενο παράθυρο τελευταίων Ν ημερών από το
               --as-of (το --anchor αγνοείται)
  --as-of      υπολογισμός σαν να έτρεχε τότε (αναπαραγωγιμότητα)· προεπιλογή:
               η ημέρα του πιο πρόσφατου καταγεγραμμένου γεγονότος του έργου
  --brief      αντί για την αναφορά, εκτύπωση του ντετερμινιστικού insight brief
               (JSON με τα ακατέργαστα σήματα) για το χειροκίνητο βήμα /insights

Ίδια βάση + ίδιες παράμετροι ⇒ πανομοιότυπη έξοδος, byte προς byte (Article III).`;

if (import.meta.main) {
  const { parseArgs } = await import("node:util");

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        builder: { type: "string" },
        project: { type: "string" },
        period: { type: "string" },
        anchor: { type: "string" },
        "as-of": { type: "string" },
        rolling: { type: "boolean", default: false },
        brief: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (e) {
    console.error(
      `Σφάλμα αναφοράς: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`,
    );
    process.exit(1);
  }

  const v = parsed.values as Record<string, string | boolean | undefined>;
  if (v.help === true) {
    console.log(USAGE);
    process.exit(0);
  }
  if (Bun.argv.length <= 2) {
    console.error(USAGE);
    process.exit(1);
  }
  for (const flag of ["builder", "project", "period"] as const) {
    const value = v[flag];
    if (typeof value !== "string" || value.trim().length === 0) {
      console.error(`Σφάλμα αναφοράς: λείπει η υποχρεωτική παράμετρος --${flag}.\n\n${USAGE}`);
      process.exit(1);
    }
  }

  const db = initDb();
  try {
    const report = renderReport(db, {
      builder: (v.builder as string).trim(),
      project: (v.project as string).trim(),
      period: (v.period as string).trim(),
      anchor: v.anchor as string | undefined,
      rolling: v.rolling === true,
      asOf: v["as-of"] as string | undefined,
      brief: v.brief === true,
    });
    process.stdout.write(report);
  } catch (e) {
    console.error(`Σφάλμα αναφοράς: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
