// B0a — RULING 2026-07-14b: office-LAN bind opt-in (CONSTRUCTOR_HOST) + team PIN
// gate (CONSTRUCTOR_PIN). Coverage:
//   1. pure PIN-format helpers (shared by server startup check + web submit gate);
//   2. fail-secure startup: a non-loopback bind without a configured PIN throws
//      naming BOTH env vars — the server can never start exposed without the PIN
//      (insecure-defaults: crash, never run insecure). The PIN value itself never
//      appears in any error.
//   3. no PIN configured (loopback dev default): behavior exactly as today —
//      data routes open, /login dark (404).
//   4. PIN configured: every data route 401s (Greek JSON) without a session;
//      the static shell (GET / + /app.js) stays reachable so the PIN screen can
//      render; POST /login with the wrong PIN → 401 delayed ≥~250ms, no cookie;
//      with the right PIN → HttpOnly session cookie whose token is unrelated to
//      the PIN; the cookie unlocks reads AND writes; forged cookies stay 401.
// Every server test tears down BOTH handles (server.stop(true) + db.close()).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { initDb } from "../src/db/init";
import { makeServer } from "../src/api/server";
import { isValidPinFormat } from "../src/domain/pin";
import { pinSubmittable } from "../src/web/helpers";

const GREEK = /\p{Script=Greek}/u;
const PIN = "482913";

let db: Database;
let server: Server | null = null;
let base = "";

beforeEach(() => {
  db = initDb(":memory:");
});

afterEach(() => {
  server?.stop(true); // force-close — a leaked handle keeps `bun test` alive
  server = null;
  db.close();
});

/** Starts a server on the module-level handle so afterEach always tears it down. */
function start(opts?: { hostname?: string; pin?: string }): Server {
  server = makeServer(db, 0, opts);
  base = `http://127.0.0.1:${server.port}`;
  return server;
}

// ─── Arrangement + HTTP helpers ──────────────────────────────────────────────

function addProject(): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', 'Αύρα', 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`,
  );
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function buyerCount(): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM buyers").get()!.n;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function expectGreekError(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as { error: string };
  expect(typeof body.error).toBe("string");
  expect(body.error).toMatch(GREEK); // FR-11: user-facing errors are Greek
}

/** Logs in with the right PIN and returns the session cookie ("name=token"). */
async function login(): Promise<{ cookie: string; token: string }> {
  const res = await post("/login", { pin: PIN });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /^([^=]+)=([^;]+)/.exec(setCookie);
  expect(m).not.toBeNull();
  return { cookie: `${m![1]}=${m![2]}`, token: m![2]! };
}

const LEAD_BODY = {
  sourceChannel: "spitogatos",
  handledBy: "Χρήστος",
  nextAction: "Τηλεφώνημα για ραντεβού",
};

// ─── 1. Pure PIN-format helpers (headless — no DOM, no server) ───────────────

describe("B0a pin helpers: isValidPinFormat (domain policy: 4-12 digits)", () => {
  test("accepts 4-12 digit PINs", () => {
    expect(isValidPinFormat("4829")).toBe(true);
    expect(isValidPinFormat("482913")).toBe(true);
    expect(isValidPinFormat("123456789012")).toBe(true);
  });

  test("rejects too short, too long, non-digits, blank", () => {
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("1234567890123")).toBe(false);
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("12 34")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
    expect(isValidPinFormat("   ")).toBe(false);
  });
});

describe("B0a pin helpers: pinSubmittable (web submit gate)", () => {
  test("trims padding, then requires a well-formed PIN", () => {
    expect(pinSubmittable(" 4829 ")).toBe(true);
    expect(pinSubmittable("482913")).toBe(true);
  });

  test("blank, short, or non-numeric input can never submit", () => {
    expect(pinSubmittable("")).toBe(false);
    expect(pinSubmittable("   ")).toBe(false);
    expect(pinSubmittable("12")).toBe(false);
    expect(pinSubmittable("abcd")).toBe(false);
  });
});

// ─── 2. Fail-secure startup (insecure-defaults: crash, never run exposed) ────

