#!/usr/bin/env bash
# DESIGN-LOOP mechanical gates (Benchmarks A) — the scripted, binary rail the
# loop runs every round. Seeds an ISOLATED fixture DB (never constructor.db),
# captures the canonical frames with the puppeteer-core harness, runs the
# determinism suite, and scores the mechanical gates.
#
# Round 0 (baseline): records the failing-gates list and still proceeds to
# judging. Elevation rounds: a FAIL here blocks the round from reaching the
# panel — pass --enforce to make this script exit non-zero on any gate fail.
set -uo pipefail
cd "$(dirname "$0")/.."

ENFORCE=0
[ "${1:-}" = "--enforce" ] && ENFORCE=1

# Load CONSTRUCTOR_PII_KEY etc. (gitignored .env) so the server can start.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

OUT="${DESIGN_OUT:-artifacts/design/round-0}"

echo "▸ capture — driving the SPA + rendering reports (390x844@2x, single theme)"
bun scripts/design/capture.ts || { echo "CAPTURE FAILED"; exit 1; }

echo "▸ determinism suite — bun test"
if bun test >/dev/null 2>&1; then
  echo "  bun test: GREEN"
else
  echo "  bun test: RED — determinism/suite gate fails"
  ENFORCE_SUITE_FAIL=1
fi

echo "▸ mechanical gates"
bun scripts/design/gates.ts
GATES_EXIT=$?

echo "▸ gates.json → $OUT/gates.json"
if [ "$ENFORCE" = "1" ] && { [ "$GATES_EXIT" != "0" ] || [ "${ENFORCE_SUITE_FAIL:-0}" = "1" ]; }; then
  echo "GATES FAIL (--enforce): round blocked from judging."
  exit 1
fi
exit 0
