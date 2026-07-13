# DECISIONS.md — Architecture Decision Log

Per Constitution **Article X**, the agent records every **YELLOW-zone** decision here *before moving on*. The human reviews these at CHECKPOINTS. GREEN decisions need no entry; RED decisions are not the agent's to make (stop and ask). Format is ADR-lite — keep entries short.

## How to add an entry
Copy the template, increment the ID, fill it in.

```
### ADR-NNNN — <short title>
- Date:
- Zone: YELLOW
- Context: <what forced a choice>
- Decision: <what you did>
- Alternatives considered: <1–2 rejected options + why>
- Reversibility: <easy | costly> — <if costly, why it is still Article-safe>
- Article-safety: confirmed no Article I–IX violation
```

---

## Inherited (locked) decisions — do NOT revisit
*These are the reasoning behind the constitution. They are RED (locked). Listed so you inherit the WHY, not just the WHAT.*

### ADR-0001 — Buyer PII stored separately + encrypted
- Rationale: GDPR compliance AND keeping the analytical moat queryable without identity data. Merging them "for simplicity" destroys both. Locked in Article IV.

### ADR-0002 — Report numbers deterministic; LLM only for insight prose
- Rationale: trust + reproducibility for client-facing reports. Locked in Article III.

### ADR-0003 — Counter-offer weighted 0.6 toward asking, rounded to €500
- Rationale: a starting heuristic, not a pricing engine. The *value* of the weight is tweakable → that is a YELLOW decision (log it if you change it). The *determinism* of the calculation is RED.

### ADR-0004 — System owns analytical fields; no ilist double-entry
- Rationale: adoption dies on double-entry. Locked in Article VII.

### ADR-0005 — AI insights are Max-native and human-run, not an in-app API call
- Rationale: the whole system must run on the owner's Claude Max subscription with no API key. In-app `claude -p` / API calls are not reliably Max-covered (documented silent API billing) and wrapping Claude Code in a product is steered to API keys. So `report --brief` emits a deterministic insight brief, and the 2–3 Greek insight lines are produced by an interactive Claude Code command (`.claude/commands/insights.md`) under Max, reviewed, and pasted in. Locked in Article III (amended v1.2.0). Making insights an in-app LLM/API call is RED.

---

## Standing human rulings — bind every run

### RULING 2026-07-13 — Article II CHECK strengthened to all-whitespace (RED, human-decided)
- Raised by: T008 agent (correctly halted — SQLite `trim()` strips only spaces, so `'\t'`/`'\n\t'` next_action passed the DB CHECK via raw SQL; app query layer was already safe).
- Human ruling: amend BOTH CHECKs (opportunities, sales_events) in data-model.md and schema.sql to `length(trim(next_action, ' ' || char(9) || char(10) || char(13))) > 0`. Pre-data, so the one-way door was still open; Article II names the DB layer explicitly — a documented gap was rejected.
- Verified: '', '  ', '\t', '\n\t', '\r\n' all rejected by CHECK; real Greek text accepted; full suite green.

---

## Archived (run v1) — prior build's decisions; new run logs its own

### ADR-0006 — recommendation() input shape + branch precedence
- Date: 2026-07-13
- Zone: YELLOW
- Context: data-model.md pins the thresholds (viewings ≥ 3 & offers = 0 → price; viewings < 3 → presentation; else hold) but leaves open (a) where the "€X βάσει comps" number comes from, and (b) what happens when viewings < 3 but offers exist (literal rule order would say "presentation" even with offers in hand).
- Decision: (a) `recommendation({viewings, offers, compsTarget?})` — the comps-based € target is computed by the *report* layer (T016, which owns the comps queries) and passed in; if absent, the price branch still emits a complete Greek recommendation without a number ("επανεξέταση τιμής βάσει comps"). Keeps the domain function pure/DB-free. (b) The presentation branch requires `offers = 0`; any unit with offers falls to "hold", matching the data-model parenthetical "otherwise (has offers / healthy)". Also: € formatting uses manual dot-separators, not `toLocaleString` (no ICU dependence — byte-identical output on any host, Article III).
- Alternatives considered: computing the comps target inside `recommendation()` (rejected: pulls DB access into a pure domain function, harder to test deterministically); literal rule-order precedence (rejected: recommending "staging refresh" for a unit with 2 live offers reads absurd in a builder-facing report).
- Reversibility: easy — signature and branch guard are localized; tests pin behavior.
- Article-safety: confirmed no Article I–IX violation (III strengthened: deterministic formatting; VI strengthened: total function, non-empty for any input).

