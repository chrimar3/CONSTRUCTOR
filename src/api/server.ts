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
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { initDb } from "../db/init";
import { OPERATORS, isOperator } from "../domain/operators";
import { isValidPinFormat } from "../domain/pin";
import {
  activityCounters,
  createLead,
  listPipeline,
  listProjects,
  listUnits,
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
  // T012a — FR-6/SC-5: handled_by/next_owner must be one of the three operators.
  operator: `Μη έγκυρος χειριστής — επιτρέπονται μόνο: ${OPERATORS.join(", ")}`,
  notFoundRoute: "Η διαδρομή δεν βρέθηκε",
  notFoundEntity: "Δεν βρέθηκε το έργο, ο αγοραστής ή το ακίνητο",
  internal: "Εσωτερικό σφάλμα",
  field: (name: string) => `Λείπει ή είναι άκυρο το πεδίο: ${name}`,
  // B0a (RULING 2026-07-14b) — team PIN gate messages. Never interpolate the
  // PIN or a session token into any message.
  loginRequired: "Απαιτείται σύνδεση με το PIN της ομάδας",
  pinWrong: "Λάθος PIN",
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

/** T012a — FR-6: the operator on a write must be one of the three (400 otherwise). */
function requireOperator(body: Body, key: string): string {
  const v = requireString(body, key);
  if (!isOperator(v)) throw new ApiError(400, MSG.operator);
  return v;
}

function optionalOperator(body: Body, key: string): string | undefined {
  if (body[key] === undefined || body[key] === null) return undefined;
  return requireOperator(body, key);
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
    handledBy: requireOperator(body, "handledBy"),
    nextAction: requireNextAction(body),
    nextOwner: optionalOperator(body, "nextOwner"),
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
    handledBy: requireOperator(body, "handledBy"),
    nextAction: requireNextAction(body),
    unitId: optionalInt(body, "unitId"),
    nextOwner: optionalOperator(body, "nextOwner"),
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
    handledBy: requireOperator(body, "handledBy"),
    nextAction: requireNextAction(body),
    unitId: optionalInt(body, "unitId"),
    nextOwner: optionalOperator(body, "nextOwner"),
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

// ─── Web client (T012) ───────────────────────────────────────────────────────
// GET / serves src/web/index.html; GET /app.js serves the Bun.build browser
// bundle of src/web/App.tsx (react + domain labels/counter bundled in). The
// bundle is built lazily on first request and cached for the process lifetime —
// `bun run dev` restart picks up App.tsx edits (prototype-adequate, ADR-0022).

const INDEX_HTML = fileURLToPath(new URL("../web/index.html", import.meta.url));
const APP_TSX = fileURLToPath(new URL("../web/App.tsx", import.meta.url));

// B0c (RULING 2026-07-15) — installable home-screen web app: manifest + icons.
// Same static-shell class as GET / and /app.js (ADR-0032): code/branding only,
// never pipeline data, so these routes stay reachable pre-login (iOS fetches
// the manifest and apple-touch-icon without the session cookie at install time).
const PWA_ASSETS: Record<string, { file: string; contentType: string }> = {
  "GET /manifest.webmanifest": {
    file: fileURLToPath(new URL("../web/manifest.webmanifest", import.meta.url)),
    contentType: "application/manifest+json; charset=utf-8",
  },
  "GET /icons/apple-touch-icon.png": {
    file: fileURLToPath(new URL("../web/icons/apple-touch-icon.png", import.meta.url)),
    contentType: "image/png",
  },
  "GET /icons/icon-192.png": {
    file: fileURLToPath(new URL("../web/icons/icon-192.png", import.meta.url)),
    contentType: "image/png",
  },
  "GET /icons/icon-512.png": {
    file: fileURLToPath(new URL("../web/icons/icon-512.png", import.meta.url)),
    contentType: "image/png",
  },
};

function servePwaAsset(route: string): Response | null {
  const asset = PWA_ASSETS[route];
  if (asset === undefined) return null;
  return new Response(Bun.file(asset.file), {
    headers: { "content-type": asset.contentType },
  });
}

let appBundleCache: Promise<string> | null = null;

function appBundle(): Promise<string> {
  appBundleCache ??= (async () => {
    const result = await Bun.build({ entrypoints: [APP_TSX], target: "browser" });
    if (!result.success) {
      appBundleCache = null; // do not cache a failure
      throw new Error(result.logs.map((l) => l.message).join("\n"));
    }
    return result.outputs[0]!.text();
  })();
  return appBundleCache;
}

function serveIndex(): Response {
  return new Response(Bun.file(INDEX_HTML), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function serveAppJs(): Promise<Response> {
  return new Response(await appBundle(), {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  });
}

// ─── B0a — team PIN session gate (RULING 2026-07-14b) ───────────────────────
// When a PIN is configured, every request except POST /login and the static app
// shell (GET / + /app.js — code only, no pipeline data; the PIN screen ships
// inside the bundle) requires a session cookie minted by /login. The PIN and
// the session tokens never appear in any log or error message.

const SESSION_COOKIE = "constructor_session";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const WRONG_PIN_DELAY_MS = 250; // brute-force brake on every failed login

/**
 * Constant-time PIN comparison: both sides are hashed to a fixed length first,
 * so timingSafeEqual applies regardless of input length and neither the length
 * nor the content of the configured PIN leaks through timing.
 */
function pinMatches(expected: string, given: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** Extracts this app's session token from the Cookie header, if present. */
function sessionTokenFrom(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

// ─── Server factory ──────────────────────────────────────────────────────────

export interface ServerAccessOptions {
  /** Bind hostname. Default 127.0.0.1 — loopback-only, the fail-safe default. */
  hostname?: string;
  /**
   * Team PIN (RULING 2026-07-14b). Set → the session gate is active (even on
   * loopback). Unset/blank → loopback dev behavior, exactly as before B0a.
   */
  pin?: string;
}

/**
 * Builds the HTTP API over an injected DB handle. Defaults to port 0 (ephemeral)
 * so tests can run in parallel and MUST call `server.stop(true)` on teardown.
 *
 * FAIL-SECURE (insecure-defaults): a non-loopback bind without a configured PIN
 * throws BEFORE any socket opens — the server can never start exposed without
 * the team PIN. A malformed PIN also refuses startup. Neither error ever
 * contains the PIN value.
 */
export function makeServer(db: Database, port = 0, access: ServerAccessOptions = {}): Server {
  const hostname = access.hostname ?? "127.0.0.1";
  const pin =
    access.pin !== undefined && access.pin.trim() !== "" ? access.pin : null;

  if (pin === null && !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `CONSTRUCTOR_HOST=${hostname} is not loopback and CONSTRUCTOR_PIN is not configured — ` +
        "refusing to start exposed without the team PIN. Set CONSTRUCTOR_PIN (4-12 digits) " +
        "or unset CONSTRUCTOR_HOST (fail-secure, RULING 2026-07-14b).",
    );
  }
  if (pin !== null && !isValidPinFormat(pin)) {
    throw new Error(
      "CONSTRUCTOR_PIN is malformed — it must be 4-12 digits. Refusing to start " +
        "(fail-secure, RULING 2026-07-14b).",
    );
  }

  // Session tokens live in memory only: minted by POST /login, valid for the
  // process lifetime, all gone on restart (re-enter the PIN — acceptable for a
  // 3-operator office LAN; no schema change, per the ruling's constraints).
  const sessions = new Set<string>();

  async function handleLogin(req: Request): Promise<Response> {
    const body = await readBody(req);
    const given = body["pin"];
    if (typeof given !== "string" || pin === null) {
      throw new ApiError(400, MSG.field("pin"));
    }
    if (!pinMatches(pin, given)) {
      await Bun.sleep(WRONG_PIN_DELAY_MS); // same fixed delay for every wrong value
      throw new ApiError(401, MSG.pinWrong);
    }
    const token = randomUUID(); // crypto-random, unrelated to the PIN
    sessions.add(token);
    return Response.json(
      { ok: true },
      {
        status: 200,
        headers: {
          // HttpOnly: page JS never sees the token. SameSite=Strict: sent on
          // same-site requests only. No Secure attribute: B0 is plain HTTP on
          // the office LAN (TLS/hosting is B3 scope) — Secure would drop it.
          "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        },
      },
    );
  }

  return Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      try {
        const route = `${req.method} ${url.pathname}`;
        if (pin !== null) {
          if (route === "POST /login") return await handleLogin(req);
          const isShell =
            route === "GET /" || route === "GET /app.js" || route in PWA_ASSETS;
          if (!isShell) {
            const token = sessionTokenFrom(req);
            if (token === null || !sessions.has(token)) {
              return jsonError(401, MSG.loginRequired);
            }
          }
        }
        switch (route) {
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
          case "GET /projects":
            return Response.json(listProjects(db));
          case "GET /units":
            return Response.json(listUnits(db, requireProjectParam(url)));
          case "GET /":
            return serveIndex();
          case "GET /app.js":
            return await serveAppJs();
          default:
            return servePwaAsset(route) ?? jsonError(404, MSG.notFoundRoute);
        }
      } catch (e) {
        return toErrorResponse(e);
      }
    },
  });
}

// Dev entry point ONLY — nothing else may start a server on import.
// B0a (RULING 2026-07-14b): bind host comes from CONSTRUCTOR_HOST (default
// loopback — the fail-safe). The PIN comes ONLY from CONSTRUCTOR_PIN with NO
// fallback (fail-secure — makeServer refuses a non-loopback bind without it).
// PORT keeps its default: a local dev port is not a secret.
if (import.meta.main) {
  const server = makeServer(initDb(), Number(process.env.PORT ?? 3000), {
    hostname: process.env.CONSTRUCTOR_HOST, // undefined → 127.0.0.1
    pin: process.env.CONSTRUCTOR_PIN, // undefined → no gate (loopback dev only)
  });
  // Host/port only — never the PIN, never a session token.
  console.log(`Constructor API listening on http://${server.hostname}:${server.port}`);
}
