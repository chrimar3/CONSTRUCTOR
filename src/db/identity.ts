// T008a — Article IV / FR-14: the ONLY module allowed to touch buyer_identity.
// PII (name/phone/email) is encrypted at rest with AES-256-GCM (node:crypto).
// The key comes ONLY from env CONSTRUCTOR_PII_KEY — 32 bytes, base64 (44 chars,
// `openssl rand -base64 32`) or hex (64 chars). Missing/malformed key = loud
// crash naming the var; there is deliberately NO fallback default (fail-secure,
// ADR-0015). saveIdentity records consent atomically with the identity write, so
// no code path can create an identity row without recorded consent. eraseIdentity
// implements right-to-erasure and needs NO key — key loss can never block GDPR
// erasure. No error message in this module ever carries a PII value.

import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENV = "CONSTRUCTOR_PII_KEY";
const KEY_BYTES = 32;
const IV_BYTES = 12; // NIST-recommended GCM nonce length
const TAG_BYTES = 16;
/** BLOB layout v1: [version(1)] [iv(12)] [authTag(16)] [ciphertext(n)] */
const FORMAT_VERSION = 0x01;

const KEY_HINT =
  "expected exactly 32 bytes encoded as base64 (44 chars, generate with `openssl rand -base64 32`) or hex (64 chars)";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SaveIdentityInput {
  buyerId: number;
  name?: string;
  phone?: string;
  email?: string;
  /** ISO date (or datetime) on which consent/lawful basis was recorded — REQUIRED (FR-14). */
  consentDate: string;
}

export interface BuyerIdentity {
  buyerId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  consentDate: string | null;
}

// ─── Key handling (fail-secure — crash, never a default) ────────────────────

/**
 * Loads the AES-256 key from env CONSTRUCTOR_PII_KEY. Accepted encodings of the
 * 32 raw bytes: base64 (exactly 44 chars incl. padding) or hex (exactly 64
 * chars, either case). Anything else — including an unset or blank var — throws
 * an error naming the var. There is NO fallback key by design (Article IV).
 */
function loadKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `${KEY_ENV} is not set — refusing to touch buyer_identity without the PII encryption key; ${KEY_HINT} (Article IV: fail-secure, no default key exists)`,
    );
  }
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const key = Buffer.from(value, "base64");
    if (key.length === KEY_BYTES) return key;
  }
  throw new Error(`${KEY_ENV} is malformed — ${KEY_HINT}`);
}

// ─── Field crypto (internal) ─────────────────────────────────────────────────

function encryptField(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES); // fresh random IV per encryption — never reused
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

function decryptField(key: Buffer, blob: Uint8Array): string {
  const buf = Buffer.from(blob);
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== FORMAT_VERSION) {
    throw new Error(
      `buyer_identity blob has an unknown format (expected version ${FORMAT_VERSION}) — refusing to decrypt`,
    );
  }
  const iv = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: wrong key or tampered ciphertext. Deliberately
    // replace node's error so no partial state ever leaks — and never any PII.
    throw new Error(
      `buyer_identity decryption failed — wrong ${KEY_ENV} or tampered ciphertext (nothing recovered)`,
    );
  }
}

// ─── Guards (run BEFORE key load and BEFORE any DB statement) ────────────────

/** FR-14: consent must be recorded with the identity — an ISO date is required. */
function assertConsent(consentDate: unknown): asserts consentDate is string {
  if (
    typeof consentDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}($|T)/.test(consentDate.trim()) ||
    Number.isNaN(Date.parse(consentDate))
  ) {
    throw new Error(
      "FR-14: recorded consent required — saveIdentity refuses without a valid ISO consentDate (no identity row without consent)",
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Records consent AND the encrypted identity in one transaction (ADR-0015):
 * sets buyers.consent_flag = 1 and fully replaces the buyer_identity row
 * (absent fields become NULL — no stale PII survives an upsert). Refuses
 * loudly without a valid consentDate, without any identity field, or for an
 * unknown buyer — always before writing anything.
 */
export function saveIdentity(db: Database, input: SaveIdentityInput): void {
  assertConsent(input.consentDate);
  if (input.name === undefined && input.phone === undefined && input.email === undefined) {
    throw new Error(
      "saveIdentity: at least one identity field (name/phone/email) is required",
    );
  }
  const key = loadKey();
  const consentDate = input.consentDate.trim();
  const nameEnc = input.name === undefined ? null : encryptField(key, input.name);
  const phoneEnc = input.phone === undefined ? null : encryptField(key, input.phone);
  const emailEnc = input.email === undefined ? null : encryptField(key, input.email);

  db.transaction(() => {
    const buyer = db
      .query("SELECT 1 FROM buyers WHERE id = ?")
      .get(input.buyerId);
    if (buyer === null) {
      throw new Error(
        `saveIdentity: buyer ${input.buyerId} not found — no orphan identity rows`,
      );
    }
    db.run("UPDATE buyers SET consent_flag = 1 WHERE id = ?", [input.buyerId]);
    db.run(
      `INSERT INTO buyer_identity (buyer_id, name_enc, phone_enc, email_enc, consent_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(buyer_id) DO UPDATE SET
         name_enc = excluded.name_enc,
         phone_enc = excluded.phone_enc,
         email_enc = excluded.email_enc,
         consent_date = excluded.consent_date`,
      [input.buyerId, nameEnc, phoneEnc, emailEnc, consentDate],
    );
  })();
}

/** Decrypts and returns the buyer's identity, or null when no identity row exists. */
export function readIdentity(db: Database, buyerId: number): BuyerIdentity | null {
  const key = loadKey(); // fail-secure even when the row turns out to be absent
  const row = db
    .query<
      {
        buyer_id: number;
        name_enc: Uint8Array | null;
        phone_enc: Uint8Array | null;
        email_enc: Uint8Array | null;
        consent_date: string | null;
      },
      [number]
    >(
      "SELECT buyer_id, name_enc, phone_enc, email_enc, consent_date FROM buyer_identity WHERE buyer_id = ?",
    )
    .get(buyerId);
  if (row === null) return null;
  return {
    buyerId: row.buyer_id,
    name: row.name_enc === null ? null : decryptField(key, row.name_enc),
    phone: row.phone_enc === null ? null : decryptField(key, row.phone_enc),
    email: row.email_enc === null ? null : decryptField(key, row.email_enc),
    consentDate: row.consent_date,
  };
}

/**
 * Right-to-erasure (Article IV): deletes the buyer's identity row and resets
 * consent_flag to 0 (erasure = consent withdrawal — the flag never claims
 * consent for identity that no longer exists). Deliberately needs NO encryption
 * key, so key loss can never block a GDPR erasure. All analytical/transaction
 * rows (buyers, opportunities, sales_events) are untouched and stay queryable.
 * Returns true when an identity row was actually deleted.
 */
export function eraseIdentity(db: Database, buyerId: number): boolean {
  return db.transaction((): boolean => {
    const existed =
      db.query("SELECT 1 FROM buyer_identity WHERE buyer_id = ?").get(buyerId) !== null;
    db.run("DELETE FROM buyer_identity WHERE buyer_id = ?", [buyerId]);
    db.run("UPDATE buyers SET consent_flag = 0 WHERE id = ?", [buyerId]);
    return existed;
  })();
}