### ADR-0007 — listPipeline needs-attention ordering (deterministic) + live-board filter
- Date: 2026-07-13
- Zone: YELLOW
- Context: spec/US-4 requires the board "sorted so the ones needing attention appear first" but does not define the signals or their precedence; tasks.md flags the choice as the implementer's call, deterministic and documented.
- Decision: total order = (1) temperature hot→warm→cold, (2) stage furthest along first (Κράτηση > Προσφορά > Επίσκεψη > Lead — an offer on the table outranks a fresh lead at equal temperature), (3) stalest `updated_at` first (longest-untouched needs eyes), (4) `id` ASC as final tiebreak so the order is a strict total order (same input → same output, Article III-adjacent determinism). Also: closed stages (`Συμβόλαιο`, `Fallthrough`) are excluded from the board and from the "live" counter — they are outcomes, not work items.
- Alternatives considered: pure staleness ordering (rejected: buries a hot fresh offer under old cold leads — the opposite of "needs attention"); a computed urgency score (rejected: opaque to a 3-person team, harder to reason about than a lexicographic sort, Article VIII "boring code").
- Reversibility: easy — one ORDER BY clause + one WHERE filter in `listPipeline`, pinned by tests that can be re-pinned.
- Article-safety: confirmed no Article I–IX violation (deterministic SQL, Article III; analytical joins only, Article IV).

### ADR-0008 — Lead capture data shape: new leads start 'warm', log an 'inquiry' event, next_owner defaults to handledBy
- Date: 2026-07-13
- Zone: YELLOW
- Context: `opportunities.temperature` is NOT NULL but data-model only derives temperature from viewing interest (offers → hot); a brand-new lead has no interest rating. Also open: whether `createLead` writes a `sales_events` row, and what `next_owner` is when the operator does not override it.
- Decision: (a) new leads start `'warm'` — an active inquiry is a real buying signal, stronger than "no signal" but unproven by a viewing; it also sorts fresh leads above stale cold ones on the board. (b) `createLead` appends an `'inquiry'` sales_event (the stored enum exists for exactly this; keeps the funnel Lead→Viewing→Offer fully reconstructable from the append-only log and `v_separation` complete). (c) `next_owner` defaults to `handledBy`, overridable per call — matches T012a's UI rule at the data layer. (d) Buyer pseudonym is `#<id>` with the id allocated explicitly (MAX(id)+1 inside the write transaction) so pseudonym↔id can never diverge.
- Alternatives considered: default temperature `'cold'` (rejected: ranks a brand-new inquiry below every warm record on the needs-attention board — punishes exactly the record most worth calling back); no inquiry event (rejected: activity/funnel counts would silently under-report lead work and `handled_by` separation would miss lead captures).
- Reversibility: easy — a default literal, one INSERT, and a fallback expression; all pinned by tests.
- Article-safety: confirmed no Article I–IX violation (II: event carries mandatory next_action; IV: analytical fields only, PII rejected with a runtime guard; V: untouched).

### ADR-0009 — Install four audited third-party skills into .claude/skills/
- Date: 2026-07-13
- Zone: YELLOW
- Context: Operator asked for the best-available skills to be researched and installed so agents execute with proper methodology. Third-party skill files are agent-facing instructions — a supply-chain surface for a project that will hold encrypted PII.
- Decision: Installed project-local, commit-pinned copies of test-driven-development, systematic-debugging, verification-before-completion (obra/superpowers d884ae0, MIT, 253k★) and insecure-defaults (trailofbits/skills cfe5d7b, CC BY-SA 4.0, professional audit firm). Every file was read and pattern-scanned before install (no network calls, no exfil, methodology only). Provenance + audit record in .claude/skills/THIRD-PARTY-SKILLS.md. CLAUDE.md loop updated to invoke them at the right step.
- Alternatives considered: marketplace/plugin auto-install (rejected: unpinned auto-updating instructions = supply-chain risk); spec-to-code-compliance skill (rejected: blockchain-persona misfire; speckit-analyze covers it); larger skill packs (rejected: Article VIII minimal surface — four targeted skills beat 300 generic ones).
- Reversibility: easy — delete the directories; nothing in src/ depends on them.
- Article-safety: confirmed no Article I–IX violation. These skills ENFORCE Articles III/IV/IX (TDD discipline, fail-open secret detection, evidence-before-claims); the app itself is untouched and still never calls an LLM.

