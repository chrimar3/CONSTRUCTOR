# Checklist — any new/changed write function in src/db/

Tick every line; a miss is a defect even with green tests.

- [ ] First two calls in the body: `assertNoPiiKeys(input)` then `assertNextAction(...)` — BEFORE any DB statement (guard message must surface, never a DB error).
- [ ] Whole write wrapped in `db.transaction(() => {...})()` — note the trailing `()`.
- [ ] Accepts optional `at?: string` ISO override; timestamps via `nowIso(at)`, never `Date.now()`.
- [ ] Any id used in a derived value (pseudonym) allocated via `COALESCE(MAX(id),0)+1` INSIDE the transaction — never a two-step read-back.
- [ ] Stage: forward-only via the rank map (`maxStage`); temperature: latest signal wins (no ratchet). Two different rules — do not unify.
- [ ] Event rows carry `handled_by` + `next_action`; opportunity `updated_at` restamped.
- [ ] Numeric reads wrapped in `Number(...)`; aggregates in `COALESCE(..., 0)`.
- [ ] Test named after the requirement it pins ("Article II: …", "grain: …").
- [ ] `bash scripts/verify-gates.sh` passes.
