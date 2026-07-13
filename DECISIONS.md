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
