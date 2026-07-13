#!/usr/bin/env python3
"""PreToolUse guard for Bash — blocks constitution/process violations before they run.
Exit 2 blocks the call; stderr is shown to the model as correction."""
import json, re, sys

data = json.load(sys.stdin)
cmd = (data.get("tool_input") or {}).get("command", "") or ""

BLOCKS = [
    # (pattern, message)
    (r"git\s+add\s+(-A\b|--all\b|\.\s*($|&&|;))",
     "BLOCKED: stage by explicit path (git add <paths>) — never git add -A/--all/. (process rule, CLAUDE.md)"),
    (r"git\s+(commit|merge|push)[^\n]*--no-verify",
     "BLOCKED: --no-verify skips gates — run bash scripts/verify-gates.sh and fix the cause instead."),
    (r"git\s+push[^\n]*(--force\b|-f\b)",
     "BLOCKED: force-push forbidden — history is the audit trail (Article IX)."),
    (r"rm\s+(-\w*r\w*f|-\w*f\w*r)\w*\s+(/|~|\"?/Users/chrism\"?\s*$)",
     "BLOCKED: recursive delete outside the repo."),
    (r"git\s+(checkout|switch)\s+master\b.*&&.*git\s+(commit|merge)|git\s+push[^\n]*\borigin\s+master\b",
     "BLOCKED: direct writes to master during the rebuild — work lands on rebuild/agentic-v2; master merges happen at human-approved checkpoints only."),
    (r"(curl|wget)[^\n]*(api\.anthropic|api\.openai)",
     "BLOCKED: Article III — no LLM API calls in this project, including from scripts."),
    (r"DROP\s+TABLE|DELETE\s+FROM\s+buyers\b|DELETE\s+FROM\s+opportunities\b|DELETE\s+FROM\s+sales_events\b",
     "BLOCKED: destructive DB statement outside a migration/test context — if intentional, ask the human (RED: one-way door). buyer_identity deletion is allowed ONLY via eraseIdentity()."),
]

for pat, msg in BLOCKS:
    if re.search(pat, cmd, re.IGNORECASE):
        print(msg, file=sys.stderr)
        sys.exit(2)
sys.exit(0)