### ADR-0010 — saveIdentity records consent itself; erasure withdraws it
- Date: 2026-07-13
- Zone: YELLOW
- Context: T008a requires saveIdentity to refuse "unless the buyer row has consent_flag=1 or the call itself records consent — pick one semantic". Real trade-off: a pre-existing-flag gate means a separate consent write must happen first (two calls, a window where the flag is set but no identity exists, and nothing ties the flag to a date); call-records-consent makes the identity write and the consent record one atomic act.
- Decision: saveIdentity RECORDS consent — it requires a valid ISO consent date (throws otherwise, before any write) and, in one transaction, sets buyers.consent_flag = 1 and upserts the encrypted identity row with consent_date. There is therefore no code path that creates an identity row without recorded consent (Article IV / FR-14 holds by construction). Corollaries: (a) eraseIdentity resets consent_flag to 0 — erasure is treated as consent withdrawal, so the flag never claims consent for identity that no longer exists, and a re-save needs fresh consent; (b) eraseIdentity deliberately needs NO encryption key, so key loss can never block a GDPR erasure; (c) key format is 32 bytes as base64 (44 chars) or hex (64 chars) in CONSTRUCTOR_PII_KEY, fail-secure (throw naming the var, never a fallback), documented in .env.example with an openssl generation command.
- Alternatives considered: pre-existing consent_flag gate (rejected: consent capture and identity capture happen in the same operator moment — splitting them adds a failure window and double-entry friction, Article I/VII, with no privacy gain); keeping consent_flag = 1 after erasure (rejected: a truthy consent flag with no identity row misstates the GDPR position and would let a later save path skip re-consent).
- Reversibility: easy — the consent check and flag updates are localized to src/db/identity.ts and pinned by tests/identity.test.ts; switching semantics is a small, test-visible change while the table shape (locked, data-model.md) is untouched.
- Article-safety: confirmed no Article I–IX violation (IV strengthened: consent is atomic with identity, PII never in errors/logs, analytics proven queryable after erasure; II/V untouched; VIII: node:crypto built-in, no new deps).

---

## Agent decisions (YELLOW zone) — append below

