// T018 — structured insight brief: the RAW SIGNALS a human feeds to the
// interactive /insights step (.claude/commands/insights.md). Article III: the
// app NEVER calls an LLM — this module emits deterministic JSON computed from
// queries.ts/comps.ts SQL only; the 2–3 Greek insight sentences are written by
// the operator running /insights under Max and pasted into the report. No AI
// step blocks anything: the Markdown report is complete without this brief.
//
// Signals (task brief): cold units (zero in-window offers, with viewing counts
// and the verbatim data-derived recommendation() so no bad signal travels
// naked), activity deltas vs the adjacent previous fixed period, and
// offers-vs-asking gaps (latest in-window offer below asking → € gap + percent
// below). JSON keys are English camelCase like the HTTP API (ADR-0017) — this
// is an operator/tooling data surface, not the builder-facing Greek report;
// the Greek prose inside it (recommendations) comes from src/domain/recommend.
//
// Article III determinism: as-of is INJECTED (no wall clock — Gate 4 greps this
// directory), numbers are integers/one-decimal rounded arithmetic (no ICU), and
// object construction order is fixed, so JSON.stringify is byte-stable: same DB
// + same options ⇒ identical output.
//
// Error contract (matches the renderers): total over data; only CALLER errors
// throw — unparseable as-of (RangeError), unknown project (Error).

import type { Database } from "bun:sqlite";
import { recommendation } from "../domain/recommend";
import { activityInWindow, getProject, unitActivityInWindow } from "../db/queries";
import { compsForMicroArea } from "../db/comps";
import { compsBasedTarget, monthlyWindow, previousWindow } from "./monthly";

// ─── Brief shape ─────────────────────────────────────────────────────────────

export interface BriefOfferGap {
  /** askingCurrent − latest in-window offer, in € (only present when positive). */
  amount: number;
  /** Percent the latest offer sits below asking, rounded to one decimal. */
  pctBelowAsking: number;
}

export interface BriefUnit {
  unitCode: string;
  askingCurrent: number;
  viewings: number;
  offers: number;
  /** LATEST in-window offer by event id (the live position, ADR-0013), else null. */
  latestOfferAmount: number | null;
  /** Latest offer below asking → € gap + % below; null when no offer or at/above asking. */
  offerGap: BriefOfferGap | null;
  /** Median-€/m² comps target (T016 formula), null when indefensible (no sqm/comps). */
  compsTarget: number | null;
  /** Cold = zero offers in the window (the signal the mandate conversation is about). */
  cold: boolean;
  /** Verbatim deterministic recommendation() output for this unit's signals. */
  recommendation: string;
}

export interface InsightBrief {
  project: { builderName: string; projectName: string; microArea: string };
  period: { cadence: string; start: string; end: string; days: number };
  totals: { inquiries: number; viewings: number; offers: number };
  previousPeriod: {
    start: string;
    end: string;
    inquiries: number;
    viewings: number;
    offers: number;
  };
  /** current − previous, signed (negative = slowdown). */
  deltas: { inquiries: number; viewings: number; offers: number };
  /** Active inventory only (status ≠ sold/withdrawn), unit_code order. */
  units: BriefUnit[];
  /** Convenience list: unitCodes of the cold units, in units[] order. */
  coldUnits: string[];
  /** Comparables in the micro-area merge — 0 tells the AI step comps are absent. */
  compsCount: number;
}

export interface InsightBriefOptions {
  projectId: number;
  /** Injected reference date — the window's LAST day (never the wall clock). */
  asOf: string;
  /** Window length in days (14 / 30 / 90 — matches the report cadences). */
  periodDays: number;
  /** CLI period vocabulary ("biweekly" | "monthly" | "quarterly") echoed back. */
  cadence: string;
}

// ─── Brief builder ───────────────────────────────────────────────────────────

export function insightBrief(db: Database, options: InsightBriefOptions): InsightBrief {
  const window = monthlyWindow(options.asOf, options.periodDays);
  const prev = previousWindow(window);
  const project = getProject(db, options.projectId);
  if (project === null) {
    throw new Error(`project ${options.projectId} not found`);
  }

  const totals = activityInWindow(db, project.id, window.start, window.endExclusive);
  const prevTotals = activityInWindow(db, project.id, prev.start, prev.endExclusive);
  const allUnits = unitActivityInWindow(db, project.id, window.start, window.endExclusive);
  const comps = compsForMicroArea(db, project.microArea);

  const units: BriefUnit[] = allUnits
    .filter((u) => u.status !== "sold" && u.status !== "withdrawn")
    .map((u) => {
      const compsTarget = compsBasedTarget(comps, u.sqm);
      const hasGap =
        u.latestOfferAmount !== null &&
        u.askingCurrent > 0 &&
        u.latestOfferAmount < u.askingCurrent;
      const gapAmount = hasGap ? u.askingCurrent - (u.latestOfferAmount as number) : 0;
      return {
        unitCode: u.unitCode,
        askingCurrent: u.askingCurrent,
        viewings: u.viewings,
        offers: u.offers,
        latestOfferAmount: u.latestOfferAmount,
        offerGap: hasGap
          ? {
              amount: gapAmount,
              // One-decimal percent via integer rounding — no ICU (Article III).
              pctBelowAsking: Math.round((gapAmount / u.askingCurrent) * 1000) / 10,
            }
          : null,
        compsTarget,
        cold: u.offers === 0,
        recommendation: recommendation({ viewings: u.viewings, offers: u.offers, compsTarget }),
      };
    });

  return {
    project: {
      builderName: project.builderName,
      projectName: project.projectName,
      microArea: project.microArea,
    },
    period: {
      cadence: options.cadence,
      start: window.start,
      end: window.end,
      days: options.periodDays,
    },
    totals,
    previousPeriod: { start: prev.start, end: prev.end, ...prevTotals },
    deltas: {
      inquiries: totals.inquiries - prevTotals.inquiries,
      viewings: totals.viewings - prevTotals.viewings,
      offers: totals.offers - prevTotals.offers,
    },
    units,
    coldUnits: units.filter((u) => u.cold).map((u) => u.unitCode),
    compsCount: comps.length,
  };
}

/** Serialized brief: fixed key order + 2-space indent ⇒ byte-stable output. */
export function renderBrief(db: Database, options: InsightBriefOptions): string {
  return `${JSON.stringify(insightBrief(db, options), null, 2)}\n`;
}
