# ZONING.md — Article X decision tree (literal triggers, first match wins)

Run this top-to-bottom on EVERY proposed change before acting. Default is RED.
No taste required: match the triggers literally.

```
STEP 0 — GREEN. Change is only inside src/tests implementation and touches none of
         the files/tokens/behaviors in STEPS 1–3 (naming, layout, comments, test
         structure, error-handling style, Bun/TS idioms).
         → Act freely. No log.

STEP 1 — RED by FILE PATH. Adds/edits/deletes any of:
   • .specify/**  (constitution, templates, scripts)
   • specs/**     (except the ONE sanctioned quickstart.md checklist append, T013)
   • src/db/schema.sql            (one-way door: table shape/CHECK/index/view)
   • DECISIONS.md sections "Inherited (locked)" or "Standing human rulings"
   • .claude/workflows/*.js task briefs · scripts/verify-gates.sh · .claude/hooks/**
   → STOP and ask the human.
   (Appending a NEW ADR to "Agent decisions (YELLOW)" is NOT this — that is the
    sanctioned YELLOW logging action itself.)

STEP 2 — RED by TOKEN / DEPENDENCY. Introduces into src/ or package.json:
   • anthropic · openai · api.anthropic · "claude -p" · generativelanguage ·
     cohere · mistral · fetch()/Bun.fetch to any non-localhost host   (Article III)
   • any runtime dependency beyond {react, react-dom, lucide-react} that is an
     external service/SDK or makes network calls                      (Article X.d)
   • v_velocity · marketing_assets · reservation/contract capture · ilist · auth ·
     hosting · multi-tenant · portal syndication                      (Phase B scope)
   → STOP and ask.

STEP 3 — RED by BEHAVIOR CHANGE. Alters any of:
   • counter() determinism (the 0.6 VALUE is YELLOW; DETERMINISM is RED)
   • recommendation() throwing, or returning "hold"/healthy for zero/NaN/negative
     signals                                                          (Article VI)
   • report determinism: new Date()/Date.now()/Math.random()/toLocaleString/Intl
     anywhere in src/report or src/domain                             (Article III)
   • PII encryption algorithm, key source, fail-secure crash, the consent gate,
     or making eraseIdentity require a key                            (Article IV)
   • any analytical/report/api query referencing buyer_identity       (Article IV)
   • weakening an Article II CHECK, assertNextAction, or assertNoPiiKeys
   • grain UNIQUE(buyer_id,project_id) · STAGE_RANK ordering · forward-only stage ·
     temperature derivation                                (one-way doors: history
                                                            accumulates on them)
   • removing/coarsening micro_area anywhere                          (Article V)
   → STOP and ask.

STEP 4 — YELLOW. None of 1–3 fired, but there is a real trade-off:
   • a Bun-ecosystem, non-network dependency
   • a data shape the spec left OPEN (seed JSON shape, board-ordering precedence,
     an unnamed card field, input shapes)
   • interpreting a genuinely ambiguous requirement
   • deviating from a spec SUGGESTION toward a better constitution-honoring option
   → ACT autonomously, then append an ADR to DECISIONS.md "Agent decisions
     (YELLOW)" BEFORE the commit, and include DECISIONS.md in the commit.

STEP 5 — Still unsure? → RED. Ask.
```

Two disambiguations models get wrong:
- labels.ts THROWS on unknown key while recommendation() NEVER throws — not a
  contradiction. Capture/label paths throw on programmer error (missing mapping);
  the report path is total over DATA quality. Do not unify them.
- DECISIONS.md: appending a new numbered ADR under "Agent decisions (YELLOW)" is
  the normal YELLOW mechanic. Touching the locked/rulings sections is RED.
