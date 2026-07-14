#!/usr/bin/env bash
# Daily rolling backup of constructor.db → ~/constructor-backups/ (7-day retention).
# FAIL-CLOSED: a missing or suspiciously small DB is SKIPPED (logged), never backed
# up — an empty-DB backup that rotates out the good ones amplifies loss instead of
# preventing it. Pruning happens only AFTER a verified new backup exists.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DB="$REPO/constructor.db"
DEST="$HOME/constructor-backups"
LOG="$DEST/backup.log"
MIN_BYTES=40960   # a freshly-initialized schema is ~73KB; anything smaller is wrong
KEEP=7

mkdir -p "$DEST"
stamp() { date "+%Y-%m-%d %H:%M:%S"; }
note() { printf '%s %s\n' "$(stamp)" "$1" >> "$LOG"; }

if [ ! -f "$DB" ]; then
  note "SKIP: no constructor.db at $DB (nothing to back up — fail-closed)"
  exit 0
fi
SIZE=$(stat -f%z "$DB" 2>/dev/null || echo 0)
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  note "SKIP: constructor.db is ${SIZE}B (< ${MIN_BYTES}B floor) — refusing to rotate good backups against a suspect DB"
  exit 0
fi

OUT="$DEST/constructor-$(date +%Y%m%d-%H%M%S).db"
# sqlite3 .backup is WAL-safe (consistent snapshot even mid-write); plain cp is not.
if ! sqlite3 "$DB" ".backup '$OUT'"; then
  note "FAIL: sqlite3 .backup returned non-zero — no pruning performed"
  rm -f "$OUT"
  exit 1
fi
# Verify the snapshot is a healthy database before trusting it.
if [ "$(sqlite3 "$OUT" "PRAGMA integrity_check;" 2>/dev/null)" != "ok" ]; then
  note "FAIL: integrity_check on snapshot failed — snapshot discarded, no pruning"
  rm -f "$OUT"
  exit 1
fi
gzip -f "$OUT"
note "OK: $(basename "$OUT").gz ($(stat -f%z "$OUT.gz")B from ${SIZE}B live)"

# Prune to the newest $KEEP — only reachable after a verified success above.
ls -t "$DEST"/constructor-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" && note "PRUNE: $(basename "$old")"
done
exit 0
