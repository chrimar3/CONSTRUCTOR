# VERIFICATION.md — 001 · Sales Pipeline MVP (T020)

Success-criteria verification per `specs/001-sales-pipeline-mvp/spec.md`. Every claim below
is backed by output produced **fresh in the T020 verification session (2026-07-14)** on this
machine, at the commit following T019 / CHECKPOINT-2 approval (`cee1913`). No result is
carried over from earlier runs.

## Full suite (fresh)

```
$ bun test
bun test v1.3.0 (b0a6feca)
 326 pass
 0 fail
 1431 expect() calls
Ran 326 tests across 15 files. [892.00ms]
```

## Quickstart commands (all run fresh, in order — no pre-existing `constructor.db`)

| Command | Result |
| --- | --- |
| `bun install` | `Checked 11 installs across 12 packages (no changes)` |
| `bun run db:init` | `db:init OK — constructor.db ready (schema applied idempotently)` |
| `bun run seed seed.example.json` | `Seed ολοκληρώθηκε: 2 έργα, 6 μονάδες, 8 αγοραστές, 8 ευκαιρίες, 15 γεγονότα.` |
| `bun run dev` (smoke: background + curl + kill) | `Constructor API listening on http://127.0.0.1:3157` · `GET /` → 200 · `GET /pipeline?project=1` → populated cards · `GET /counters?project=1` → `{"inquiries":5,"viewings":4,"offers":2,"liveOpportunities":5}` |
| `bun run report --builder="Παπαδόπουλος" --project="Κυψέλη-Α" --period=biweekly` | exit 0, Greek Markdown, `real 0.02` s |
| `bun run report --builder="Παπαδόπουλος" --project="Κυψέλη-Α" --period=monthly` | exit 0, Greek Markdown incl. trend/realization/comparative/forecast, `real 0.02` s |
| `bun run report --separation` | Greek per-operator table (see SC-5) |
| `bun test` | 326 pass / 0 fail (above) |

---

## SC-1 — Each capture type ≤30 s on a phone

**Status: PENDING HUMAN TIMING at FINAL CHECKPOINT** (a stopwatch measurement on a phone
viewport is human work by definition). Automated proxy evidence from this session:

- **Single-round-trip save** — one POST per capture, measured live:
  ```
  lead payload bytes: 197
  POST /leads → {"buyerId":9,"opportunityId":9,"pseudonym":"#9"}
  HTTP 201 | time_total 0.001930s
  ```
  Network cost is negligible; capture time is entirely operator taps.
- **Payload sizes** — `GET /` shell 892 bytes; `GET /app.js` 1,027,697 bytes served in
  0.081 s locally (loaded once per session, not per capture).
- **Structured inputs over keyboards (Article I)** — segmented option grids
  (`src/web/App.tsx:210`), next-action quick-pick chips (`src/web/App.tsx:253`,
  suggestion lists at `src/web/App.tsx:81`); helper behavior pinned in
  `tests/web.test.ts:207-247`.
- **One-request happy paths pinned**: `tests/api.test.ts:95` (lead),
  `tests/api.test.ts:141` (viewing), `tests/api.test.ts:217` (offer).
- Supporting (not substituting): CHECKPOINT 1 (commit `690a55b`) was human-approved and its
  checklist (`specs/001-sales-pipeline-mvp/quickstart.md`) includes "Each capture completes
  one-handed in <30s".

## SC-2 — 100% of stored opportunities have non-empty next_action; violations rejected

**Status: VERIFIED.** Fresh probes against the live seeded DB:

```
opportunities total: 8 | blank next_action: 0
raw whitespace INSERT rejected: CHECK constraint failed:
  length(trim(next_action, ' ' || char(9) || char(10) || char(13))) > 0
```

API layer, live:

```
POST /leads {"nextAction":"   ", ...} → HTTP 400 {"error":"Απαιτείται επόμενη ενέργεια"}
```

Pins: DB CHECKs `src/db/schema.sql:76` (opportunities) and `src/db/schema.sql:93`
(sales_events); query-layer guard `tests/constraints.test.ts:115`; raw-SQL backstop
`tests/constraints.test.ts:142` and `:156` (incl. tab/newline/CR per the standing
whitespace ruling); API 400 `tests/api.test.ts:110`; UI submit-disable
`tests/web.test.ts:262` and `:268` (blank/whitespace blocks all three sheets).

## SC-3 — Biweekly report: one command, <5 s, zero naked negative metrics

**Status: VERIFIED.**

