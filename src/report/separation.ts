// T019 — SC-5 separation-test report: renders the v_separation view (event
// counts per operator, handled_by attribution) as Greek Markdown. This is the
// internal proof that every capture is attributed to Χρήστος / Λωίδα / Γιολάντα
// — available from day one, so it takes no project/period options and renders a
// complete page even on an empty database.
//
// Article III: the only number source is queries.ts SQL over v_separation
// (deterministic ORDER BY there — the view itself has no order); no wall clock,
// no ICU, same DB ⇒ byte-identical output. Total over data — never throws
// (report-path convention; there are no caller inputs to reject).
//
// Operator names render as themselves: they are their own Greek display form
// (ADR-0023 — no labels.ts map exists or is needed for operators).

import type { Database } from "bun:sqlite";
import { separationCounts } from "../db/queries";

export function separationReport(db: Database): string {
  const rows = separationCounts(db);
  const lines: string[] = [];

  lines.push("# Έλεγχος διαχωρισμού — κατανομή γεγονότων ανά χειριστή");
  lines.push("");

  if (rows.length === 0) {
    // Day one / empty pipeline: state it plainly and pair it with a concrete
    // action (Article VI discipline — no silent empty page).
    lines.push("Δεν έχουν καταγραφεί ακόμη γεγονότα — η κατανομή ανά χειριστή είναι κενή.");
    lines.push("");
    lines.push(
      "**Σύσταση:** Καταχωρήστε ενδιαφερόμενους, επισκέψεις και προσφορές από την εφαρμογή ώστε κάθε ενέργεια να αποδίδεται στον χειριστή της.",
    );
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| Χειριστής | Γεγονότα |");
  lines.push("| --- | --- |");
  for (const row of rows) {
    lines.push(`| ${row.handledBy} | ${row.events} |`);
  }
  lines.push("");

  return lines.join("\n");
}
