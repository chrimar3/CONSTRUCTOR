/**
 * T008a — Article IV / FR-14: encrypted PII path (buyer_identity).
 *
 * Pins:
 *  - no identity row without recorded consent (saveIdentity records consent itself, ADR-0010),
 *  - AES-256-GCM roundtrip (fresh IV per encryption),
 *  - stored BLOBs never contain the plaintext bytes,
 *  - right-to-erasure: identity row deleted, analytics fully queryable after,
 *  - key missing/malformed → loud English error naming CONSTRUCTOR_PII_KEY,
 *  - PII values never appear in thrown error messages or console output.
 */
import { describe, test, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import { createLead, logViewing, listPipeline, activityCounters } from "../src/db/queries";
import { saveIdentity, readIdentity, eraseIdentity } from "../src/db/identity";

// Fixed 32-byte test key, set via env INSIDE the test file (base64 of 32 bytes).
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_B64;

const TEST_DB = "/tmp/constructor-identity-test.db";

const PII = {
  name: "Μαρία Παπαδοπούλου",
  phone: "+306971234567",
  email: "maria.pap@example.gr",
} as const;
const PII_VALUES: readonly string[] = Object.values(PII);

let db: Database;
let buyerId: number;
let projectId: number;

beforeEach(() => {
  process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_B64; // restore after key-error tests
  if (db) db.close();
  rmSync(TEST_DB, { force: true });
  db = initDb(TEST_DB);
  db.run(
    `INSERT INTO projects (id, builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES (1, 'Δομήσεις ΑΕ', 'Κυψέλη Ένα', 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 10, '2026-01-01')`
  );
  db.run(
    `INSERT INTO units (id, project_id, unit_code, asking_initial, asking_current)
     VALUES (11, 1, 'A1', 250000, 250000)`
  );
  projectId = 1;
  const lead = createLead(db, {
    projectId,
    buyer: { sourceChannel: "referral", segment: "first_home", budgetBand: "250-400k" },
    handledBy: "Χρήστος",
    nextAction: "Τηλέφωνο για ραντεβού",
  });
  buyerId = lead.buyerId;
});

afterEach(() => {
  process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_B64;
});

afterAll(() => {
  db?.close();
  rmSync(TEST_DB, { force: true });
});

function identityCount(): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM buyer_identity").get()!.n;
}

function consentFlag(id: number): number {
  return db.query<{ f: number }, [number]>("SELECT consent_flag AS f FROM buyers WHERE id = ?").get(id)!.f;
}

function rawBlobs(id: number): { name_enc: Uint8Array; phone_enc: Uint8Array; email_enc: Uint8Array } {
  return db
    .query<{ name_enc: Uint8Array; phone_enc: Uint8Array; email_enc: Uint8Array }, [number]>(
      "SELECT name_enc, phone_enc, email_enc FROM buyer_identity WHERE buyer_id = ?"
    )
    .get(id)!;
}

// ------------------------------------------------------------- consent gate

describe("Article IV / FR-14 — no identity row without recorded consent", () => {
  test("saveIdentity throws on missing/blank/non-date consentDate and writes nothing", () => {
    const bads = ["", "   ", "yes", "sometime", undefined as unknown as string];
    for (const bad of bads) {
      expect(() => saveIdentity(db, buyerId, { ...PII }, bad)).toThrow(/consent/i);
    }
    expect(identityCount()).toBe(0);
    expect(consentFlag(buyerId)).toBe(0); // buyers row untouched by refused saves
  });

  test("saveIdentity throws for a nonexistent buyer and writes nothing", () => {
    expect(() => saveIdentity(db, 9999, { ...PII }, "2026-07-13")).toThrow(/buyer/i);
    expect(identityCount()).toBe(0);
  });

  test("a valid saveIdentity records consent: consent_flag=1 and consent_date stored", () => {
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    expect(consentFlag(buyerId)).toBe(1);
    const row = db
      .query<{ consent_date: string }, [number]>(
        "SELECT consent_date FROM buyer_identity WHERE buyer_id = ?"
      )
      .get(buyerId);
    expect(row?.consent_date).toBe("2026-07-13");
    expect(identityCount()).toBe(1);
  });
});

