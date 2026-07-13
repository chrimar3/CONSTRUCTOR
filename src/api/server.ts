// T009 — thin Bun.serve HTTP boundary over src/db/queries.ts (CLAUDE.md design:
// "API thin validator"). This file validates request SHAPE/TYPES only and delegates
// every decision to queries.ts / the domain layer — NO business logic here.
// Error contract (ADR-0017): JSON `{ error: string }` with a GREEK message (FR-11).
//   400 = malformed request (bad JSON, missing/mistyped field, blank next_action,
//         out-of-range domain value, PII-shaped key — Article IV at the boundary)
//   404 = unknown route/method, or a referenced entity that does not exist
//         (SQLite FK violation surfaced by the queries layer)
//   500 = anything else (never leaks internals).

import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { initDb } from "../db/init";
import {
  activityCounters,
  createLead,
  listPipeline,
  logOffer,
  logViewing,
} from "../db/queries";

// ─── Error contract ──────────────────────────────────────────────────────────

/** Boundary rejection: carries the HTTP status + the Greek user-facing message. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    greekMessage: string,
  ) {
    super(greekMessage);
  }
}

const MSG = {
  badJson: "Μη έγκυρο σώμα αιτήματος — αναμένεται JSON αντικείμενο",
  nextAction: "Απαιτείται επόμενη ενέργεια", // Article II at the boundary
  interestRequired: "Απαιτείται βαθμός ενδιαφέροντος (ακέραιος 1–5)",
  amountInvalid: "Απαιτείται έγκυρο ποσό προσφοράς (θετικός ακέραιος €)",
  pii: "Προσωπικά στοιχεία δεν γίνονται δεκτά σε αυτό το αίτημα", // Article IV
  projectParam: "Απαιτείται έγκυρη παράμετρος project (ακέραιος)",
  notFoundRoute: "Η διαδρομή δεν βρέθηκε",
  notFoundEntity: "Δεν βρέθηκε το έργο, ο αγοραστής ή το ακίνητο",
  internal: "Εσωτερικό σφάλμα",
  field: (name: string) => `Λείπει ή είναι άκυρο το πεδίο: ${name}`,
} as const;

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Maps anything thrown below the boundary to the error contract above. */
function toErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) return jsonError(e.status, e.message);
  if (e instanceof Error) {
    // Backstop for the queries-layer guards (boundary checks should fire first).
    if (e.message.startsWith("Article II")) return jsonError(400, MSG.nextAction);
    if (e.message.startsWith("Article IV")) return jsonError(400, MSG.pii);
    // Referenced project/buyer/unit does not exist — schema FK enforcement.
    if (e.message.includes("FOREIGN KEY constraint failed")) {
      return jsonError(404, MSG.notFoundEntity);
    }
  }
  return jsonError(500, MSG.internal);
}

// ─── Shape/type validation (boundary only — no business rules) ──────────────

type Body = Record<string, unknown>;

/** Mirrors the queries-layer Article IV guard so PII is refused AT the boundary. */
const PII_KEY = /(name|phone|email|mail|tel)/i;

async function readBody(req: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new ApiError(400, MSG.badJson);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, MSG.badJson);
  }
  const body = parsed as Body;
  for (const key of Object.keys(body)) {
    if (PII_KEY.test(key)) throw new ApiError(400, MSG.pii);
  }
  return body;
}

function requireInt(body: Body, key: string): number {
  const v = body[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ApiError(400, MSG.field(key));
  }
  return v;
}

function optionalInt(body: Body, key: string): number | undefined {
  if (body[key] === undefined || body[key] === null) return undefined;
  return requireInt(body, key);
}

function requireString(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ApiError(400, MSG.field(key));
  }
  return v;
}

function optionalString(body: Body, key: string): string | undefined {
  if (body[key] === undefined || body[key] === null) return undefined;
  return requireString(body, key);
}

/** Article II shape check with its own Greek message (queries guard is the backstop). */
function requireNextAction(body: Body): string {
  const v = body["nextAction"];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ApiError(400, MSG.nextAction);
  }
  return v;
}

