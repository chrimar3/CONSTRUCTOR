#!/usr/bin/env bash
# One-command project state — run at session start and after any context compaction.
# State lives in git, never in conversation memory.
cd "$(cd "$(dirname "$0")/.." && pwd)"
echo "branch:    $(git branch --show-current)"
echo "last task: $(git log --oneline | grep -oE '^\S+ T[0-9]+[a-z]?' | head -1 || echo '(none)')"
echo "HEAD:      $(git log --oneline -1)"
DIRTY=$(git status --porcelain)
if [ -z "$DIRTY" ]; then echo "tree:      clean"; else printf 'tree:      DIRTY\n%s\n' "$DIRTY"; fi
echo "tests:     $(bun test 2>&1 | grep -oE '[0-9]+ (pass|fail)' | tr '\n' ' ')"
echo "next:      first task after 'last task' in specs/001-sales-pipeline-mvp/tasks.md"
