# Checklist — any report code (src/report/*, T014–T019 and later maintenance)

The report is the product (Article VI). Tick every line.

- [ ] Every number comes from queries.ts/SQL. No estimation, no LLM, no derivation outside SQL/domain functions (Article III).
- [ ] Money/number rendering via `formatEuro` — never `toLocaleString`/`Intl` (byte determinism across hosts).
- [ ] Time is an injected `asOf: string` parameter — zero `new Date()`/`Date.now()` in src/report/.
- [ ] Period windows are half-open `[start, end)`, anchored per FR-13. Write the edge test FIRST: an event exactly on a window boundary appears in exactly ONE window.
- [ ] Every zero/negative/cold metric has a `recommendation()` line adjacent to it. Scan the rendered output for bare bad numbers (Article VI) — the zero-activity period states it plainly + recommends a concrete action.
- [ ] `recommendation()` stays total — never wrap it in try/catch expecting throws, never add throws to it.
- [ ] Every stage/event_type/temperature rendered passes through labels.ts — grep your template for `.stage`, `.event_type`, `.eventType`, `.temperature` interpolations.
- [ ] Offer figures shown = LATEST offer (by event id), never MAX(amount).
- [ ] No reads of `v_velocity` or `marketing_assets` (Phase B — forecast uses offer/viewing signals only).
- [ ] Determinism proof: run the command twice, `diff` the bytes — identical or it fails CHECKPOINT 2.
- [ ] Greek output; report reads like something a builder would trust.
- [ ] `bash scripts/verify-gates.sh` passes.
