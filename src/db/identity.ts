/**
 * Encrypted PII path — the ONLY code that touches buyer_identity (Article IV).
 *
 * - AES-256-GCM via node:crypto (Bun built-in; no new deps).
 * - Key from env var CONSTRUCTOR_PII_KEY: exactly 32 bytes, encoded as
 *   base64 (44 chars) or hex (64 chars). Generate: `openssl rand -base64 32`.
 *   Missing/malformed key = throw (fail-secure; NEVER a fallback key — a
 *   fail-open default is the exact Article IV failure mode). The key value
 *   itself is never echoed in errors.
 * - BLOB layout per field: [12-byte IV][16-byte GCM auth tag][ciphertext].
 *   Fresh random IV per encryption.
 * - Consent semantic (ADR-0010): saveIdentity RECORDS consent itself — it
 *   requires a consent date and atomically sets buyers.consent_flag = 1 with
 *   the identity upsert. No identity row without recorded consent (FR-14).
 *   eraseIdentity deletes the row AND resets consent_flag to 0 (erasure =
 *   consent withdrawal); it needs no key, so key loss can never block erasure.
 * - PII values NEVER appear in error messages or logs (Article IV). Errors
 *   here are operator-facing dev/CLI errors, in English like the rest of the
 *   query layer; the API boundary (T009) owns Greek product-surface messages.
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { Database } from "bun:sqlite";

const ENV_VAR = "CONSTRUCTOR_PII_KEY";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

export interface IdentityInput {
  name?: string;
  phone?: string;
  email?: string;
}

export interface IdentityRecord {
  buyerId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  consentDate: string;
}

// ------------------------------------------------------------------ key ---

/** Fail-secure key load: throws (naming the env var) rather than defaulting. */
function loadKey(): Buffer {
  const raw = process.env[ENV_VAR];
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `${ENV_VAR} is not set — the PII path refuses to run without it (Article IV). ` +
        `Set a 32-byte key, base64 or hex encoded. Generate one: openssl rand -base64 32`
    );
  }
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const key = Buffer.from(value, "base64");
    if (key.length === KEY_LEN) return key;
  }
  throw new Error(
    `${ENV_VAR} is malformed — expected exactly 32 bytes encoded as base64 (44 chars) ` +
      `or hex (64 chars). Generate one: openssl rand -base64 32`
  );
}

// --------------------------------------------------------------- crypto ---

/** Encrypts one field → BLOB [IV(12) | auth tag(16) | ciphertext]. */
function encryptField(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Decrypts one BLOB; GCM auth failure or truncation throws (no PII in message). */
function decryptField(key: Buffer, blob: Uint8Array): string {
  const buf = Buffer.from(blob);
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("buyer_identity blob is truncated — cannot decrypt");
  }
  const decipher = createDecipheriv(ALGO, key, buf.subarray(0, IV_LEN));
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString(
    "utf8"
  );
}

// ------------------------------------------------------------------ API ---

/**
 * Stores (or replaces) a buyer's encrypted identity, RECORDING consent in the
 * same transaction (ADR-0010): a valid ISO consent date is mandatory and
 * buyers.consent_flag is set to 1 atomically with the identity upsert.
 * Throws before any write on missing consent, unknown buyer, or bad key.
 */
export function saveIdentity(
  db: Database,
  buyerId: number,
  identity: IdentityInput,
  consentDate: string
): void {
  if (typeof consentDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(consentDate.trim())) {
    throw new Error(
      "Article IV: consent must be recorded — saveIdentity requires an ISO consent date " +
        "(YYYY-MM-DD); no identity row without consent (FR-14)"
    );
  }
  const key = loadKey(); // fail-secure BEFORE touching the DB
  const date = consentDate.trim();

  db.transaction(() => {
    const buyer = db.query<{ id: number }, [number]>("SELECT id FROM buyers WHERE id = ?").get(buyerId);
    if (!buyer) {
      throw new Error(`buyer ${buyerId} not found — cannot save identity`);
    }
    db.query("UPDATE buyers SET consent_flag = 1 WHERE id = ?").run(buyerId);
    db.query(
      `INSERT INTO buyer_identity (buyer_id, name_enc, phone_enc, email_enc, consent_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(buyer_id) DO UPDATE SET
         name_enc = excluded.name_enc,
         phone_enc = excluded.phone_enc,
         email_enc = excluded.email_enc,
         consent_date = excluded.consent_date`
    ).run(
      buyerId,
      identity.name !== undefined ? encryptField(key, identity.name) : null,
      identity.phone !== undefined ? encryptField(key, identity.phone) : null,
      identity.email !== undefined ? encryptField(key, identity.email) : null,
      date
    );
  })();
}

/**
 * Decrypts a buyer's identity for legitimate operator display ONLY — never
 * for reports, analytics, or logs (Article IV). Returns null if no row.
 */
export function readIdentity(db: Database, buyerId: number): IdentityRecord | null {
  const key = loadKey();
  const row = db
    .query<
      { name_enc: Uint8Array | null; phone_enc: Uint8Array | null; email_enc: Uint8Array | null; consent_date: string },
      [number]
    >("SELECT name_enc, phone_enc, email_enc, consent_date FROM buyer_identity WHERE buyer_id = ?")
    .get(buyerId);
  if (!row) return null;
  return {
    buyerId,
    name: row.name_enc ? decryptField(key, row.name_enc) : null,
    phone: row.phone_enc ? decryptField(key, row.phone_enc) : null,
    email: row.email_enc ? decryptField(key, row.email_enc) : null,
    consentDate: row.consent_date,
  };
}

/**
 * Right-to-erasure (FR-14): deletes the buyer_identity row and resets
 * consent_flag to 0. Buyers/opportunities/sales_events rows survive
 * de-identified and fully queryable. Deliberately needs NO key — losing the
 * key must never block a GDPR erasure. Returns true if a row was deleted.
 */
export function eraseIdentity(db: Database, buyerId: number): boolean {
  return db.transaction((): boolean => {
    const res = db.query("DELETE FROM buyer_identity WHERE buyer_id = ?").run(buyerId);
    const erased = res.changes > 0;
    if (erased) {
      db.query("UPDATE buyers SET consent_flag = 0 WHERE id = ?").run(buyerId);
    }
    return erased;
  })();
}
