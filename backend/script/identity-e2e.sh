#!/usr/bin/env bash
# Can a human actually get verified? Deploys with a real AttestedVerifier,
# exchanges a session for an attestation over HTTP, submits it on-chain, and
# checks the sybil property still holds afterwards.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
RPC=http://127.0.0.1:8545
PORT=3015
FAILURES=0

DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ATTESTOR_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
D=$(cast wallet address $DEPLOYER_PK); ATT=$(cast wallet address $ATTESTOR_PK)

step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { local l=$1 got=$(echo "$2"|xargs) want=$(echo "$3"|xargs)
  if [ -z "$got" ] || [ -z "$want" ]; then printf "  \033[31m✗ %s INDETERMINATE\033[0m\n" "$l"; FAILURES=$((FAILURES+1)); return; fi
  [ "$got" = "$want" ] && printf "  \033[32m✓\033[0m %s\n" "$l" || { printf "  \033[31m✗ %s got=%s want=%s\033[0m\n" "$l" "$got" "$want"; FAILURES=$((FAILURES+1)); }; }
call() { cast call --rpc-url $RPC "$@" | sed 's/ \[.*\]//'; }
cleanup() { pkill -f "bun run src/index.ts" 2>/dev/null; pkill -f "anvil --silent" 2>/dev/null; }
trap cleanup EXIT

step "Deploying with a real AttestedVerifier"
pkill -f anvil 2>/dev/null; sleep 1
anvil --silent >/dev/null 2>&1 &
for _ in $(seq 1 60); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
(cd "$ROOT/contracts" && ATTESTOR=$ATT ALLOW_OVERWRITE=true DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast >/dev/null 2>&1) || { echo "deploy failed"; exit 1; }
J="$ROOT/contracts/deployments/31337.json"
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
REG=$(g PartyRegistry); VER=$(g PersonhoodVerifier)
ok "registry uses the attested verifier" "$(call $REG 'verifier()(address)')" "$VER"
ok "on-chain attestor is our key" "$(call $VER 'attestor()(address)')" "$ATT"

step "Starting the backend"
CHAIN_ID=31337 RPC_URL=$RPC ATTESTOR_PRIVATE_KEY=$ATTESTOR_PK \
  DANGEROUS_ATTEST_WITHOUT_WORLD=true PORT=$PORT \
  bun run src/index.ts > /tmp/arcasset-identity.log 2>&1 &
for _ in $(seq 1 40); do curl -sf http://localhost:$PORT/health >/dev/null 2>&1 && break; sleep 0.5; done

STATUS=$(curl -s http://localhost:$PORT/identity/status)
ok "attestor matches on-chain" "$(echo "$STATUS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["attestor"]["matches"])')" "True"
ok "domain separator matches on-chain" "$(echo "$STATUS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["domainSeparator"]["matches"])')" "True"
ok "the dangerous flag is reported" "$(echo "$STATUS" | python3 -c 'import json,sys;print("WARNING" in json.load(sys.stdin))')" "True"

step "A human gets verified"
API=http://localhost:$PORT REG=$REG RPC=$RPC bun run script/identity-buyer.ts
FAILURES=$((FAILURES + $?))

printf "\n"
[ "$FAILURES" -eq 0 ] && printf "\033[32mVERIFICATION WORKS END TO END\033[0m\n" || printf "\033[31m%d CHECK(S) FAILED\033[0m\n" "$FAILURES"
exit $FAILURES
