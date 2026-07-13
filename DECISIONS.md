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

## Agent decisions (YELLOW zone) — append below

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
