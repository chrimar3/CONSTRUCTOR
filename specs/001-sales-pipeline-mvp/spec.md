# Feature Specification — 001 · Sales Pipeline MVP

**Branch**: `001-sales-pipeline-mvp`
**Status**: Ready for planning
**Language note**: This spec is agent-facing (English). The delivered product's UI and all generated reports are in **Greek**.

## Why (problem & value)

A real-estate agency operating as the outsourced sales department for construction firms needs to (a) run its daily sales pipeline for under-construction units and (b) automatically produce a client-facing progress report every two weeks that keeps the exclusive mandate alive. Today this would be scattered across memory, paper, chat, and a generic CRM — so no defensible transaction dataset accumulates and reports are manual. This MVP makes capture frictionless, the pipeline the team's daily driver, and the report a one-command output. The prototype's job is to prove the loop works with the agency's own 3-person team before it is offered as the agency's differentiator to more builders.

## Scope

**In scope (prototype):** mobile-first capture of Leads/Viewings/Offers into a live pipeline; mandatory next-action; interest→temperature; offer auto-counter suggestion; pipeline board sorted by "needs action"; deterministic biweekly and monthly report generation (Greek) with recommendations; migration of an existing live pipeline; buyer PII separation.

**Out of scope (prototype):** ilist bi-directional sync (design the seam, don't build it); multi-tenant/other agencies (that is Phase B); portal syndication; authentication beyond a simple team login; native mobile app (responsive web is sufficient).

## Clarifications

### Session 2026-07-12
- **Opportunity grain** → **One opportunity per buyer↔project** (not per buyer↔unit). The current unit is `focus_unit_id`; each viewing/offer is logged against a specific `unit_id` on the event. Enforced by `UNIQUE(buyer_id, project_id)`. Preserves "one next-action per buyer" (Article II). *[locked]*
- **Acting operator identity (no real auth)** → A "who are you" selector on app open — **Χρήστος / Λωίδα / Γιολάντα** — stored in session, auto-stamped as `handled_by` on every event. *[locked]*
- **Comps source for monthly micro-area comparative** → **Own transactions + manual comp entry.** The moat is own data; to solve cold-start, operators may manually enter real *known* neighbourhood **sale** prices (not asking) into a `comps` table, labelled by source. No automated external/portal ingestion. *[locked]*
- **Report period boundaries** → **Both.** The client-facing scheduled report uses **fixed, non-overlapping** periods anchored to a reference date (no double-counting across consecutive reports); an internal `--rolling` flag gives the team "how are we doing right now"; `--as-of DATE` for reproducibility (Article III). *[locked]*
- **PII / GDPR minimum (lawful)** → Real AES-GCM at rest, key from a **non-committed** secret (env/secret store, never in git). An identity row may be stored ONLY when consent / lawful basis is recorded (`consent_flag`). **Right-to-erasure supported** (delete identity row; analytical + transaction data survive, de-identified). PII MUST NOT appear in any report, analytic query, or log. Retention automation, key rotation, and DSAR tooling = deferred (policy, not prototype code). *[locked]*

## User Stories (Given / When / Then)

### US-1 — Capture a lead in <30s
Given a new buyer inquiry, when the operator opens the app and taps "+ Lead" and selects source_channel, segment, budget band, (optional) unit of interest, and a mandatory next_action, then a new opportunity is created at stage `Lead`, a pseudonymous buyer id is generated, and the operator returns to the pipeline — in under ~30 seconds. Submit is blocked until next_action is set.

### US-2 — Capture a viewing
Given a completed viewing, when the operator taps "+ Επίσκεψη", selects unit, buyer, an interest rating 1–5, an optional note, and a mandatory next_action, then the opportunity advances to stage `Επίσκεψη`, its temperature is derived from interest (≥4 hot, 3 warm, ≤2 cold), and it is logged with `handled_by` = current user.

### US-3 — Capture an offer with auto-counter
Given a buyer makes an offer, when the operator taps "+ Προσφορά", selects unit and buyer, and enters an amount below the unit's asking price, then the system displays the % below asking and a suggested counter-offer weighted toward asking, offers a one-tap "set as next action", requires a next_action, and on save advances the opportunity to stage `Προσφορά` with temperature hot and records the offer amount.

### US-4 — Work the pipeline
Given live opportunities, when the operator opens the app, then they see a board of opportunity cards showing buyer pseudonym, unit, stage, temperature, offer (if any), and the next action + owner, sorted so the ones needing attention appear first, with per-project activity counters (live / viewings / offers).

### US-5 — Generate the biweekly report
Given ≥1 project with captured activity, when a user runs the report command for a builder/project with period=biweekly, then the system produces a Greek report for the last 14 days containing: activity totals (new inquiries, viewings, offers), a per-unit breakdown, and space for 2–3 insight lines (added via the interactive Claude Code insight step) — where every cold/zero figure is paired with a deterministic data-derived recommendation.

### US-6 — Generate the monthly/quarterly report
Given accumulated data, when a user runs the report with period=monthly (or quarterly), then the report additionally includes: trend vs previous period, price-realization signal per unit, a micro-area comparative, an explicit recommendation per unit (price / presentation / hold), and an absorption forecast.

### US-7 — Day-0 migration
Given the agency has an existing live pipeline, when an operator runs a seed/migrate command with a structured input file, then all current opportunities are loaded so the team opens a populated (never empty) board on first use.

## Functional Requirements

- **FR-1** System MUST support capturing Lead, Viewing, Offer events, each creating or advancing a single **buyer↔project** opportunity (grain locked: `UNIQUE(buyer_id, project_id)`; the current unit is `focus_unit_id`, and each viewing/offer is logged against a specific `unit_id` on the event).
- **FR-2** System MUST reject any capture whose `next_action` is empty (UI-disabled submit AND storage-level rejection).
- **FR-3** System MUST derive temperature deterministically from the latest interest rating; offers set temperature hot.
- **FR-4** System MUST compute, for an offer below asking, the percentage below asking and a suggested counter, using deterministic math only.
- **FR-5** System MUST store buyer identity (name/phone/email) separately and encrypted, gated by a consent flag, never mixed with analytical fields.
- **FR-6** System MUST record `handled_by` (which team member) on every event to support the separation test.
- **FR-7** System MUST capture `micro_area` for every project and never store location more coarsely.
- **FR-8** Report generation MUST be deterministic for all numbers and MUST NOT call any LLM API in-app. It emits metrics + a structured **insight brief**; the 2–3 insight sentences are generated out-of-band via an interactive Claude Code step (Max-covered), reviewed, and pasted in. Reports are complete and sendable without insights.
- **FR-9** Every client-facing report MUST pair each negative/zero metric with a data-derived recommendation (no naked bad numbers).
- **FR-10** System MUST provide a migration path to load an existing pipeline from a structured file.
- **FR-11** All user-facing text and reports MUST be in Greek.
- **FR-12** System MUST let operators manually enter neighbourhood comparable **sale** prices (labelled by source) into a comps store; the monthly comparative uses own transactions + these manual comps only — never automated external/portal ingestion.
- **FR-13** Report generation MUST default to **fixed, non-overlapping** periods anchored to a reference date, and MUST also support `--rolling` (internal use) and `--as-of DATE` (reproducibility).
- **FR-14** System MUST store buyer identity ONLY when consent/lawful basis is recorded, MUST support **erasure** of an identity (analytics survive, de-identified), and MUST exclude PII from every report, analytic query, and log.

## Success Criteria (measurable)

- **SC-1** An operator can complete each of the three capture types in ≤30 seconds on a phone (measured on the prototype).
- **SC-2** 100% of stored opportunities have a non-empty next_action (DB invariant holds; attempts to violate are rejected).
- **SC-3** A biweekly report for a seeded project generates in one command in <5 seconds and contains zero naked negative metrics.
- **SC-4** Buyer analytical queries (e.g. ready-buyer-pool by segment/area) run without touching the identity table.
- **SC-5** `handled_by` distribution is queryable (separation-test report available from day one).
- **SC-6** Loading a seed pipeline yields a populated board on first launch.

## Edge Cases

- Offer ≥ asking price → no counter suggested; still requires next_action.
- Report period with zero activity → report states this plainly and recommends a concrete action (never blank, never bare "0").
- New buyer at viewing/offer with no prior lead → opportunity is created on the spot.
- Interest not provided on a viewing → cannot submit (interest is required for viewings).
- Missing consent → identity fields not retained; analytical opportunity still valid and usable.

## Key Entities (detail in data-model.md)

Project (builder, micro_area, exclusivity window), Unit (asking price, status), Buyer (analytical) + BuyerIdentity (PII, encrypted), Opportunity/Sales Event (stage, next_action, handled_by), Marketing Asset (attribution/cost).