// --------------------------------------------------------------- roundtrip

describe("AES-256-GCM roundtrip", () => {
  test("readIdentity decrypts exactly what saveIdentity stored", () => {
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    const out = readIdentity(db, buyerId);
    expect(out).toEqual({
      buyerId,
      name: PII.name,
      phone: PII.phone,
      email: PII.email,
      consentDate: "2026-07-13",
    });
  });

  test("partial identity: omitted fields come back null", () => {
    saveIdentity(db, buyerId, { phone: PII.phone }, "2026-07-13");
    const out = readIdentity(db, buyerId);
    expect(out).toEqual({ buyerId, name: null, phone: PII.phone, email: null, consentDate: "2026-07-13" });
  });

  test("readIdentity returns null when no identity row exists", () => {
    expect(readIdentity(db, buyerId)).toBeNull();
  });

  test("re-saving updates in place (still exactly one row per buyer)", () => {
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    saveIdentity(db, buyerId, { name: "Νέο Όνομα", phone: PII.phone }, "2026-07-14");
    expect(identityCount()).toBe(1);
    const out = readIdentity(db, buyerId);
    expect(out?.name).toBe("Νέο Όνομα");
    expect(out?.email).toBeNull();
    expect(out?.consentDate).toBe("2026-07-14");
  });
});

// ------------------------------------------------------ ciphertext at rest

describe("Article IV — ciphertext at rest, never plaintext", () => {
  test("stored BLOBs do not contain the input strings' bytes", () => {
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    const blobs = rawBlobs(buyerId);
    const pairs: Array<[Uint8Array, string]> = [
      [blobs.name_enc, PII.name],
      [blobs.phone_enc, PII.phone],
      [blobs.email_enc, PII.email],
    ];
    for (const [blob, plaintext] of pairs) {
      expect(blob).toBeInstanceOf(Uint8Array);
      const stored = Buffer.from(blob);
      expect(stored.includes(Buffer.from(plaintext, "utf8"))).toBe(false);
      expect(stored.toString("utf8")).not.toContain(plaintext);
      // IV(12) + tag(16) + ciphertext — must be longer than the plaintext alone
      expect(stored.length).toBeGreaterThan(Buffer.byteLength(plaintext, "utf8"));
    }
  });

  test("fresh random IV per encryption: same plaintext twice → different blobs", () => {
    saveIdentity(db, buyerId, { name: PII.name }, "2026-07-13");
    const first = Buffer.from(rawBlobs(buyerId).name_enc);
    saveIdentity(db, buyerId, { name: PII.name }, "2026-07-13");
    const second = Buffer.from(rawBlobs(buyerId).name_enc);
    expect(first.equals(second)).toBe(false);
  });
});

// --------------------------------------------------------- right to erasure

describe("FR-14 — right to erasure leaves analytics intact", () => {
  test("eraseIdentity deletes the identity row; pipeline/counters/pool still answer", () => {
    logViewing(db, {
      projectId,
      buyerId,
      unitId: 11,
      interest: 4,
      handledBy: "Λωίδα",
      nextAction: "Στείλε κάτοψη",
    });
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");

    expect(eraseIdentity(db, buyerId)).toBe(true);

    // identity gone
    expect(identityCount()).toBe(0);
    expect(readIdentity(db, buyerId)).toBeNull();
    // consent no longer recorded once identity is erased (ADR-0010)
    expect(consentFlag(buyerId)).toBe(0);

    // analytical rows survive, fully queryable
    const buyer = db
      .query<{ pseudonym: string; segment: string }, [number]>(
        "SELECT pseudonym, segment FROM buyers WHERE id = ?"
      )
      .get(buyerId);
    expect(buyer?.pseudonym).toBe(`#${buyerId}`);
    expect(buyer?.segment).toBe("first_home");

    const board = listPipeline(db, projectId);
    expect(board).toHaveLength(1);
    expect(board[0]!.pseudonym).toBe(`#${buyerId}`);
    expect(board[0]!.temperature).toBe("hot");

    expect(activityCounters(db, projectId)).toEqual({ live: 1, viewings: 1, offers: 0 });

    const pool = db
      .query<{ ready_buyers: number }, []>("SELECT ready_buyers FROM v_buyer_pool")
      .all();
    expect(pool.length).toBeGreaterThan(0);
    expect(pool[0]!.ready_buyers).toBe(1);
  });

  test("erasing a buyer with no identity row returns false and changes nothing", () => {
    expect(eraseIdentity(db, buyerId)).toBe(false);
    expect(db.query("SELECT id FROM buyers WHERE id = ?").get(buyerId)).not.toBeNull();
  });

  test("eraseIdentity works even without the encryption key (key loss ≠ erasure loss)", () => {
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    delete process.env.CONSTRUCTOR_PII_KEY;
    expect(eraseIdentity(db, buyerId)).toBe(true);
    expect(identityCount()).toBe(0);
  });
});

