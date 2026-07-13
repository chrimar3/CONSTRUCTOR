// T008a — Article IV / FR-14: encrypted buyer identity (src/db/identity.ts).
// AES-256-GCM via node:crypto; key ONLY from env CONSTRUCTOR_PII_KEY (fail-secure:
// missing/malformed key crashes loudly naming the var — never a fallback default).
// saveIdentity records consent atomically (no identity row without recorded consent);
// eraseIdentity implements right-to-erasure and needs NO key; analytics stay fully
// queryable after erasure. PII must never appear in any error message.
// Fixed test key is set via env IN THIS FILE — never a production key.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/init";
import {
  activityCounters,
  createLead,
  listPipeline,
  logOffer,
  logViewing,
} from "../src/db/queries";
import { eraseIdentity, readIdentity, saveIdentity } from "../src/db/identity";

// ─── Fixed test key (32 bytes) — set via env, as the task requires ──────────
// base64 of the ASCII bytes "0123456789abcdef0123456789abcdef" (32 bytes).
const TEST_KEY_B64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const TEST_KEY_HEX = Buffer.from(TEST_KEY_B64, "base64").toString("hex");
// A DIFFERENT valid 32-byte key (for wrong-key decryption tests).
const OTHER_KEY_B64 = Buffer.alloc(32, 9).toString("base64");

const PII = {
  name: "Γιάννης Παπαδόπουλος",
  phone: "+306941234567",
  email: "giannis.pii@example.com",
};
const CONSENT = "2026-07-13";

let db: Database;

beforeEach(() => {
  db = initDb(":memory:");
  process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_B64;
});

afterAll(() => {
  delete process.env.CONSTRUCTOR_PII_KEY;
});

function addProject(name = "Αύρα"): number {
  db.run(
    `INSERT INTO projects (builder_name, project_name, area, micro_area, total_units, listed_at)
     VALUES ('Δομική ΑΕ', ?, 'Κυψέλη', 'Πλατεία Κύπρου, block Α', 12, '2026-07-01')`,
    [name],
  );
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

function lead(projectId: number) {
  return createLead(db, {
    projectId,
    sourceChannel: "spitogatos",
    handledBy: "Χρήστος",
    nextAction: "Τηλεφώνημα για ραντεβού",
    segment: "first_home",
    areaPref: "Κυψέλη",
    budgetBand: "250-400k",
  });
}

function identityRow(buyerId: number) {
  return db
    .query("SELECT * FROM buyer_identity WHERE buyer_id = ?")
    .get(buyerId) as {
    buyer_id: number;
    name_enc: Uint8Array | null;
    phone_enc: Uint8Array | null;
    email_enc: Uint8Array | null;
    consent_date: string | null;
  } | null;
}

function consentFlag(buyerId: number): number {
  return db
    .query<{ consent_flag: number }, [number]>(
      "SELECT consent_flag FROM buyers WHERE id = ?",
    )
    .get(buyerId)!.consent_flag;
}

/** Runs fn, asserts it throws, and returns the error message for inspection. */
function messageOf(fn: () => unknown): string {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  return String(err);
}

/** Article IV: no error surface may carry the PII values. */
function expectNoPii(message: string): void {
  expect(message).not.toContain(PII.name);
  expect(message).not.toContain(PII.phone);
  expect(message).not.toContain(PII.email);
  expect(message).not.toContain("Γιάννης"); // no fragment either
}

// ─── Fail-secure key handling (insecure-defaults: crash, never a fallback) ──

describe("CONSTRUCTOR_PII_KEY fail-secure handling", () => {
  test("missing key: saveIdentity crashes loudly naming the var and writes NOTHING", () => {
    const projectId = addProject();
    const r = lead(projectId);
    delete process.env.CONSTRUCTOR_PII_KEY;

    const msg = messageOf(() =>
      saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT }),
    );
    expect(msg).toContain("CONSTRUCTOR_PII_KEY");
    expectNoPii(msg);
    expect(identityRow(r.buyerId)).toBeNull();
    expect(consentFlag(r.buyerId)).toBe(0);
  });

  test("missing key: readIdentity crashes naming the var (even before any row lookup)", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    delete process.env.CONSTRUCTOR_PII_KEY;
    expect(() => readIdentity(db, r.buyerId)).toThrow(/CONSTRUCTOR_PII_KEY/);
  });

  test("blank key counts as missing", () => {
    const projectId = addProject();
    const r = lead(projectId);
    process.env.CONSTRUCTOR_PII_KEY = "   ";
    expect(() =>
      saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT }),
    ).toThrow(/CONSTRUCTOR_PII_KEY/);
  });

  test("malformed keys (wrong length / wrong alphabet) crash naming the var — never accepted", () => {
    const projectId = addProject();
    const r = lead(projectId);
    const malformed = [
      "short",
      "MDEyMzQ1Njc4OWFiY2RlZg==", // base64 of 16 bytes — too short
      TEST_KEY_HEX.slice(0, 63), // 63 hex chars — one short
      "z".repeat(64), // 64 chars but not hex, not base64-of-32
      TEST_KEY_B64 + "=", // corrupted padding
    ];
    for (const bad of malformed) {
      process.env.CONSTRUCTOR_PII_KEY = bad;
      const msg = messageOf(() =>
        saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT }),
      );
      expect(msg).toContain("CONSTRUCTOR_PII_KEY");
      expectNoPii(msg);
    }
    expect(identityRow(r.buyerId)).toBeNull();
  });

  test("hex encoding (64 chars, either case) is accepted and interoperable with base64 of the same bytes", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT }); // written under base64 key
    process.env.CONSTRUCTOR_PII_KEY = TEST_KEY_HEX.toUpperCase(); // same 32 bytes, hex
    expect(readIdentity(db, r.buyerId)!.name).toBe(PII.name);
  });
});

