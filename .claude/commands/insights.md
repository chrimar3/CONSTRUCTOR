---
description: Turn a report insight brief into 2–3 Greek insight lines for a builder report (runs interactively under Max — no API key).
argument-hint: "[paste the --brief output, or leave empty and paste when asked]"
---

You are writing the **insight lines** for a client-facing progress report that our agency sends to a construction-firm client (εργολάβος) every two weeks. Our agency is the builder's outsourced sales department.

Input — the deterministic insight brief produced by `bun run report --brief`:

$ARGUMENTS

If the brief above is empty, ask the operator to paste it, then continue.

Write **exactly 2–3 sentences, in Greek**, that a builder would read at the top of the report. Follow these rules strictly:

1. **Never a naked bad number.** Every cold unit, zero-offer, or slowing metric MUST be paired with a concrete recommendation or the action we are taking. "0 προσφορές" alone is forbidden; "0 προσφορές — σήμα ότι η τιμή είναι ~8% πάνω από τα comps, προτείνουμε προσαρμογή" is right.
2. **Only use facts present in the brief.** Do not invent numbers, comps, buyer counts, or trends. If the brief lacks comps, say so plainly ("ανεπαρκή εσωτερικά comps ακόμα") rather than fabricating.
3. **Tone:** professional, calm, builder-facing. Proof-of-work and next-step, not hype. English technical terms are fine where natural, but the sentences are Greek.
4. **Lead with the signal that matters most** (a hot unit with an offer, or a cold unit needing a price/presentation decision), not a generic summary.
5. Output only the 2–3 sentences — no preamble, no headers. The operator reviews them and pastes them into the report before it is sent.

After writing, add one line prefixed with `— review:` flagging anything the operator should double-check (e.g. a recommended price that needs their sign-off). This line is for the operator, not the client.
