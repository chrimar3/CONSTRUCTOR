/**
 * FR-11 / Article — Greek product surface: stored enum keys are INTERNAL and
 * must never reach the UI or a report raw. Every render path goes through
 * these maps. An unknown key throws so a schema addition without a label
 * fails tests instead of leaking an English key to a builder-facing surface.
 */

const STAGE_LABELS: Record<string, string> = {
  Lead: "Ενδιαφερόμενος",
  "Επίσκεψη": "Επίσκεψη",
  "Προσφορά": "Προσφορά",
  "Κράτηση": "Κράτηση",
  "Συμβόλαιο": "Συμβόλαιο",
  Fallthrough: "Ακυρώθηκε",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  inquiry: "Εκδήλωση ενδιαφέροντος",
  viewing: "Επίσκεψη",
  offer: "Προσφορά",
  reservation: "Κράτηση",
  contract: "Συμβόλαιο",
  fallthrough: "Ακύρωση",
};

const TEMPERATURE_LABELS: Record<string, string> = {
  hot: "Καυτός",
  warm: "Θερμός",
  cold: "Κρύος",
};

function lookup(map: Record<string, string>, key: string, kind: string): string {
  const label = map[key];
  if (label === undefined) {
    throw new Error(`No Greek label for ${kind} '${key}' — add it to src/domain/labels.ts (FR-11)`);
  }
  return label;
}

export function stageLabel(stage: string): string {
  return lookup(STAGE_LABELS, stage, "stage");
}

export function eventTypeLabel(type: string): string {
  return lookup(EVENT_TYPE_LABELS, type, "event_type");
}

export function temperatureLabel(temp: string): string {
  return lookup(TEMPERATURE_LABELS, temp, "temperature");
}