### ADR-0011 — recommendation() input shape, branch precedence, and totality normalization (T006; adopts archived ADR-0006)
- Date: 2026-07-13
- Zone: YELLOW
- Context: data-model.md pins the thresholds (viewings ≥ 3 & offers = 0 → price; viewings < 3 → presentation; else hold) but leaves open (a) where the "€X βάσει comps" figure comes from, (b) precedence when viewings < 3 but offers exist (literal rule order would say "presentation" with live offers in hand), and (c) what a TOTAL function (Article VI) does with NaN/negative/non-finite inputs.
- Decision: ADOPT archived v1 ADR-0006 for (a) and (b): `recommendation({viewings, offers, compsTarget?})` — the comps € target is computed by the report layer (T016, which owns comps queries) and passed in; absent/invalid target → the price branch still emits a complete Greek recommendation without a figure. Presentation branch requires `offers = 0`; any unit with offers falls to "hold" (matches data-model's "otherwise (has offers / healthy)"). Euro formatting is a manual dot-separator `formatEuro()` (exported for T016 reuse), never `toLocaleString`/Intl — byte-identical on any host (Article III). NEW in this run, (c): non-finite or negative counts normalize to 0 = "no data", so garbage signals (NaN viewings + NaN offers) land in the presentation/action branch, never a complacent "hold" — under Article VI, bad data must prompt action, not "all fine". Fractional counts floor; compsTarget used only when finite and positive. Function never throws, including on a null/empty signals object.
- Alternatives considered: computing the comps target inside `recommendation()` (rejected: pulls DB access into a pure domain function); literal rule-order precedence (rejected: "staging refresh" on a unit with 2 live offers reads absurd in a builder-facing report); throwing RangeError on bad inputs like T004/T005 (rejected: those are capture-path validators where loud rejection is right; this is the REPORT path where Article VI forbids any input lacking a recommendation); NaN → "hold" via failed comparisons (rejected: silent garbage-in → "do nothing" is the exact Article VI failure mode).
- Reversibility: easy — signature, normalization helpers, and branch guards are localized in src/domain/recommend.ts and pinned by tests.
- Article-safety: confirmed no Article I–IX violation (III strengthened: ICU-free deterministic formatting, same input → byte-identical output pinned by test; VI strengthened: total function, non-empty Greek for any input; FR-11: output is Greek product surface).

### ADR-0012 — Greek display wording for stored enum keys + throw-on-unknown label lookup (T006a)
- Date: 2026-07-13
- Zone: YELLOW
- Context: FR-11 mandates Greek display via src/domain/labels.ts but no spec doc fixes the actual display strings. The stored keys mix English (Lead, Fallthrough, inquiry, hot…) and Greek (Επίσκεψη…); the English ones need real wording choices for a builder-facing surface. Also open: what a lookup does on a key with no label.
- Decision: Stage labels — Lead → "Νέος ενδιαφερόμενος", Fallthrough → "Απώλεια"; Greek-named stages/event-types display as themselves (Επίσκεψη, Προσφορά, Κράτηση, Συμβόλαιο). Event types — inquiry → "Εκδήλωση ενδιαφέροντος", viewing/offer/reservation/contract mirror their stage labels, fallthrough → "Απώλεια". Temperature — masculine forms "Θερμός/Χλιαρός/Ψυχρός" (they qualify ο ενδιαφερόμενος/αγοραστής, the natural Greek CRM register). Unknown key THROWS RangeError (per task brief), matching the capture-path convention (T004/T005) — a stored value without a label is a programming bug that must surface in tests, never leak an English key into a report. This does not conflict with ADR-0011's never-throw report policy: recommendation() is total over DATA quality; labels.ts throwing on a missing MAPPING is the FR-11 enforcement mechanism itself. Tests parse the enum universes out of schema.sql's own comment lines (first pipe-run in each column comment), so a schema enum addition without a label fails the suite automatically (verified by mutation: adding |tepid to the temperature comment turned the suite red).
- Alternatives considered: returning the raw key or an "Άγνωστο" placeholder on unknown keys (rejected: silent English/placeholder leak to a client-facing report is the exact FR-11 failure mode; loud failure in tests is the point); neuter temperature forms "Θερμό/Χλιαρό/Ψυχρό" (rejected: labels qualify the buyer/opportunity, masculine reads naturally on the board); hardcoding the enum lists in the test (rejected: task requires schema-drift auto-detection).
- Reversibility: easy — pure display strings in one map file; changing wording is a one-line edit pinned by tests that only assert non-empty Greek, not exact copy.
- Article-safety: confirmed no Article I–IX violation (FR-11 strengthened: no raw-key render path; III untouched — static maps, no locale APIs; VIII: zero deps).

### CHECKPOINT-0 REVIEW 2026-07-13 — ADR-0011 & ADR-0012 human-approved
- ADR-0011 (recommendation() totality: report path never throws, garbage signals → no-data action branch; capture path throws) — CONFIRMED as decided.
- ADR-0012 (Greek display wording) — CONFIRMED: keep v2 wording (Lead → "Νέος ενδιαφερόμενος", Fallthrough → "Απώλεια", temperatures Θερμός/Χλιαρός/Ψυχρός). v1 wording explicitly rejected. Binds T012 (web UI) and T014/T016 (reports): render these labels via labels.ts, do not re-open the wording.

### ADR-0013 — listPipeline deterministic ordering + closed-stage filter + forward-only stage semantics (T007; adopts archived ADR-0007)
- Date: 2026-07-13
- Zone: YELLOW
- Context: US-4 requires needs-attention-first board order but defines neither the signals nor their precedence; the task brief locks "forward only, never regresses" for stages but the spec does not say how Fallthrough fits a forward-only rank, what advanceOpportunity writes, or which offer amount a card shows.
- Decision: ADOPT archived v1 ADR-0007 verbatim for the board: total order = (1) temperature hot→warm→cold, (2) stage furthest along first (Κράτηση > Προσφορά > Επίσκεψη > Lead), (3) stalest `updated_at` first, (4) `id` ASC final tiebreak (strict total order — same input, same output); closed stages (Συμβόλαιο, Fallthrough) excluded from the board AND the live counter (outcomes, not work items). NEW in this run: (a) Fallthrough ranks ABOVE Συμβόλαιο in the forward-only rank, making it terminal-from-any-live-stage via `advanceOpportunity` — a loss can happen at any point in the funnel, but a closed opportunity (either outcome) can never advance again; (b) `advanceOpportunity` updates the opportunity row only and writes NO sales_event — reservation/contract event capture is explicitly Phase B (data-model.md), and synthesizing those events from a stage move would fake funnel data; (c) the board card's `offerAmount` is the LATEST offer event (highest-id), null before any offer; (d) event-logging writes never regress stage either: viewing floors the stage at Επίσκεψη, offer at Προσφορά, via max(current, floor); (e) all write functions accept an optional `at` ISO-8601 override (default `new Date().toISOString()`) so ordering/staleness behavior is deterministically testable (Article III-adjacent).
- Alternatives considered: pure staleness ordering / computed urgency score (both rejected in v1 ADR-0007 — buries hot offers, opaque to a 3-person team; nothing new argues otherwise); Fallthrough allowed only from late stages (rejected: a fresh Lead can be lost too, and forcing operators to fake-advance first would corrupt funnel data); advanceOpportunity emitting reservation/contract events (rejected: Phase B capture path, and a stage flip is not an event that happened in the field); showing MAX(offer) instead of latest (rejected: after a lower re-offer the card would show a dead higher number — the latest offer is the live negotiating position).
- Reversibility: easy — one ORDER BY + one WHERE + a rank constant in src/db/queries.ts, all pinned by re-pinnable tests.
- Article-safety: confirmed no Article I–IX violation (III: deterministic SQL ordering; IV: board joins buyers for pseudonym only, never buyer_identity; II: advance requires non-empty next_action like every write).

### ADR-0014 — Lead capture defaults + on-the-spot opportunity creation shape (T007; adopts archived ADR-0008)
- Date: 2026-07-13
- Zone: YELLOW
- Context: `opportunities.temperature` is NOT NULL but a new lead has no viewing interest to derive it from; open whether createLead logs a sales_event, what `next_owner` defaults to, and — for the locked grain edge case (viewing/offer with no prior opportunity CREATES it) — what stage/temperature the on-the-spot opportunity starts at.
- Decision: ADOPT archived v1 ADR-0008: new leads start `'warm'`; createLead appends an `'inquiry'` sales_event (funnel reconstructable from the append-only log, `v_separation` counts lead work); `next_owner` defaults to `handledBy`, overridable; pseudonym is `#<id>` with the id allocated explicitly (`MAX(id)+1` inside the write transaction) so pseudonym↔id can never diverge. NEW in this run: the on-the-spot opportunity created by logViewing/logOffer starts at that event's stage floor (Επίσκεψη / Προσφορά) with that event's temperature (derived from interest / forced hot) — it records the relationship as first observed, not a fictional Lead history. Viewings always set temperature to the LATEST interest signal (a hot buyer can cool to 'cold' after a bad viewing — temperature is current state, unlike stage which only moves forward); offers force 'hot' per data-model. The event's unit is mirrored into `opportunities.focus_unit_id` (COALESCE — an event without a unit leaves the existing focus untouched). Article IV guard: every write function rejects any input key matching name/phone/email/mail/tel at runtime before touching the DB.
- Alternatives considered: default temperature `'cold'` / no inquiry event (both rejected in v1 ADR-0008 — punishes the freshest record, under-reports lead work); creating on-the-spot opportunities at stage 'Lead' then advancing in the same write (rejected: two updates to fake a history nobody observed); temperature ratchet (only up) on viewings (rejected: data-model derives temperature from interest with no ratchet, and a stale 'hot' after a 1/5 viewing misleads the needs-attention sort).
- Reversibility: easy — default literals, one COALESCE, and a floor constant per event type; all pinned by tests.
- Article-safety: confirmed no Article I–IX violation (II: JS-trim guard before any DB write on every function, SQL CHECK as backstop; IV: PII-key runtime rejection, analytical fields only; V untouched; VIII: bun:sqlite direct, zero deps).

### ADR-0015 — Identity consent semantics, key encodings, and versioned AES-GCM blob layout (T008a; adopts archived ADR-0010)
- Date: 2026-07-13
- Zone: YELLOW
- Context: T008a leaves open (a) what "recorded consent" means for saveIdentity, (b) the accepted encoding of the 32-byte CONSTRUCTOR_PII_KEY, (c) the exact byte layout of the encrypted BLOB, and (d) upsert semantics for a re-saved identity.
- Decision: ADOPT archived v1 ADR-0010 in full: saveIdentity RECORDS consent itself — it requires a valid ISO consentDate (throws before any write, and before loading the key) and, in ONE transaction, sets buyers.consent_flag = 1 and writes the encrypted identity row; there is therefore no code path that creates an identity row without recorded consent (FR-14 holds by construction). eraseIdentity resets consent_flag to 0 (erasure = consent withdrawal; a re-save needs fresh consent) and deliberately needs NO encryption key — key loss can never block a GDPR erasure (mutation-verified: adding a key requirement to erase turns the suite red). Key: exactly 32 bytes from env CONSTRUCTOR_PII_KEY as base64 (exactly 44 chars) or hex (exactly 64 chars, either case); anything else — including unset/blank — throws naming the var; no fallback exists (mutation-verified: a `?? default` fallback turns the suite red). NEW in this run: (a) BLOB layout is VERSIONED — `[version 0x01][IV 12B][authTag 16B][ciphertext]` — so a future algorithm/layout change can coexist with old rows instead of being a one-way door; decrypt refuses unknown versions; (b) upsert is a FULL REPLACE (absent fields become NULL, consent_date replaced) so no stale PII survives a re-save; (c) saveIdentity requires at least one identity field and an existing buyer (no orphan/empty identity rows); (d) GCM auth failures are re-thrown with a fixed message naming only the env var — no node:crypto internals, never PII; no error in the module ever interpolates a PII value.
- Alternatives considered: pre-existing consent_flag gate (rejected in v1 ADR-0010: splits consent capture from identity capture into two calls with a failure window and double-entry friction — Article I/VII — for zero privacy gain); raw-bytes-only key without encoding validation (rejected: `Buffer.from(x, "base64")` is lenient and would silently accept truncated keys — the exact malformed-key fail-open the insecure-defaults skill targets); unversioned `IV||tag||ct` layout (rejected: encryption-at-rest data accumulates, and one leading byte now buys a reversible format later); merge-style upsert (rejected: fields the operator removed would silently keep old PII encrypted at rest).
- Reversibility: easy — semantics localized to src/db/identity.ts and pinned by tests/identity.test.ts; the versioned blob makes even the layout evolvable; table shape (locked, data-model.md) untouched.
- Article-safety: confirmed no Article I–IX violation (IV strengthened: consent atomic with identity, fail-secure key, PII never in errors, erasure key-free and proven to leave listPipeline/activityCounters/v_buyer_pool intact; III untouched; VIII: node:crypto built-in, zero new deps).

### ADR-0016 — Weak-model enforcement infrastructure (gates, hooks, zoning tree, knowledge layer)
- Date: 2026-07-13
- Zone: YELLOW (operator-requested; process infra, no Article touched — it ENFORCES them)
- Context: Audit finding: zero mechanical enforcement existed — every constitutional guarantee was prose a model chooses to obey. 20 judgment points mapped where weaker models (Opus/Sonnet) would regress silently (in-app LLM "helpfulness", fail-open PII key, ICU formatting, v_velocity reads, git add -A…).
- Decision: Executable-first rails: scripts/verify-gates.sh (12 gates incl. live whitespace CHECK probe + ruling-literal check + per-write guard presence), Claude PreToolUse hooks (.claude/hooks/ + settings.json) blocking RED paths/tokens pre-action, git hooks (core.hooksPath scripts/git-hooks) running gates on EVERY commit + message discipline, .claude/ZONING.md (Article X as first-match-wins literal triggers), docs/CODEBASE-KNOWLEDGE.md (conventions + traps), checklists (per-write, per-report), MODEL-OPERATIONS.md (routing + downshift protocol), CLAUDE.md v3 wiring it all into THE LOOP. Gate 5 refined after its first live run flagged Article IV enforcement comments (mutation-tested: still catches a planted JOIN).
- Alternatives considered: prose-only CLAUDE.md rules (rejected: the audit's core finding — skimmable under pressure); per-gate script files (rejected: one aggregated script is more maintainable, Article VIII).
- Reversibility: easy — delete the files, unset core.hooksPath; app code untouched.
- Article-safety: confirmed no Article I–IX violation; rails enforce II, III, IV, V, VI, IX mechanically.
