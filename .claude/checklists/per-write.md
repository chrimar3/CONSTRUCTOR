# Checklist — any new/changed write function in src/db/

Tick every line; a miss is a defect even with green tests.

- [ ] Writes touching `opportunities`/`sales_events` (captures): first two calls in the body are `assertNoPiiKeys(input)` then `assertNextAction(...)` — BEFORE any DB statement (guard message must surface, never a DB error). Writes to `units`/`price_changes`/`comps` have no next_action by data-model design (Article II scopes to captures) — PII guard there only if the input carries buyer-shaped data.
- [ ] Whole write wrapped in `db.transaction(() => {...})()` — note the trailing `()`.
- [ ] Accepts optional `at?: string` ISO override; timestamps via `nowIso(at)`, never `Date.now()`.
- [ ] Any id used in a derived value (pseudonym) allocated via `COALESCE(MAX(id),0)+1` INSIDE the transaction — never a two-step read-back.
- [ ] Stage: forward-only via the rank map (`maxStage`); temperature: latest signal wins (no ratchet). Two different rules — do not unify.
- [ ] Event rows carry `handled_by` + `next_action`; opportunity `updated_at` restamped.
- [ ] Numeric reads wrapped in `Number(...)`; aggregates in `COALESCE(..., 0)`.
- [ ] Test named after the requirement it pins ("Article II: …", "grain: …").
- [ ] `bash scripts/verify-gates.sh` passes.