describe("B0a fail-secure startup", () => {
  test("non-loopback hostname without a PIN throws naming BOTH env vars, no server starts", () => {
    for (const hostname of ["0.0.0.0", "192.168.1.44"]) {
      expect(() => makeServer(db, 0, { hostname })).toThrow(/CONSTRUCTOR_HOST/);
      expect(() => makeServer(db, 0, { hostname })).toThrow(/CONSTRUCTOR_PIN/);
    }
  });

  test("blank/whitespace PIN counts as NOT configured — non-loopback still throws", () => {
    expect(() => makeServer(db, 0, { hostname: "0.0.0.0", pin: "" })).toThrow(/CONSTRUCTOR_PIN/);
    expect(() => makeServer(db, 0, { hostname: "0.0.0.0", pin: "   " })).toThrow(
      /CONSTRUCTOR_PIN/,
    );
  });

  test("malformed PIN throws naming CONSTRUCTOR_PIN and NEVER echoing the value", () => {
    for (const pin of ["123", "abc123XY"]) {
      let thrown: Error | null = null;
      try {
        makeServer(db, 0, { pin });
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown!.message).toContain("CONSTRUCTOR_PIN");
      expect(thrown!.message).not.toContain(pin); // the PIN value never leaks
    }
  });

  test("non-loopback WITH a valid PIN starts (the sanctioned LAN opt-in works)", () => {
    const s = start({ hostname: "0.0.0.0", pin: PIN });
    expect(s.hostname).toBe("0.0.0.0");
  });

  test("loopback names (localhost) need no PIN — dev default unchanged", () => {
    const s = start({ hostname: "localhost" });
    expect(s.port).toBeGreaterThan(0);
  });
});

// ─── 3. No PIN configured: loopback dev behavior exactly as today ────────────

describe("B0a without a PIN (loopback dev default)", () => {
  test("data routes are open with no session and /login stays dark (404)", async () => {
    start();
    const res = await fetch(`${base}/projects`);
    expect(res.status).toBe(200);
    const login = await post("/login", { pin: PIN });
    await expectGreekError(login, 404); // unknown route — the gate is not mounted
  });
});

// ─── 4. PIN configured: session gate over every data route ───────────────────

describe("B0a PIN gate (RULING 2026-07-14b)", () => {
  beforeEach(() => {
    start({ pin: PIN }); // loopback + PIN: gate active even in dev
  });

  test("unauthenticated read → 401 Greek JSON", async () => {
    const projectId = addProject();
    const res = await fetch(`${base}/pipeline?project=${projectId}`);
    await expectGreekError(res, 401);
  });

  test("unauthenticated write → 401 Greek JSON, nothing written", async () => {
    const projectId = addProject();
    const res = await post("/leads", { projectId, ...LEAD_BODY });
    await expectGreekError(res, 401);
    expect(buyerCount()).toBe(0);
  });

  test("static shell stays reachable (the PIN screen ships inside the bundle)", async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type") ?? "").toContain("text/html");
  });

  test("wrong PIN → 401 Greek JSON, no cookie, delayed ≥ ~250ms", async () => {
    const t0 = performance.now();
    const res = await post("/login", { pin: "999999" });
    const elapsed = performance.now() - t0;
    await expectGreekError(res, 401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(240); // ~250ms brute-force brake
  });

  test("missing/non-string pin on /login → 400 Greek JSON, no cookie", async () => {
    for (const body of [{}, { pin: 482913 }]) {
      const res = await post("/login", body);
      await expectGreekError(res, 400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  test("correct PIN → HttpOnly session cookie; token is not the PIN", async () => {
    const res = await post("/login", { pin: PIN });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const token = /=([^;]+)/.exec(setCookie)![1]!;
    expect(token).not.toContain(PIN); // session token unrelated to the PIN
    expect(token.length).toBeGreaterThanOrEqual(16); // crypto-random, not guessable
  });

  test("valid session cookie unlocks reads AND writes", async () => {
    const projectId = addProject();
    const { cookie } = await login();
    const read = await fetch(`${base}/projects`, { headers: { cookie } });
    expect(read.status).toBe(200);
    const write = await post("/leads", { projectId, ...LEAD_BODY }, cookie);
    expect(write.status).toBe(201);
    expect(buyerCount()).toBe(1);
  });

  test("forged/unknown session cookie → 401", async () => {
    await login(); // a real session exists, but we present a different token
    const res = await fetch(`${base}/projects`, {
      headers: { cookie: "constructor_session=forged-token-000" },
    });
    await expectGreekError(res, 401);
  });

  test("two logins mint distinct tokens (one per device/session)", async () => {
    const a = await login();
    const b = await login();
    expect(a.token).not.toBe(b.token);
  });
});

// ─── 5. Client: the PIN screen ships in the served bundle ───────────────────
// T012/T012a convention: interactive tap-through is human phone verification;
// this pins that the served bundle actually carries the Greek PIN gate, wired
// to the shared pinSubmittable predicate and the /login route.

describe("B0a client: PIN gate in the served bundle", () => {
  test("bundle carries the Greek PIN screen, the /login call and the submit predicate", async () => {
    start({ pin: PIN });
    const res = await fetch(`${base}/app.js`); // shell — reachable pre-login
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain("PIN της ομάδας"); // Greek PIN screen chrome
    expect(js).toContain("/login"); // wired to the login route
    expect(js).toContain("pinSubmittable"); // shared submit predicate ships
  });
});
