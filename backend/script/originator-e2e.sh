#!/usr/bin/env bash
# Does the originator scorecard show an originator covering their own borrower's
# miss? That is the field the price is justified by, and it is invisible to
# anyone who is not the servicer.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
RPC=http://127.0.0.1:8545
PORT=3021

DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ORIG_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
BORR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
AGENT_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
BUYER_PK=$(cast wallet new --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["private_key"])')
D=$(cast wallet address $DEPLOYER_PK); O=$(cast wallet address $ORIG_PK)
B=$(cast wallet address $BORR_PK); A=$(cast wallet address $AGENT_PK)
BUYER=$(cast wallet address $BUYER_PK)

step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
call() { cast call --rpc-url $RPC "$@" | sed 's/ \[.*\]//'; }
send() { cast send --rpc-url $RPC --private-key "$1" "${@:2}" >/dev/null; }
fund() { cast rpc --rpc-url $RPC anvil_setBalance "$1" "$(python3 -c "print(hex(10**24))")" >/dev/null; }
warp() { cast rpc --rpc-url $RPC evm_setNextBlockTimestamp "$1" >/dev/null; cast rpc --rpc-url $RPC evm_mine >/dev/null; }
cleanup() { pkill -f "bun run src/index.ts" 2>/dev/null; pkill -f "anvil --silent" 2>/dev/null; }
trap cleanup EXIT

step "Anvil, contracts, and a local EIP-3009 token"
pkill -f anvil 2>/dev/null; sleep 1
anvil --silent >/dev/null 2>&1 &
for _ in $(seq 1 60); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
for a in $D $O $B $A $BUYER; do fund "$a"; done
(cd "$ROOT/contracts" && ALLOW_OVERWRITE=true DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast >/dev/null 2>&1) || { echo "deploy failed"; exit 1; }
J="$ROOT/contracts/deployments/31337.json"
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
REG=$(g PartyRegistry); QUEUE=$(g IssuanceQueue); FACTORY=$(g NoteFactory)
VAULT=$(g RepaymentVault); RELAY=$(g ServicingRelay)
USDC=$(cd "$ROOT/contracts" && forge create script/MockEIP3009Token.sol:MockEIP3009Token \
  --rpc-url $RPC --private-key $DEPLOYER_PK --broadcast --json 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["deployedTo"])')
BUYER2_PK=$(cast wallet new --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["private_key"])')
BUYER2=$(cast wallet address $BUYER2_PK); fund "$BUYER2"
send $DEPLOYER_PK $USDC 'mint(address,uint256)' $BUYER 1000000000
send $DEPLOYER_PK $USDC 'mint(address,uint256)' $BUYER2 1000000000

step "A note that goes delinquent, and is cured by the originator"
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

# period 0: the borrower pays, on time
DUE0=$(call $NOTE 'periodDue(uint16)(uint256)' 0)
send $BORR_PK --value $DUE0 $VAULT 'repay(uint256,uint16)' 1 0
warp "$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 0 | tail -1)"
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0

# period 1: the borrower does not pay, the agent marks it, the ORIGINATOR covers it
END1=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 1 | tail -1)
warp "$((END1 + 120))"
send $AGENT_PK $RELAY 'markDelinquent(uint256,uint16)' 1 1
echo "  period 1 marked: status $(call $NOTE 'periodStatus(uint16)(uint8)' 1) (2 = Missed)"
DUE1=$(call $NOTE 'periodDue(uint16)(uint256)' 1)
send $ORIG_PK --value $DUE1 $VAULT 'repay(uint256,uint16)' 1 1     # <- the originator, not the borrower
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 1
echo "  after the originator paid: status $(call $NOTE 'periodStatus(uint16)(uint8)' 1) (3 = Cured)"

step "Buying the originator's scorecard"
CHAIN_ID=31337 RPC_URL=$RPC AGENT_PRIVATE_KEY=$AGENT_PK INTEL_PAY_TO=$D USDC_ERC20=$USDC \
  TICK_INTERVAL_MS=600000 DEFAULT_DRY_RUN=true PORT=$PORT DEPLOY_BLOCK=0 \
  bun run src/index.ts > /tmp/arcasset-originator.log 2>&1 &
for _ in $(seq 1 40); do curl -sf http://localhost:$PORT/health >/dev/null 2>&1 && break; sleep 0.5; done

RPC_URL=$RPC API=http://localhost:$PORT BUYER_KEY=$BUYER_PK TARGET=$O CHAIN_ID=31337 USDC_ERC20=$USDC \
  TARGET_PATH=originator EXPECT_SELF_CURED=1 EXPECT_SELF_CURE_RATE=1 \
  bun run script/x402-buyer.ts
ORIG_RESULT=$?

step "Buying the note's timeline"
RPC_URL=$RPC API=http://localhost:$PORT BUYER_KEY=$BUYER2_PK \
  TARGET=$NOTE CHAIN_ID=31337 USDC_ERC20=$USDC TARGET_PATH=note TARGET_SUFFIX=/timeline \
  EXPECT_SELF_CURE_EVENT=true EXPECT_LATENESS=true \
  bun run script/x402-buyer.ts
exit $(( ORIG_RESULT + $? ))
