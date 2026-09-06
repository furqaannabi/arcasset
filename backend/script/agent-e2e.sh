#!/usr/bin/env bash
# Does the agent actually service a note, unattended, against real contracts?
#
# Sets up a note on a local Anvil, delegates it to the agent's key, repays a
# period, then starts the backend and does nothing further. If the period ends
# up settled, the agent did it.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
RPC=http://127.0.0.1:8545
FAILURES=0

DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ORIG_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
BORR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
AGENT_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
DEPLOYER=$(cast wallet address $DEPLOYER_PK)
ORIG=$(cast wallet address $ORIG_PK)
BORR=$(cast wallet address $BORR_PK)
AGENT=$(cast wallet address $AGENT_PK)

step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { local l=$1 got=$(echo "$2"|xargs) want=$(echo "$3"|xargs)
  if [ -z "$got" ] || [ -z "$want" ]; then printf "  \033[31m✗ %s INDETERMINATE\033[0m\n" "$l"; FAILURES=$((FAILURES+1)); return; fi
  [ "$got" = "$want" ] && printf "  \033[32m✓\033[0m %s\n" "$l" || { printf "  \033[31m✗ %s got=%s want=%s\033[0m\n" "$l" "$got" "$want"; FAILURES=$((FAILURES+1)); }; }
call() { cast call --rpc-url $RPC "$@" | sed 's/ \[.*\]//'; }
send() { cast send --rpc-url $RPC --private-key "$1" "${@:2}" >/dev/null; }
fund() { cast rpc --rpc-url $RPC anvil_setBalance "$1" "$(python3 -c "print(hex(10**25))")" >/dev/null; }

cleanup() { pkill -f "bun run src/index.ts" 2>/dev/null; pkill -f "anvil --silent" 2>/dev/null; }
trap cleanup EXIT

step "Starting anvil"
pkill -f "anvil --silent" 2>/dev/null; sleep 1
anvil --silent >/dev/null 2>&1 &
for _ in $(seq 1 30); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.3; done
for a in $DEPLOYER $ORIG $BORR $AGENT; do fund "$a"; done

step "Deploying"
(cd "$ROOT/contracts" && ALLOW_OVERWRITE=true DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC --broadcast >/dev/null 2>&1) || { echo "deploy failed"; exit 1; }
J="$ROOT/contracts/deployments/31337.json"
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
REG=$(g PartyRegistry); QUEUE=$(g IssuanceQueue); FACTORY=$(g NoteFactory)
VAULT=$(g RepaymentVault); RELAY=$(g ServicingRelay)

step "Creating a note delegated to the agent"
send $DEPLOYER_PK $REG 'verify(address,bytes)' $ORIG "$(cast abi-encode 'f(address,bytes32)' $ORIG $(cast keccak orig))"
send $DEPLOYER_PK $REG 'verify(address,bytes)' $BORR "$(cast abi-encode 'f(address,bytes32)' $BORR $(cast keccak borr))"
NOW=$(cast block latest --rpc-url $RPC -f timestamp)
TERMS="($BORR,100000000000000000000000,100,50,3,300,60,600,$((NOW+86400)),$ORIG)"
send $ORIG_PK $QUEUE 'propose((address,uint256,uint16,uint16,uint16,uint64,uint64,uint64,uint64,address),bytes32,string)' "$TERMS" "$(cast keccak doc)" "ipfs://m"
send $BORR_PK $QUEUE 'accept(uint256)' 1
send $DEPLOYER_PK $QUEUE 'approve(uint256)' 1
send $ORIG_PK $QUEUE 'mint(uint256)' 1
NOTE=$(call $FACTORY 'noteOf(uint256)(address)' 1)
send $ORIG_PK $RELAY 'delegate(uint256,address)' 1 $AGENT
ok "agent is the delegate" "$(call $RELAY 'agentOf(uint256)(address)' 1)" "$AGENT"

step "Borrower repays period 0, then the period ends"
DUE=$(call $NOTE 'periodDue(uint16)(uint256)' 0)
send $BORR_PK --value $DUE $VAULT 'repay(uint256,uint16)' 1 0
END=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 0 | tail -1)
cast rpc --rpc-url $RPC evm_setNextBlockTimestamp "$END" >/dev/null
cast rpc --rpc-url $RPC evm_mine >/dev/null
ok "period 0 still unsettled before the agent runs" "$(call $NOTE 'periodStatus(uint16)(uint8)' 0)" "0"

step "Starting the backend — nothing is touched from here on"
AGENT_BEFORE=$(cast balance $AGENT --rpc-url $RPC | sed 's/ \[.*\]//')
CHAIN_ID=31337 RPC_URL=$RPC AGENT_PRIVATE_KEY=$AGENT_PK TICK_INTERVAL_MS=2000 \
  DEFAULT_DRY_RUN=true PORT=3011 \
  bun run src/index.ts > /tmp/arcasset-agent.log 2>&1 &
for _ in $(seq 1 40); do curl -sf http://localhost:3011/health >/dev/null 2>&1 && break; sleep 0.5; done

SETTLED=0
for i in $(seq 1 30); do
  if [ "$(call $NOTE 'periodStatus(uint16)(uint8)' 0)" = "1" ]; then SETTLED=1; echo "  settled after ~$((i))s"; break; fi
  sleep 1
done
ok "agent settled period 0 unattended" "$SETTLED" "1"
ok "note still Active" "$(call $NOTE 'status()(uint8)')" "0"
ok "vault emptied" "$(call $VAULT 'balanceOf(uint256)(uint256)' 1)" "0"
FEE=$(python3 -c "print($DUE * 50 // 10000)")
ok "fee reached the recipient, not the agent" "$(call $NOTE 'totalDistributed()(uint256)')" "$(python3 -c "print($DUE - $FEE)")"
AGENT_AFTER=$(cast balance $AGENT --rpc-url $RPC | sed 's/ \[.*\]//')
python3 -c "
before, after = $AGENT_BEFORE, $AGENT_AFTER
print('  \033[32m✓\033[0m agent spent gas and gained nothing' if after < before else f'  \033[31m✗ agent did not spend gas (before={before} after={after})\033[0m')
"

step "The agent's own account of what it did"
curl -s "http://localhost:3011/agent/log?limit=4" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for l in d.get('log',[])[:4]:
    tx=(l.get('tx') or '')[:12]
    print(f\"  note {l['noteId']} period {l['period']}: {l['decision']:10} {l['reason'][:58]} {tx}\")
"

printf "\n"
[ "$FAILURES" -eq 0 ] && printf "\033[32mAGENT WORKS UNATTENDED\033[0m\n" || printf "\033[31m%d CHECK(S) FAILED\033[0m\n" "$FAILURES"
exit $FAILURES