- **One command, <5 s**: `/usr/bin/time -p bun run report --builder="Παπαδόπουλος"
  --project="Κυψέλη-Α" --period=biweekly` → `real 0.02` (monthly also `real 0.02`) —
  250× inside the 5 s budget.
- **Zero naked bad numbers** (Article VI): every zero in the fresh output is paired with a
  recommendation in the same block, e.g.:
  ```
  ### Μονάδα Α1 — ζητούμενη τιμή 238.000 €
  - Επίσκεψη: 1
  - Προσφορά: 0
  - **Σύσταση:** Χαμηλή επισκεψιμότητα (1 επίσκεψη) — προτείνεται ανανέωση της παρουσίασης …
  ```
  Structural scanner pinned in `tests/naked-numbers.test.ts:279` (full-report scan finds
  zero naked figures), `:288`, `:295`, and `:303` (fully-zero period states it plainly and
  recommends a concrete action).
- **Determinism** (Article III / FR-13): two consecutive runs, identical SHA-256:
  ```
  41e032e81dec864fe95a5fc4b80eb28712b8a140ea9b4a5e6c103e87cc17a8e1  /tmp/biweekly1.md
  41e032e81dec864fe95a5fc4b80eb28712b8a140ea9b4a5e6c103e87cc17a8e1  /tmp/biweekly2.md
  ```
  Byte-identity across as-of dates within a fixed period pinned at `tests/cli.test.ts:171`;
  boundary events appear in exactly one period at `tests/cli.test.ts:165`.

## SC-4 — Buyer analytical queries run without touching the identity table

**Status: VERIFIED.** Fresh `EXPLAIN QUERY PLAN SELECT * FROM v_buyer_pool` on the seeded DB:

```
CO-ROUTINE v_buyer_pool
SCAN buyers USING INDEX idx_buyers_seg
USE TEMP B-TREE FOR GROUP BY
SCAN v_buyer_pool
```

No step reads `buyer_identity`. The pool query returned 7 segment/area/budget rows
(e.g. `{"segment":"first_home","area_pref":"Γκύζη","budget_band":"150-250k","ready_buyers":2}`)
with the identity table untouched.

Pins: `tests/constraints.test.ts:796` (no SQL statement in `src/db/queries.ts` references
`buyer_identity`), `:806` (v_buyer_pool aggregates with `buyer_identity` EMPTY);
`tests/identity.test.ts:335` (erasure leaves buyers/opportunities/events fully queryable),
`:393` (erasure needs no key).

## SC-5 — handled_by distribution queryable (separation-test report)

**Status: VERIFIED.** Fresh `bun run report --separation` on the seeded DB:

```
# Έλεγχος διαχωρισμού — κατανομή γεγονότων ανά χειριστή

| Χειριστής | Γεγονότα |
| --- | --- |
| Λωίδα | 6 |
| Χρήστος | 5 |
| Γιολάντα | 4 |
```

Pins: `tests/separation.test.ts:80` (seeded events → correct per-operator counts), `:166`
(`--separation` alone exits 0 and prints the distribution); `tests/api.test.ts:513`
(`v_separation` reflects `handled_by` stamped by the operator session, T012a).

## SC-6 — Seed pipeline yields a populated board on first launch

**Status: VERIFIED.** No `constructor.db` existed before this session; after
`bun run db:init && bun run seed seed.example.json`:

```
Seed ολοκληρώθηκε: 2 έργα, 6 μονάδες, 8 αγοραστές, 8 ευκαιρίες, 15 γεγονότα.
```

First launch of `bun run dev`, `GET /pipeline?project=1` returned populated cards, e.g.:

```json
{"opportunityId":2,"buyerId":2,"pseudonym":"#2","unitCode":"Β1","stage":"Προσφορά",
 "temperature":"hot","offerAmount":285000,
 "nextAction":"Αντιπρόταση στον αγοραστή μετά από συνεννόηση με τον εργολάβο",
 "nextOwner":"Λωίδα","updatedAt":"2026-07-09T13:00:00.000Z"}
```

and `GET /counters?project=1` → `{"inquiries":5,"viewings":4,"offers":2,"liveOpportunities":5}`.

Pins: `tests/seed.test.ts:100` (US-7/SC-6: seeding a fresh DB populates the board for every
project), `:123` (activity counters reflect seeded history), `:147` (re-seed is idempotent).

---

## Verdict

SC-2..SC-6 verified with fresh evidence; SC-1 has full automated proxy evidence and awaits
the human stopwatch pass at the FINAL CHECKPOINT. The loop runs end-to-end:
capture (single 201 round trip) → live pipeline board (seeded, needs-action-first) →
one-command Greek builder report (0.02 s, byte-deterministic, zero naked bad numbers).
