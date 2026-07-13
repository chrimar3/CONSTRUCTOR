# Constitution — "Constructor" Sales Operations System

> Non-negotiable principles. The constitution supersedes all other practices. Any deviation requires explicit documented justification in the plan's Complexity Tracking section. All generated code, specs, and tasks MUST validate against these articles.

## Context (read first)

This is the internal operating system for a real-estate agency that acts as the **outsourced sales department** (not a passive listing broker) for construction firms (εργολάβοι) under exclusive mandate. The agency owns the entire buyer relationship. Two jobs, one system: (1) run the daily sales pipeline; (2) auto-produce the client-facing progress reports that keep the exclusive mandate alive. The prototype must prove the system works with a real 3-person team before it becomes the agency's competitive moat.

Target users: 3 agency owners/operators — the sales team (Χρήστος / Λωίδα / Γιολάντα) who run viewings and log events; on mobile, in the field. Client (report recipient): the builder. Product language: **Greek** (all UI strings and generated reports). Spec/agent-facing language: English.

## Article I — Capture must be frictionless or the moat never gets built
Every capture action (Lead, Viewing, Offer) MUST be completable on a phone in under ~30 seconds. Minimal required fields only; everything else deferred. Structured inputs (dropdowns/segmented controls) over free text; at most one optional free-text note per event. If a design choice trades entry-speed for data richness, entry-speed wins.

## Article II — No opportunity without a next action (NON-NEGOTIABLE)
Every capture MUST require a non-empty `next_action` before it can be saved. Submit is disabled until set. A pipeline record may never sit in a state with an empty next action. This is what distinguishes a sales department from a passive activity log. Enforced in both UI and data layer (DB constraint).

## Article III — Deterministic core, thin AI edges (human-run, no in-app API)
All metrics, report numbers, and pricing math MUST be computed deterministically from SQL — never generated or estimated by an LLM. **Report generation MUST NOT call any LLM API in-app.** The report emits its metrics plus a structured **insight brief** (the raw signals). The 2–3 human-readable insight sentences are produced separately by a human running an interactive Claude Code step (`.claude/commands/insights.md`, covered by the Max subscription), reviewed, and pasted in before the report is sent. No AI step may block report generation; without insights, the report is still complete and sendable. Rationale: headless/in-app `claude -p` is not reliably Max-covered and wrapping Claude Code in a product is steered to API keys, so the AI edge stays interactive, human-run, and key-free.

## Article IV — Privacy separation & EU data residency (NON-NEGOTIABLE)
Buyer PII (name, phone, email) MUST live in a separate table from analytical buyer fields, referenced by id, and stored encrypted at rest (AES-GCM, key from a non-committed secret). Analytical tables (segment, budget, source_channel, area_pref) MUST contain no PII and be fully usable without decrypting identity. A `consent_flag` gates any retention of identity — no identity row without recorded consent/lawful basis. The system MUST support **right-to-erasure**: deleting a buyer's identity row leaves all analytical/transaction data intact and de-identified. PII MUST NOT appear in any report, analytic query, or log. All storage stays within EU data residency. The moat (analytical + transaction data) must remain queryable independently of identity data.

## Article V — Micro-area granularity is the moat's foundation
Location MUST always be captured at project + micro_area precision (e.g. "Κυψέλη · Πλατεία Κύπρου, block Α"), never coarse ("Αθήνα"). The defensible intelligence is longitudinal, per-micro-area transaction data. Any schema or feature that discards micro-area granularity is a constitution violation.

## Article VI — The report is the product; never a naked bad number
Report generation is the system's reason to exist (it is the forcing function for capture discipline and mandate renewal). Every metric in a client-facing report, ESPECIALLY a bad one (0 offers, cold unit), MUST be paired with a recommendation or next action derived from the data. The report generator MUST NOT emit a bare negative figure without an accompanying data-driven recommendation.

## Article VII — Single source of truth
The system owns the analytical/moat fields. It MUST NOT require double-entry of data the agency's existing CRM (ilist) already holds. No feature may force an operator to type the same fact into two systems. Where overlap exists, this system's fields are authoritative for analytics.

## Article VIII — Framework trust & minimal surface
Use Bun and its built-ins directly (bun:sqlite, Bun.serve) rather than wrapping them in ORMs or unnecessary abstractions. Maximum 3 top-level projects/packages for the prototype; additional structure requires documented justification. Prefer boring, direct code the 3-person team could later reason about.

## Article IX — Test-first, incremental, committed (NON-NEGOTIABLE)
No implementation code before a failing test defines the behavior (Red → Green → Refactor). Each task (T001, T002, …) is an independently testable increment and gets its own commit. The agent builds incrementally and stops at defined checkpoints — it does NOT generate the whole project in one pass.

## Article X — Zones of Discretion (bounded autonomy)

This article GRANTS autonomy: default to acting (not asking) in GREEN and YELLOW. It forbids only *silent* decisions where they matter.

**GREEN — act freely, no logging.** Pure implementation within the other Articles: file/module layout inside the given `src/` structure, naming, internal code organization, Bun/TS idioms, test structure, error-handling style, comments. Do not ask about these — just build well.

**YELLOW — act, but record it in `DECISIONS.md` before moving on.** Choices with a real trade-off that do NOT touch any Article: adding a dependency, choosing a data shape the spec left open, interpreting an ambiguous requirement, a UX/performance trade-off, or deviating from a spec *suggestion* toward a better alternative that still honors the constitution. Proceed autonomously — but log an ADR entry (context, decision, alternatives, reversibility). Reviewed at the next CHECKPOINT, not before each step. An unlogged YELLOW decision is a process violation.

**RED — STOP and ask. No autonomy.** Anything that (a) touches or reinterprets any Article I–IX; (b) expands scope beyond spec.md (auth, ilist sync, hosting, multi-tenant, portal syndication); (c) is a one-way door — the DB shape that transaction history will accumulate on, the PII encryption approach, the price/counter *determinism*, the report determinism boundary; or (d) adds an external service or network dependency. Never "work around" a RED item; surface it.

Rule of thumb: **reversible + Article-safe → act (log if it has a trade-off); irreversible or Article-touching → ask.** When unsure which zone applies, treat it as RED.

## Governance
- Constitution supersedes all other practices.
- The `/speckit.plan` Constitution Check gate MUST pass before tasks are generated.
- `/speckit.analyze` MUST be run before `/speckit.implement`; any Article violation is a blocker, not a warning.
- Amendments require updating this file with a rationale.

**Version**: 1.2.0 (Article X added; Article III amended → Max-native, no in-app LLM API) · **Ratified for**: Phase A prototype (dogfood in own agency before Phase B productization).
