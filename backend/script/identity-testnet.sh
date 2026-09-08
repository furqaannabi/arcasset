#!/usr/bin/env bash
# Everything the browser flow does, except the World handshake.
#
# Runs against the LIVE Arc testnet deployment with the real attestor key, so it
# proves the part that cannot be checked from a laptop without a phone: that an
# attestation this backend signs is accepted by the deployed AttestedVerifier
# and recorded by the deployed PartyRegistry.
#
# The World step is skipped via DANGEROUS_ATTEST_WITHOUT_WORLD, on a throwaway
# port and a throwaway backend instance — the flag is never written to .env, so
# the running dev server keeps its gate.
#
# Each run uses a fresh wallet, which under the bypass means a fresh nullifier,
# so runs never collide. It does spend a little testnet gas and it does write
# public state.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
RPC=${RPC_URL:-https://rpc.testnet.arc.network}
PORT=3099
FAILURES=0

ok() { local l=$1; shift; if "$@" >/dev/null 2>&1; then printf "  \033[32m✓\033[0m %s\n" "$l"; else printf "  \033[31m✗ %s\033[0m\n" "$l"; FAILURES=$((FAILURES+1)); fi; }
cleanup() { [ -n "${BE_PID:-}" ] && kill "$BE_PID" 2>/dev/null; }
trap cleanup EXIT

REG=$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/5042002.json'))['PartyRegistry'])")
VER=$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/5042002.json'))['PersonhoodVerifier'])")
printf "\n\033[1mAgainst the live testnet deployment\033[0m\n"
echo "  registry $REG"
echo "  verifier $VER"

# A funder: the deployer pays the new wallet's gas.
FUNDER_KEY=$(python3 -c "
import pathlib
for l in pathlib.Path('.env').read_text().splitlines():
    if l.startswith('AGENT_PRIVATE_KEY='):
        v=l.partition('=')[2].strip().strip('\"')
        print(v if v.startswith('0x') else '0x'+v); break
")

printf "\n\033[1mStarting a throwaway backend with the World step bypassed\033[0m\n"
DANGEROUS_ATTEST_WITHOUT_WORLD=true PORT=$PORT bun run src/index.ts > /tmp/arcasset-identity-testnet.log 2>&1 &
BE_PID=$!
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -s "http://localhost:$PORT/identity/status" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('  attestor matches on-chain:', d['attestor']['matches'])
print('  domain   matches on-chain:', d['domainSeparator']['matches'])
print('  ⚠', d.get('WARNING','(no bypass warning — unexpected)'))
"

printf "\n\033[1mA fresh wallet goes through the whole flow\033[0m\n"
API="http://localhost:$PORT" REG="$REG" RPC="$RPC" FUNDER_KEY="$FUNDER_KEY" bun run script/identity-testnet.ts
exit $?
