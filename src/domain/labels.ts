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

// T012 — the capture sheets render option grids for these stored keys (buyers
// analytical enums, data-model.md). Brand names (Spitogatos, XE) stay as the
// operators know them; everything else is Greek. Wording: ADR-0022.
const SOURCE_CHANNEL_LABELS: Record<string, string> = {
  spitogatos: "Spitogatos",
  xe: "Χρυσή Ευκαιρία",
  referral: "Σύσταση",
  walkin: "Από το γραφείο",
  social: "Social media",
};

const SEGMENT_LABELS: Record<string, string> = {
  first_home: "Πρώτη κατοικία",
  investor: "Επενδυτής",
  upgrader: "Αναβάθμιση",
  foreign: "Εξωτερικό",
};

const BUDGET_BAND_LABELS: Record<string, string> = {
  "<150k": "έως 150.000 €",
  "150-250k": "150.000–250.000 €",
  "250-400k": "250.000–400.000 €",
  "400k+": "400.000 € και άνω",
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

export function sourceChannelLabel(sourceChannel: string): string {
  return lookup(SOURCE_CHANNEL_LABELS, "source_channel", sourceChannel);
}

export function segmentLabel(segment: string): string {
  return lookup(SEGMENT_LABELS, "segment", segment);
}

export function budgetBandLabel(budgetBand: string): string {
  return lookup(BUDGET_BAND_LABELS, "budget_band", budgetBand);
}
