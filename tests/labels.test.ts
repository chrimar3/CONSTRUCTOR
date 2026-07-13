import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stageLabel, eventTypeLabel, temperatureLabel } from "../src/domain/labels";

const schema = readFileSync(join(import.meta.dir, "../src/db/schema.sql"), "utf8");

/** Pull the pipe-list after "INTERNAL stored key:" on the column's comment line. */
function enumValuesFromSchema(column: "stage" | "event_type"): string[] {
  const line = schema.split("\n").find((l) => l.trimStart().startsWith(column));
  expect(line).toBeDefined();
  const m = line!.match(/INTERNAL stored key:\s*(\S+)/);
  expect(m).not.toBeNull();
  return m![1]!.replace(/\.$/, "").split("|");
}

const GREEK = /[Α-Ωα-ωΆΈΉΊΌΎΏά-ώ]/;

describe("labels.ts — FR-11: no stored key is ever rendered raw", () => {
  test("every stage value in schema.sql has a non-empty Greek label", () => {
    const stages = enumValuesFromSchema("stage");
    expect(stages.length).toBeGreaterThanOrEqual(6);
    for (const s of stages) {
      const label = stageLabel(s);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).toMatch(GREEK);
    }
  });

  test("every event_type value in schema.sql has a non-empty Greek label", () => {
    const types = enumValuesFromSchema("event_type");
    expect(types.length).toBeGreaterThanOrEqual(6);
    for (const t of types) {
      const label = eventTypeLabel(t);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).toMatch(GREEK);
    }
  });

  test("temperature values have Greek labels", () => {
    for (const t of ["hot", "warm", "cold"] as const) {
      expect(temperatureLabel(t)).toMatch(GREEK);
    }
  });

  test("unknown key throws — a new stored value without a label must fail loudly", () => {
    expect(() => stageLabel("SomeNewStage")).toThrow();
    expect(() => eventTypeLabel("mystery")).toThrow();
  });

  test("the English stored keys map to Greek display (Lead, Fallthrough, inquiry)", () => {
    expect(stageLabel("Lead")).toMatch(GREEK);
    expect(stageLabel("Fallthrough")).toMatch(GREEK);
    expect(eventTypeLabel("inquiry")).toMatch(GREEK);
  });
});
