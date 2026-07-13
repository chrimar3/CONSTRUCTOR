#!/usr/bin/env bash
# Constitution gates — EXECUTABLE. Run before every commit and before claiming
# any task done: bash scripts/verify-gates.sh
# Every gate maps to an Article. A FAIL here is a constitution violation —
# fix the cause, never the gate. Exit 0 = all gates pass.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=1; }

# ── Gate 1 (Article IX): full test suite ────────────────────────────────────
OUT=$(bun test 2>&1); RC=$?
COUNTS=$(printf '%s' "$OUT" | grep -oE '[0-9]+ (pass|fail)' | tr '\n' ' ')
if [ $RC -eq 0 ] && ! printf '%s' "$OUT" | grep -qE '[1-9][0-9]* fail'; then
  pass "bun test — $COUNTS"
else
  fail "bun test — $COUNTS(run 'bun test' for details)"
fi

# ── Gate 2 (Article II): whitespace next_action rejected at RAW SQL ─────────
if [ -f src/db/schema.sql ]; then
  PROBE=$(bun -e '
    import { Database } from "bun:sqlite";
    const db = new Database(":memory:");
    db.exec(await Bun.file("src/db/schema.sql").text());
    db.exec("PRAGMA foreign_keys = OFF");
    let bad = 0;
    for (const v of ["", "  ", "\t", "\n\t", "\r\n"]) {
      try {
        db.run("INSERT INTO sales_events (opportunity_id, event_type, event_date, handled_by, next_action) VALUES (1,?,?,?,?)", ["inquiry","2026-01-01","Χρήστος",v]);
        bad++;
      } catch {}
      try {
        db.run("INSERT INTO opportunities (project_id, buyer_id, stage, temperature, next_action, next_owner, updated_at) VALUES (1,1,?,?,?,?,?)", ["Lead","warm",v,"Χρήστος","2026-01-01"]);
        bad++;
      } catch {}
    }
    console.log(bad === 0 ? "OK" : "ACCEPTED " + bad + " whitespace next_actions");
  ' 2>&1)
  [ "$PROBE" = "OK" ] && pass "Article II — all whitespace next_action variants rejected by CHECK" \
                      || fail "Article II — $PROBE"
else
  fail "Article II — src/db/schema.sql missing"
fi

# ── Gate 3 (Article III): no LLM call in-app ────────────────────────────────
if grep -riqE 'anthropic|claude -p|api\.anthropic|openai' src/ 2>/dev/null; then
  fail "Article III — LLM/API reference found in src/: $(grep -rilE 'anthropic|claude -p|openai' src/ | tr '\n' ' ')"
else
  pass "Article III — no LLM/API references in src/"
fi

# ── Gate 4 (Article III): report determinism — no wall-clock in report path ─
if [ -d src/report ]; then
  if grep -rnE 'Date\.now\(\)|new Date\(\)' src/report/ 2>/dev/null | grep -q .; then
    fail "Article III — wall-clock call (Date.now()/argless new Date()) in src/report/; inject --as-of instead"
  elif grep -rnE 'toLocaleString|Intl\.' src/report/ src/domain/ 2>/dev/null | grep -q .; then
    fail "Article III — ICU-dependent formatting in report/domain (byte determinism)"
  else
    pass "Article III — report path free of wall-clock/ICU formatting"
  fi
else
  pass "Article III — report path (not built yet)"
fi

# ── Gate 5 (Article IV): buyer_identity isolated to the identity module ─────
# Match actual SQL usage (FROM/JOIN/INTO/UPDATE/DELETE/SELECT), not comments or
# the Article IV enforcement error-strings that legitimately NAME the table.
LEAKS=$(grep -rnE '(FROM|JOIN|INTO|UPDATE|DELETE[[:space:]]+FROM)[[:space:]]+buyer_identity|SELECT[^;]*[[:space:]]buyer_identity' src/ 2>/dev/null | grep -v 'src/db/schema.sql' | grep -v 'src/db/identity.ts' || true)
[ -z "$LEAKS" ] && pass "Article IV — no SQL touches buyer_identity outside schema + identity module" \
                || fail "Article IV — buyer_identity SQL outside identity module: $(echo "$LEAKS" | head -2 | tr '\n' ' ')"

# ── Gate 6 (Article IV): no fail-open PII key fallback ──────────────────────
if grep -rnE 'CONSTRUCTOR_PII_KEY[^\n]*(\|\||\?\?)' src/ 2>/dev/null | grep -q .; then
  fail "Article IV — fail-open fallback on CONSTRUCTOR_PII_KEY (must crash when missing)"
else
  pass "Article IV — PII key has no fallback default"
fi

# ── Gate 6b (Article II, JP-1): schema CHECKs carry the literal ruling text ─
if [ -f src/db/schema.sql ]; then
  N=$(grep -cF "length(trim(next_action, ' ' || char(9) || char(10) || char(13))) > 0" src/db/schema.sql || true)
  [ "$N" -eq 2 ] && pass "Article II — both schema CHECKs match the RULING 2026-07-13 literal" \
                 || fail "Article II — expected 2 strengthened CHECKs in schema.sql, found $N (RULING 2026-07-13)"
fi

# ── Gate 6c (Article II/IV, JP-2/17): every queries.ts write carries guards ─
if [ -f src/db/queries.ts ]; then
  MISSING=$(bun -e '
    const src = await Bun.file("src/db/queries.ts").text();
    const fns = [...src.matchAll(/export function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    const writes = fns.filter(([, name, body]) => /INSERT INTO|UPDATE /.test(body));
    const bad = writes.filter(([, name, body]) =>
      !/assertNextAction\(/.test(body) || !/assertNoPiiKeys\(/.test(body)
    ).map(([, name]) => name);
    console.log(bad.join(" "));
  ' 2>/dev/null)
  [ -z "$MISSING" ] && pass "Article II/IV — every write function calls assertNextAction + assertNoPiiKeys" \
                    || fail "Article II/IV — write fn(s) missing guards: $MISSING"
fi

# ── Gate 6d (scope, JP-16): Phase-B surfaces stay dark ──────────────────────
PB=$(grep -rnE "v_velocity|marketing_assets|'reservation'|'contract'" src/ 2>/dev/null | grep -v 'src/db/schema.sql' | grep -viE '^\s*//|Phase B|deferred' || true)
[ -z "$PB" ] && pass "scope — no Phase-B reads/captures (v_velocity, marketing_assets, reservation/contract)" \
             || fail "scope — Phase-B token outside schema: $(echo "$PB" | head -3 | tr '\n' ' ')"

# ── Gate 6e (Article IV, JP-12 broad): no fail-open secret anywhere ─────────
FO=$(grep -rnE '(env|process\.env)[.\[][\"'"'"']?\w*(KEY|SECRET|TOKEN|PII|PASS)\w*[\"'"'"']?\]?\s*(\|\||\?\?)' src/ 2>/dev/null || true)
[ -z "$FO" ] && pass "Article IV — no secret-shaped env var has a fallback default" \
             || fail "Article IV — fail-open secret default: $(echo "$FO" | head -2 | tr '\n' ' ')"

# ── Gate 7 (FR-11): labels module + guard test present ──────────────────────
if [ -f src/domain/labels.ts ] && [ -f tests/labels.test.ts ]; then
  pass "FR-11 — labels module + schema-parsing guard test present"
else
  [ -f src/domain/labels.ts ] || fail "FR-11 — src/domain/labels.ts missing"
fi

# ── Gate 8 (process): clean tree required to claim done ─────────────────────
DIRTY=$(git status --porcelain)
[ -z "$DIRTY" ] && pass "process — working tree clean" \
                || printf 'WARN  process — tree not clean (fine mid-task, must be clean at claim time):\n%s\n' "$DIRTY"

echo "──────────────────────────────────────────"
if [ $FAIL -eq 0 ]; then echo "ALL GATES PASS"; else echo "GATES FAILED — do not commit, do not claim done"; fi
exit $FAIL