// ─── Consent gate (FR-14: no identity row without recorded consent) ─────────

describe("consent gate (FR-14)", () => {
  test("saveIdentity REFUSES without a consent date: throws, writes no row, consent_flag stays 0", () => {
    const projectId = addProject();
    const r = lead(projectId);
    for (const bad of [undefined, "", "   ", "not-a-date", "13/07/2026"]) {
      const msg = messageOf(() =>
        saveIdentity(db, {
          buyerId: r.buyerId,
          ...PII,
          consentDate: bad as unknown as string,
        }),
      );
      expect(msg).toMatch(/consent/i);
      expectNoPii(msg);
    }
    expect(identityRow(r.buyerId)).toBeNull();
    expect(consentFlag(r.buyerId)).toBe(0);
  });

  test("successful save records consent atomically: consent_flag = 1 and consent_date stored", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    expect(consentFlag(r.buyerId)).toBe(1);
    expect(identityRow(r.buyerId)!.consent_date).toBe(CONSENT);
  });

  test("unknown buyer: refuses (no orphan identity), message carries only the id", () => {
    const msg = messageOf(() =>
      saveIdentity(db, { buyerId: 9999, ...PII, consentDate: CONSENT }),
    );
    expect(msg).toContain("9999");
    expectNoPii(msg);
    expect(identityRow(9999)).toBeNull();
  });

  test("identity with no field at all is refused (nothing to consent to)", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(() =>
      saveIdentity(db, { buyerId: r.buyerId, consentDate: CONSENT }),
    ).toThrow(/name|phone|email|field/i);
    expect(identityRow(r.buyerId)).toBeNull();
  });
});

// ─── Roundtrip ───────────────────────────────────────────────────────────────

describe("encrypt/decrypt roundtrip", () => {
  test("save → read returns the exact Greek PII and consent date", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    expect(readIdentity(db, r.buyerId)).toEqual({
      buyerId: r.buyerId,
      name: PII.name,
      phone: PII.phone,
      email: PII.email,
      consentDate: CONSENT,
    });
  });

  test("partial identity: absent fields stay NULL and read back as null", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, phone: PII.phone, consentDate: CONSENT });
    const row = identityRow(r.buyerId)!;
    expect(row.name_enc).toBeNull();
    expect(row.email_enc).toBeNull();
    const id = readIdentity(db, r.buyerId)!;
    expect(id.name).toBeNull();
    expect(id.phone).toBe(PII.phone);
    expect(id.email).toBeNull();
  });

  test("re-save upserts: values and consent date are replaced, still one row", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    saveIdentity(db, {
      buyerId: r.buyerId,
      name: "Μαρία Οικονόμου",
      consentDate: "2026-07-14",
    });
    const n = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM buyer_identity")
      .get()!.n;
    expect(n).toBe(1);
    const id = readIdentity(db, r.buyerId)!;
    expect(id.name).toBe("Μαρία Οικονόμου");
    expect(id.phone).toBeNull(); // full replace, not merge — no stale PII left behind
    expect(id.consentDate).toBe("2026-07-14");
  });

  test("readIdentity of a buyer without an identity row returns null", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(readIdentity(db, r.buyerId)).toBeNull();
  });
});

// ─── Encryption at rest ──────────────────────────────────────────────────────