function requireProjectParam(url: URL): number {
  const raw = url.searchParams.get("project");
  if (raw === null || raw.trim() === "" || !/^\d+$/.test(raw.trim())) {
    throw new ApiError(400, MSG.projectParam);
  }
  return Number(raw);
}

/** Re-throws a domain RangeError (loud capture-path validation) as a Greek 400. */
function domainValidated<T>(fn: () => T, greekMessage: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) throw new ApiError(400, greekMessage);
    throw e;
  }
}

// ─── Handlers (validate shape → delegate to queries.ts) ─────────────────────

async function handleLead(db: Database, req: Request): Promise<Response> {
  const body = await readBody(req);
  const result = createLead(db, {
    projectId: requireInt(body, "projectId"),
    sourceChannel: requireString(body, "sourceChannel"),
    handledBy: requireString(body, "handledBy"),
    nextAction: requireNextAction(body),
    nextOwner: optionalString(body, "nextOwner"),
    segment: optionalString(body, "segment"),
    budgetBand: optionalString(body, "budgetBand"),
    financing: optionalString(body, "financing"),
    areaPref: optionalString(body, "areaPref"),
    focusUnitId: optionalInt(body, "focusUnitId"),
    note: optionalString(body, "note"),
  });
  return Response.json(result, { status: 201 });
}

async function handleViewing(db: Database, req: Request): Promise<Response> {
  const body = await readBody(req);
  if (body["interest"] === undefined || body["interest"] === null) {
    throw new ApiError(400, MSG.interestRequired);
  }
  const input = {
    projectId: requireInt(body, "projectId"),
    buyerId: requireInt(body, "buyerId"),
    interest: requireInt(body, "interest"),
    handledBy: requireString(body, "handledBy"),
    nextAction: requireNextAction(body),
    unitId: optionalInt(body, "unitId"),
    nextOwner: optionalString(body, "nextOwner"),
    note: optionalString(body, "note"),
  };
  // interest range (1..5) is owned by the domain layer — map its RangeError to 400.
  const result = domainValidated(() => logViewing(db, input), MSG.interestRequired);
  return Response.json(result, { status: 201 });
}

async function handleOffer(db: Database, req: Request): Promise<Response> {
  const body = await readBody(req);
  if (body["amount"] === undefined || body["amount"] === null) {
    throw new ApiError(400, MSG.amountInvalid);
  }
  const input = {
    projectId: requireInt(body, "projectId"),
    buyerId: requireInt(body, "buyerId"),
    amount: requireInt(body, "amount"),
    handledBy: requireString(body, "handledBy"),
    nextAction: requireNextAction(body),
    unitId: optionalInt(body, "unitId"),
    nextOwner: optionalString(body, "nextOwner"),
    note: optionalString(body, "note"),
  };
  // amount positivity is owned by the queries layer — map its RangeError to 400.
  const result = domainValidated(() => logOffer(db, input), MSG.amountInvalid);
  return Response.json(result, { status: 201 });
}

function handlePipeline(db: Database, url: URL): Response {
  return Response.json(listPipeline(db, requireProjectParam(url)));
}

function handleCounters(db: Database, url: URL): Response {
  return Response.json(activityCounters(db, requireProjectParam(url)));
}

// ─── Server factory ──────────────────────────────────────────────────────────

/**
 * Builds the HTTP API over an injected DB handle. Defaults to port 0 (ephemeral)
 * so tests can run in parallel and MUST call `server.stop(true)` on teardown.
 */
export function makeServer(db: Database, port = 0): Server {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      try {
        switch (`${req.method} ${url.pathname}`) {
          case "POST /leads":
            return await handleLead(db, req);
          case "POST /viewings":
            return await handleViewing(db, req);
          case "POST /offers":
            return await handleOffer(db, req);
          case "GET /pipeline":
            return handlePipeline(db, url);
          case "GET /counters":
            return handleCounters(db, url);
          default:
            return jsonError(404, MSG.notFoundRoute);
        }
      } catch (e) {
        return toErrorResponse(e);
      }
    },
  });
}

// Dev entry point ONLY — nothing else may start a server on import.
if (import.meta.main) {
  const server = makeServer(initDb(), Number(process.env.PORT ?? 3000));
  console.log(`Constructor API listening on http://127.0.0.1:${server.port}`);
}