// ----------------------------------------------------------- key handling

describe("CONSTRUCTOR_PII_KEY — fail-secure, loud, named", () => {
  test("missing key: saveIdentity and readIdentity throw naming the env var; nothing written", () => {
    delete process.env.CONSTRUCTOR_PII_KEY;
    expect(() => saveIdentity(db, buyerId, { ...PII }, "2026-07-13")).toThrow(/CONSTRUCTOR_PII_KEY/);
    expect(identityCount()).toBe(0);
    expect(() => readIdentity(db, buyerId)).toThrow(/CONSTRUCTOR_PII_KEY/);
  });

  test("malformed keys throw naming the env var", () => {
    const malformed = [
      "short",
      Buffer.alloc(16, 1).toString("base64"), // 16 bytes, not 32
      "z".repeat(64), // 64 chars but not hex, not valid-length base64 payload
      Buffer.alloc(33, 1).toString("base64"), // 33 bytes
    ];
    for (const bad of malformed) {
      process.env.CONSTRUCTOR_PII_KEY = bad;
      expect(() => saveIdentity(db, buyerId, { ...PII }, "2026-07-13")).toThrow(/CONSTRUCTOR_PII_KEY/);
    }
    expect(identityCount()).toBe(0);
  });

  test("hex form of the key is accepted and interoperable with base64 form", () => {
    saveIdentity(db, buyerId, { name: PII.name }, "2026-07-13");
    process.env.CONSTRUCTOR_PII_KEY = Buffer.alloc(32, 7).toString("hex"); // same 32 bytes as hex
    expect(readIdentity(db, buyerId)?.name).toBe(PII.name);
  });
});

// --------------------------------------------------- PII never leaks out

describe("Article IV — PII values never in error messages or console output", () => {
  test("all error paths: thrown messages contain no PII; console stays PII-free", () => {
    const logSpy = spyOn(console, "log");
    const errSpy = spyOn(console, "error");
    const warnSpy = spyOn(console, "warn");
    const messages: string[] = [];

    const attempts: Array<() => void> = [
      () => saveIdentity(db, buyerId, { ...PII }, ""), // consent refusal
      () => saveIdentity(db, 9999, { ...PII }, "2026-07-13"), // unknown buyer
      () => {
        delete process.env.CONSTRUCTOR_PII_KEY; // missing key
        saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
      },
      () => {
        process.env.CONSTRUCTOR_PII_KEY = "not-a-key"; // malformed key
        saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
      },
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        throw new Error("expected attempt to throw");
      } catch (e) {
        messages.push(String((e as Error).message));
      }
    }

    // happy path emits no console output either
    process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_B64;
    saveIdentity(db, buyerId, { ...PII }, "2026-07-13");
    readIdentity(db, buyerId);
    eraseIdentity(db, buyerId);

    const consoleText = [logSpy, errSpy, warnSpy]
      .flatMap((s) => s.mock.calls.flat())
      .map(String)
      .join("\n");
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();

    for (const pii of PII_VALUES) {
      for (const msg of messages) expect(msg).not.toContain(pii);
      expect(consoleText).not.toContain(pii);
    }
  });
});
