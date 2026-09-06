#!/usr/bin/env bash
# The paid API, end to end, against a fork of Arc testnet so the USDC is the
# real Circle FiatToken with real EIP-3009 — not a mock that agrees with us.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
RPC=http://127.0.0.1:8545
PORT=3012

DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ORIG_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
BORR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
AGENT_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
# A freshly generated buyer, not an Anvil default. The well-known keys have
# EIP-7702 delegations set on public testnets by other people, which makes them
# contracts — and a contract signer takes the ERC-1271 path in Circle's
# SignatureChecker rather than ecrecover. That cost an afternoon.
BUYER_PK=$(cast wallet new --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["private_key"])')
D=$(cast wallet address $DEPLOYER_PK); O=$(cast wallet address $ORIG_PK)
B=$(cast wallet address $BORR_PK); A=$(cast wallet address $AGENT_PK)
BUYER=$(cast wallet address $BUYER_PK)

step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
call() { cast call --rpc-url $RPC "$@" | sed 's/ \[.*\]//'; }
send() { cast send --rpc-url $RPC --private-key "$1" "${@:2}" >/dev/null; }
fund() { cast rpc --rpc-url $RPC anvil_setBalance "$1" "$(python3 -c "print(hex(10**24))")" >/dev/null; }
cleanup() { pkill -f "bun run src/index.ts" 2>/dev/null; pkill -f "anvil --fork-url" 2>/dev/null; }
trap cleanup EXIT

# Arc's USDC cannot be exercised on a fork: its transfers go through node-level
# precompiles at 0x1800...0000/0001 which have no bytecode, so Anvil can read
# balances and never move them. A local token with Circle's exact domain and
# typehash is what makes this test repeatable.
step "Starting anvil with a local EIP-3009 token"
pkill -f "anvil" 2>/dev/null; sleep 1
anvil --silent >/dev/null 2>&1 &
for _ in $(seq 1 60); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
for a in $D $O $B $A $BUYER; do fund "$a"; done
USDC=$(cd "$ROOT/contracts" && forge create script/MockEIP3009Token.sol:MockEIP3009Token \
  --rpc-url $RPC --private-key $DEPLOYER_PK --broadcast --json 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["deployedTo"])')
send $DEPLOYER_PK $USDC 'mint(address,uint256)' $BUYER 1000000000
echo "  token $USDC, buyer holds $(call $USDC 'balanceOf(address)(uint256)' $BUYER) (6dp)"

step "Deploying and building a borrower with a repayment record"
(cd "$ROOT/contracts" && ALLOW_OVERWRITE=true DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC --broadcast >/dev/null 2>&1) || { echo "deploy failed"; exit 1; }
J="$ROOT/contracts/deployments/31337.json"
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
REG=$(g PartyRegistry); QUEUE=$(g IssuanceQueue); FACTORY=$(g NoteFactory)
VAULT=$(g RepaymentVault); RELAY=$(g ServicingRelay)

send $DEPLOYER_PK $REG 'verify(address,bytes)' $O "$(cast abi-encode 'f(address,bytes32)' $O $(cast keccak o))"
send $DEPLOYER_PK $REG 'verify(address,bytes)' $B "$(cast abi-encode 'f(address,bytes32)' $B $(cast keccak b))"
NOW=$(cast block latest --rpc-url $RPC -f timestamp)
send $ORIG_PK $QUEUE 'propose((address,uint256,uint16,uint16,uint16,uint64,uint64,uint64,uint64,address),bytes32,string)' \
  "($B,100000000000000000000000,100,50,3,300,60,600,$((NOW+86400)),$O)" "$(cast keccak doc)" "ipfs://m"
send $BORR_PK $QUEUE 'accept(uint256)' 1
send $DEPLOYER_PK $QUEUE 'approve(uint256)' 1
send $ORIG_PK $QUEUE 'mint(uint256)' 1
NOTE=$(call $FACTORY 'noteOf(uint256)(address)' 1)
send $ORIG_PK $RELAY 'delegate(uint256,address)' 1 $A

DUE=$(call $NOTE 'periodDue(uint16)(uint256)' 0)
send $BORR_PK --value $DUE $VAULT 'repay(uint256,uint16)' 1 0
END=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 0 | tail -1)
cast rpc --rpc-url $RPC evm_setNextBlockTimestamp "$END" >/dev/null && cast rpc --rpc-url $RPC evm_mine >/dev/null
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0
echo "  borrower $B has 1 settled period on 1 note"

step "Starting the backend with the paid API configured"
CHAIN_ID=31337 RPC_URL=$RPC AGENT_PRIVATE_KEY=$AGENT_PK INTEL_PAY_TO=$O USDC_ERC20=$USDC \
  TICK_INTERVAL_MS=600000 DEFAULT_DRY_RUN=true PORT=$PORT \
  bun run src/index.ts > /tmp/arcasset-x402.log 2>&1 &
for _ in $(seq 1 40); do curl -sf http://localhost:$PORT/health >/dev/null 2>&1 && break; sleep 0.5; done
echo "  /intel/pricing available: $(curl -s http://localhost:$PORT/intel/pricing | python3 -c 'import json,sys;print(json.load(sys.stdin)["available"])')"

RPC_URL=$RPC API=http://localhost:$PORT BUYER_KEY=$BUYER_PK TARGET=$B CHAIN_ID=31337 USDC_ERC20=$USDC \
  bun run script/x402-buyer.ts
