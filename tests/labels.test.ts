// T006a — FR-11: stored enum keys render ONLY via Greek label maps in src/domain/labels.ts.
// The enum universes are parsed out of schema.sql's own comment lines, so adding a stored
// value to the schema without adding a label fails this suite automatically.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stageLabel, eventTypeLabel, temperatureLabel } from "../src/domain/labels";

const SCHEMA_PATH = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));
const schemaSql = readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the pipe-delimited enum list from the `--` comment of a column
 * definition line in schema.sql (e.g. `stage TEXT NOT NULL, -- ...: a|b|c. ...`).
 * Takes the FIRST pipe-run in the comment (later prose may contain more pipes).
 */
function enumKeysFor(column: string): string[] {
  const line = schemaSql
    .split("\n")
    .find((l) => new RegExp(`^\\s*${column}\\s+TEXT`).test(l));
  if (!line) throw new Error(`schema.sql: no column definition line found for "${column}"`);
  const commentStart = line.indexOf("--");
  if (commentStart === -1) throw new Error(`schema.sql: "${column}" line has no -- comment`);
  const comment = line.slice(commentStart + 2);
  const run = comment.match(/[\p{L}\p{N}_]+(?:\|[\p{L}\p{N}_]+)+/u);
  if (!run) throw new Error(`schema.sql: no pipe-delimited enum list in "${column}" comment`);
  return run[0].split("|");
}

const stageKeys = enumKeysFor("stage");
const eventTypeKeys = enumKeysFor("event_type");
const temperatureKeys = enumKeysFor("temperature");

const hasGreek = (s: string) => /\p{Script=Greek}/u.test(s);

describe("schema.sql enum parsing (test scaffolding sanity)", () => {
  test("stage list parsed from schema comment contains the known keys", () => {
    expect(stageKeys).toEqual(
      expect.arrayContaining(["Lead", "Επίσκεψη", "Προσφορά", "Κράτηση", "Συμβόλαιο", "Fallthrough"]),
    );
  });

  test("event_type list parsed from schema comment contains the known keys", () => {
    expect(eventTypeKeys).toEqual(
      expect.arrayContaining(["inquiry", "viewing", "offer", "reservation", "contract", "fallthrough"]),
    );
  });

  test("temperature list parsed from schema comment contains the known keys", () => {
    expect(temperatureKeys).toEqual(expect.arrayContaining(["hot", "warm", "cold"]));
  });
});

describe("FR-11: every stored enum key maps to a non-empty GREEK display label", () => {
  test("every stage key in schema.sql has a non-empty Greek label", () => {
    for (const key of stageKeys) {
      const label = stageLabel(key);
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
      expect(hasGreek(label)).toBe(true);
    }
  });

  test("every event_type key in schema.sql has a non-empty Greek label", () => {
    for (const key of eventTypeKeys) {
      const label = eventTypeLabel(key);
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
      expect(hasGreek(label)).toBe(true);
    }
  });

  test("every temperature key in schema.sql has a non-empty Greek label", () => {
    for (const key of temperatureKeys) {
      const label = temperatureLabel(key);
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
      expect(hasGreek(label)).toBe(true);
    }
  });

  test("English stored keys (Lead, Fallthrough) never leak through as their own label", () => {
    expect(stageLabel("Lead")).not.toBe("Lead");
    expect(stageLabel("Fallthrough")).not.toBe("Fallthrough");
  });
});

describe("FR-11: unknown stored key THROWS (no silent English leak to builder-facing surface)", () => {
  test("stageLabel throws on an unknown key", () => {
    expect(() => stageLabel("Negotiation")).toThrow(RangeError);
  });

  test("eventTypeLabel throws on an unknown key", () => {
    expect(() => eventTypeLabel("callback")).toThrow(RangeError);
  });

  test("temperatureLabel throws on an unknown key", () => {
    expect(() => temperatureLabel("tepid")).toThrow(RangeError);
  });

  test("empty string is an unknown key (throws), never an empty label", () => {
    expect(() => stageLabel("")).toThrow(RangeError);
    expect(() => eventTypeLabel("")).toThrow(RangeError);
    expect(() => temperatureLabel("")).toThrow(RangeError);
  });

  test("Object.prototype names are not accidental labels (own-property lookup only)", () => {
    expect(() => stageLabel("constructor")).toThrow(RangeError);
    expect(() => eventTypeLabel("toString")).toThrow(RangeError);
  });
});
