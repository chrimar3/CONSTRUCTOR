# Quickstart — 001 · Sales Pipeline MVP

Prerequisites: Bun installed (`curl -fsSL https://bun.sh/install | bash`).

```bash
bun install
bun run db:init                 # create pipeline.db from schema
bun run seed seed.example.json  # Day-0: load an existing pipeline (board is never empty)
bun run dev                     # start API + web; open the printed localhost URL on a phone viewport
```

Verify the loop:

1. **Capture** — tap "+ Lead" / "+ Επίσκεψη" / "+ Προσφορά". Confirm each completes in <30s and that submit is blocked until a next-action is set.
2. **Pipeline** — confirm the board updates and sorts "needs action" first; offer entry shows the auto-counter.
3. **Report** —
   ```bash
   bun run report --builder="Παπαδόπουλος" --project="Κυψέλη-Α" --period=biweekly
   bun run report --builder="Παπαδόπουλος" --project="Κυψέλη-Α" --period=monthly
   bun run report --separation
   ```
   Confirm Greek output, deterministic numbers, and no naked bad numbers.

Run tests:
```bash
bun test
```

Expected: all green; `VERIFICATION.md` maps SC-1..SC-6 to evidence.
