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
