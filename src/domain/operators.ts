// T012a — FR-6/SC-5 (clarification-locked): the three agency operators. This is
// the single source of truth for handled_by / next_owner values — the API
// boundary validates membership against it and the web client renders its
// selector from it. No real auth (locked decision, CLAUDE.md): identity is a
// session-level claim, not a credential. The Greek names ARE the stored values
// and display as themselves (no labels.ts mapping needed — nothing to translate).

export const OPERATORS = ["Χρήστος", "Λωίδα", "Γιολάντα"] as const;

export type Operator = (typeof OPERATORS)[number];

/** Exact-match membership check (case- and script-sensitive by design). */
export function isOperator(value: string): value is Operator {
  return (OPERATORS as readonly string[]).includes(value);
}
