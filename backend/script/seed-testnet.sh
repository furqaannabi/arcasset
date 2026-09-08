#!/usr/bin/env bash
# Seeds one note on Arc testnet with the history the demo needs.
#
# Real transactions on the live deployment: it spends testnet gas, writes public
# state, and permanently verifies two freshly generated wallets. Run it
# deliberately.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=3099

cleanup() { [ -n "${BE_PID:-}" ] && kill "$BE_PID" 2>/dev/null; }
trap cleanup EXIT

FUNDER_KEY=$(python3 -c "
import pathlib
for l in pathlib.Path('.env').read_text().splitlines():
    if l.startswith('AGENT_PRIVATE_KEY='):
        v=l.partition('=')[2].strip().strip('\"')
        print(v if v.startswith('0x') else '0x'+v); break
")

# World needs a phone, so the seeded parties are verified through the bypass on
# a throwaway instance. The running dev server keeps its gate.
DANGEROUS_ATTEST_WITHOUT_WORLD=true PORT=$PORT bun run src/index.ts > /tmp/arcasset-seed.log 2>&1 &
BE_PID=$!
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done

API="http://localhost:$PORT" FUNDER_KEY="$FUNDER_KEY" bun run script/seed-testnet.ts
