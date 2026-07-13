// T006a — FR-11: stored enum keys are INTERNAL and never rendered raw.
// Every builder/operator-facing surface (web T012, reports T014/T016) renders
// stored keys through these maps. An unknown key throws (RangeError, matching
// the capture-path convention) so a new stored value without a label fails
// loudly in tests instead of leaking English to a client-facing report.

const STAGE_LABELS: Record<string, string> = {
  Lead: "Νέος ενδιαφερόμενος",
  "Επίσκεψη": "Επίσκεψη",
  "Προσφορά": "Προσφορά",
  "Κράτηση": "Κράτηση",
  "Συμβόλαιο": "Συμβόλαιο",
  Fallthrough: "Απώλεια",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  inquiry: "Εκδήλωση ενδιαφέροντος",
  viewing: "Επίσκεψη",
  offer: "Προσφορά",
  reservation: "Κράτηση",
  contract: "Συμβόλαιο",
  fallthrough: "Απώλεια",
};

const TEMPERATURE_LABELS: Record<string, string> = {
  hot: "Θερμός",
  warm: "Χλιαρός",
  cold: "Ψυχρός",
};

function lookup(map: Record<string, string>, kind: string, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    throw new RangeError(`No Greek label for ${kind} key: "${key}" (FR-11: add it to src/domain/labels.ts)`);
  }
  return map[key] as string;
}

export function stageLabel(stage: string): string {
  return lookup(STAGE_LABELS, "stage", stage);
}

export function eventTypeLabel(eventType: string): string {
  return lookup(EVENT_TYPE_LABELS, "event_type", eventType);
}

export function temperatureLabel(temperature: string): string {
  return lookup(TEMPERATURE_LABELS, "temperature", temperature);
}
