# CODEBASE-KNOWLEDGE.md — Constructor (read at bootstrap, after CLAUDE.md)

Extracted by audit 2026-07-13 (phase-1 mid-build). Maintained at phase boundaries — if code
and this file disagree, trust the code and fix this file in the same commit.

## File map (responsibility → key exports → consumers)

**Domain layer — pure, no I/O, deterministic (Articles III/VI):**
- `src/domain/temperature.ts` — `temperature(interest): "hot"|"warm"|"cold"` (≥4/=3/≤2). Throws RangeError outside integer 1..5. Exports `Temperature`. → queries.ts (logViewing).
- `src/domain/counter.ts` — `counter(asking, offer): {pctBelow, suggested}|null`; null when offer≥asking; 0.6 weight, €500 rounding (ADR-0003 locked). Throws RangeError on non-positive/non-finite. → offer endpoint (T010), reports.
- `src/domain/recommend.ts` — `recommendation(signals): string` (Greek) + `formatEuro(n)`. Pinned: viewings≥3 & offers=0 → price; viewings<3 & offers=0 → presentation; offers>0 → hold. TOTAL function, never throws (garbage → no-data action branch). → reports (T014/T016).
- `src/domain/labels.ts` — `stageLabel/eventTypeLabel/temperatureLabel(key)` Greek display maps; RangeError on unknown key (own-property lookup — prototype names throw too). → web (T012), reports (T014/T016). EVERY user-facing render of a stored key goes through here.

**DB layer — owns ALL SQL:**
- `src/db/schema.sql` — 9 tables + indexes + 4 views, verbatim from data-model.md (enum universes live in `--` column comments; labels test parses them).
- `src/db/init.ts` — `initDb(path)`: FK ON per connection, idempotent apply, `bun run db:init`.
- `src/db/queries.ts` — capture/pipeline API: `createLead, logViewing, logOffer, advanceOpportunity, listPipeline, activityCounters` (+ T010a `updateAskingPrice`). Every fn takes `db` as first arg — no module-level connection.
- `src/db/identity.ts` (T008a) — the ONLY file allowed to touch `buyer_identity`. AES-256-GCM, key from `CONSTRUCTOR_PII_KEY` env (fail-secure: crash if missing, never default). `eraseIdentity` needs NO key (key loss can't block GDPR erasure).

**Later layers:** `src/api/server.ts` (Bun.serve, thin validator over queries — no business logic), `src/db/seed.ts`, `src/report/*` (biweekly/monthly/brief/cli — SQL numbers only), `src/web/*` (thin client over API).

## Conventions in force (follow these exactly)

- **Error layering:** capture/validator paths throw RangeError loudly (temperature, counter, amount/stage validation); the report path NEVER throws (recommendation is total — Article VI); labels throw RangeError on unknown key (FR-11); queries throw Error with an "Article II"/"Article IV" message prefix. Do not "unify" these — the split is deliberate (capture rejects bad data at the boundary; a report must always render).
- **Guards before DB:** every write runs `assertNoPiiKeys` → `assertNextAction` → domain validation, THEN the transaction. A guard violation must surface the guard's message, never a DB error.
- **Timestamps:** all ISO-8601 via `nowIso(at?)`; every write accepts optional `at?: string` override for deterministic tests. Never `Date.now()` in write/report paths.
- **Transactions:** `db.transaction(() => {...})()` — note the trailing `()`. Explicit id allocation (`COALESCE(MAX(id),0)+1`) INSIDE the transaction.
- **SQLite coercion:** wrap numeric reads in `Number(...)`; boolean aggregation idiom `COALESCE(SUM(cond), 0)`.
- **Test DBs:** domain/query tests: `initDb(":memory:")` in beforeEach. File-based tests: tmpdir + uuid, afterEach closes handles and removes the file PLUS `-wal`/`-shm` sidecars.
- **Test naming:** pin the requirement — "Article II: …", "FR-11: …", "grain: …" — a failure must read as a violation.

## Traps

**Looks wrong — is RIGHT (do not "fix"):**
- English stored enum keys (`Lead`, `Fallthrough`, `inquiry`) in the DB — by design; display via labels.ts (approved wording: Lead → "Νέος ενδιαφερόμενος", Fallthrough → "Απώλεια", hot/warm/cold → Θερμός/Χλιαρός/Ψυχρός — human-ruled, do not re-open).
- Greek stage keys hard-coded in queries.ts SQL (`WHEN 'Κράτηση'`, `NOT IN ('Συμβόλαιο','Fallthrough')`) — stages ARE the stored keys.
- `recommendation()` never throwing while sibling domain fns throw — deliberate (see error layering).
- `listPipeline.offerAmount` = LATEST offer (`ORDER BY e.id DESC LIMIT 1`), not MAX — a lower re-offer is the live position (ADR-0013).
- Temperature moves both ways with the latest signal; stage only forward. State vs progress — both correct.
- New leads start 'warm' + write an 'inquiry' event (ADR-0008/0014).
- `advanceOpportunity` writes no sales_event — reservation/contract capture is Phase B.

**Looks fine — is a VIOLATION:**
- Referencing `buyer_identity` anywhere outside `src/db/identity.ts` (+schema) — Article IV. Analytics must survive `DROP TABLE buyer_identity`.
- Rendering a raw stored enum key — FR-11.
- `Date.now()`/argless `new Date()` in report paths; `toLocaleString`/`Intl` for money — Article III (use `nowIso(at)` / `formatEuro`).
- A zero/negative metric in a report without an adjacent recommendation — Article VI.
- Any `anthropic`/`claude -p`/LLM API string in `src/` — Article III (insights are the human-run `/insights` command).
- Input keys matching `/(name|phone|email|mail|tel)/i` into any queries fn — runtime throw (substring match: `fullName`, `telephone` also rejected).

**SQLite gotchas:** `trim()` strips ONLY spaces (hence the `char(9)||char(10)||char(13)` CHECK — a standing human ruling); FK enforcement is per-connection; WAL leaves `-wal`/`-shm` sidecars.

## Commands (verified)

```bash
bun test                             # full suite
bun test tests/constraints.test.ts   # one file
bun test -t "Article IV"             # by name substring
bun run db:init                      # idempotent
bash scripts/verify-gates.sh         # ALL constitution gates, executable — THE gate
git log --oneline | grep -oE '^\S+ T[0-9]+[a-z]?' | head -1   # last completed task
```