describe("encryption at rest (AES-256-GCM)", () => {
  test("stored BLOBs do NOT contain the plaintext bytes", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    const row = identityRow(r.buyerId)!;
    const checks: Array<[Uint8Array | null, string]> = [
      [row.name_enc, PII.name],
      [row.phone_enc, PII.phone],
      [row.email_enc, PII.email],
    ];
    for (const [blob, plaintext] of checks) {
      expect(blob).not.toBeNull();
      const buf = Buffer.from(blob!);
      expect(buf.includes(Buffer.from(plaintext, "utf8"))).toBe(false);
      // GCM blob = version + IV(12) + tag(16) + ciphertext — always longer than plaintext.
      expect(buf.length).toBeGreaterThan(Buffer.byteLength(plaintext, "utf8"));
    }
  });

  test("fresh random IV per encryption: identical plaintext encrypts to different blobs", () => {
    const projectId = addProject();
    const a = lead(projectId);
    const b = lead(projectId);
    saveIdentity(db, { buyerId: a.buyerId, ...PII, consentDate: CONSENT });
    saveIdentity(db, { buyerId: b.buyerId, ...PII, consentDate: CONSENT });
    const blobA = Buffer.from(identityRow(a.buyerId)!.name_enc!);
    const blobB = Buffer.from(identityRow(b.buyerId)!.name_enc!);
    expect(blobA.equals(blobB)).toBe(false);
  });

  test("tampered ciphertext fails authentication (GCM) — error carries no PII", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    const tampered = Buffer.from(identityRow(r.buyerId)!.name_enc!);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 0xff; // flip a ciphertext byte
    db.run("UPDATE buyer_identity SET name_enc = ? WHERE buyer_id = ?", [
      tampered,
      r.buyerId,
    ]);
    const msg = messageOf(() => readIdentity(db, r.buyerId));
    expectNoPii(msg);
  });

  test("decryption under a DIFFERENT valid key fails — error carries no PII", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    process.env.CONSTRUCTOR_PII_KEY = OTHER_KEY_B64;
    const msg = messageOf(() => readIdentity(db, r.buyerId));
    expectNoPii(msg);
  });
});

// ─── Right-to-erasure (Article IV / FR-14) ───────────────────────────────────

describe("right-to-erasure", () => {
  test("eraseIdentity deletes the identity row; buyers/opportunities/events stay fully queryable", () => {
    const projectId = addProject();
    const r = lead(projectId);
    logViewing(db, {
      projectId,
      buyerId: r.buyerId,
      interest: 4,
      handledBy: "Λωίδα",
      nextAction: "Πρόταση για προσφορά",
    });
    logOffer(db, {
      projectId,
      buyerId: r.buyerId,
      amount: 240000,
      handledBy: "Χρήστος",
      nextAction: "Αντιπρόταση €245.000",
    });
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });

    expect(eraseIdentity(db, r.buyerId)).toBe(true);

    // Identity is GONE …
    expect(identityRow(r.buyerId)).toBeNull();
    expect(readIdentity(db, r.buyerId)).toBeNull();
    // … consent no longer claimed for identity that no longer exists …
    expect(consentFlag(r.buyerId)).toBe(0);
    // … and the analytical moat is fully intact and de-identified (prove it):
    const buyer = db
      .query("SELECT * FROM buyers WHERE id = ?")
      .get(r.buyerId) as Record<string, unknown>;
    expect(buyer.pseudonym).toBe(`#${r.buyerId}`);
    expect(buyer.segment).toBe("first_home");

    const cards = listPipeline(db, projectId);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.pseudonym).toBe(`#${r.buyerId}`);
    expect(cards[0]!.offerAmount).toBe(240000);

    expect(activityCounters(db, projectId)).toEqual({
      inquiries: 1,
      viewings: 1,
      offers: 1,
      liveOpportunities: 1,
    });

    const pool = db
      .query("SELECT * FROM v_buyer_pool")
      .all() as Array<Record<string, unknown>>;
    expect(pool).toEqual([
      {
        segment: "first_home",
        area_pref: "Κυψέλη",
        budget_band: "250-400k",
        ready_buyers: 1,
      },
    ]);
  });

  test("eraseIdentity needs NO encryption key — key loss can never block a GDPR erasure", () => {
    const projectId = addProject();
    const r = lead(projectId);
    saveIdentity(db, { buyerId: r.buyerId, ...PII, consentDate: CONSENT });
    delete process.env.CONSTRUCTOR_PII_KEY;
    expect(eraseIdentity(db, r.buyerId)).toBe(true);
    expect(identityRow(r.buyerId)).toBeNull();
  });

  test("erasing a buyer with no identity row is a safe no-op returning false", () => {
    const projectId = addProject();
    const r = lead(projectId);
    expect(eraseIdentity(db, r.buyerId)).toBe(false);
    expect(consentFlag(r.buyerId)).toBe(0);
  });
});
