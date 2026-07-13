#!/usr/bin/env python3
"""PreToolUse guard for Edit/Write — protects binding documents and one-way doors.
Exit 2 blocks; stderr shown to the model."""
import json, sys

data = json.load(sys.stdin)
path = (data.get("tool_input") or {}).get("file_path", "") or ""
norm = path.replace("\\", "/")

def blocked(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)

# Specs + constitution are human-owned. One sanctioned exception (T013: quickstart checklist).
if "/.specify/" in norm:
    blocked("BLOCKED: .specify/ (constitution + templates) is human-owned. A change here is RED — stop and ask the human (Article X).")
if "/specs/" in norm and not norm.endswith("/quickstart.md"):
    blocked("BLOCKED: specs/ is the human-owned source of truth. If your task genuinely requires a spec change, that is RED — stop and ask (Article X). Only quickstart.md accepts the T013 checklist append.")

# Schema is a one-way door once data exists — route through the human.
if norm.endswith("src/db/schema.sql"):
    blocked("BLOCKED: src/db/schema.sql is a one-way door (Article X RED). Schema changes require a human RULING recorded in DECISIONS.md; they are applied by the operator session, and data-model.md must be amended in the same ruling to stay verbatim.")

# The gates themselves are protected from convenient edits.
if norm.endswith("scripts/verify-gates.sh") or "/.claude/hooks/" in norm or "/scripts/git-hooks/" in norm:
    blocked("BLOCKED: gates/hooks are process infrastructure. If a gate seems wrong, tell the human why — never adjust the gate to make work pass (fix the cause, not the check).")

# Content-level RED tokens for product source (Article III / IV / Phase-B scope).
if "/src/" in norm or norm.startswith("src/"):
    import re
    ti = data.get("tool_input") or {}
    content = " ".join(str(ti.get(k, "")) for k in ("content", "new_string"))
    for pat, msg in [
        (r"api\.anthropic|anthropic|openai|generativelanguage|claude -p",
         "BLOCKED (Article III RED): LLM/API reference in product source. Insights are human-run via /insights — the app never calls an LLM."),
        (r"(env|process\.env)[.\[]['\"]?\w*(KEY|SECRET|TOKEN|PII|PASS)\w*['\"]?\]?\s*(\|\||\?\?)",
         "BLOCKED (Article IV RED): fail-open default on a secret-shaped env var. The app must crash without proper config — never run with a default key (insecure-defaults skill)."),
        (r"v_velocity|marketing_assets",
         "BLOCKED (Phase-B scope RED): v_velocity/marketing_assets are schema stubs — no reads or capture paths in the prototype (plan.md deferred list). Stop and ask if a task seems to require this."),
    ]:
        if re.search(pat, content, re.IGNORECASE):
            blocked(msg)

sys.exit(0)
