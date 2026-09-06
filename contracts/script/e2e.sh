#!/usr/bin/env bash
# End-to-end against a live Anvil node, driven with cast — real transactions,
# real receipts, real event logs. The Foundry tests prove the contracts; this
# proves the deployment, the wiring, and the sequence a human will actually run.
#
# Usage:  ./script/e2e.sh            (starts and stops its own anvil)
#         RPC=http://... ./script/e2e.sh   (against an already-running node)
set -uo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-http://127.0.0.1:8545}
OWN_ANVIL=0
FAILURES=0

# Anvil's deterministic accounts.
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ORIG_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
BORR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
AGENT_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
BUYER_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
DEPLOYER=$(cast wallet address $DEPLOYER_PK)
ORIG=$(cast wallet address $ORIG_PK)
BORR=$(cast wallet address $BORR_PK)
AGENT=$(cast wallet address $AGENT_PK)
BUYER=$(cast wallet address $BUYER_PK)

step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
# Assertions fail loudly and never pass on empty. A check that silently
# compares nothing to nothing is worse than no check at all.
ok() {
  local label=$1 got=$2 want=$3
  got=$(echo "$got" | tr 'A-Z' 'a-z' | xargs)
  want=$(echo "$want" | tr 'A-Z' 'a-z' | xargs)
  if [ -z "$got" ] || [ -z "$want" ]; then
    printf "  \033[31m✗ %s — INDETERMINATE (empty value)\033[0m\n" "$label"; FAILURES=$((FAILURES+1)); return
  fi
  if [ "$got" = "$want" ]; then printf "  \033[32m✓\033[0m %s\n" "$label"
  else printf "  \033[31m✗ %s\n      got  %s\n      want %s\033[0m\n" "$label" "$got" "$want"; FAILURES=$((FAILURES+1)); fi
}
reverts() {
  local label=$1; shift
  if "$@" >/dev/null 2>&1; then
    printf "  \033[31m✗ %s — succeeded but should have reverted\033[0m\n" "$label"; FAILURES=$((FAILURES+1))
  else printf "  \033[32m✓\033[0m %s (reverted)\n" "$label"; fi
}
send() { cast send --rpc-url "$RPC" --private-key "$1" "${@:2}" >/dev/null; }
# cast decorates numbers with a scientific-notation suffix — "1e23 [1e23]" —
# which poisons string comparison and shell arithmetic alike. Strip it once,
# here, rather than at forty call sites.
call() { cast call --rpc-url "$RPC" "$@" | sed 's/ \[.*\]//'; }
# Bash arithmetic is 64-bit signed and silently wraps above ~9.2e18. Every
# amount here is 18-decimal, so all of it is out of range — do the maths in
# python or get plausible-looking nonsense.
bn() { python3 -c "print(int($1))"; }
# Anvil funds accounts with 10,000 ETH; a 100,000-face note needs more.
fund() { cast rpc --rpc-url "$RPC" anvil_setBalance "$1" "$(python3 -c "print(hex(10**25))")" >/dev/null; }
warp_to() { cast rpc --rpc-url "$RPC" evm_setNextBlockTimestamp "$1" >/dev/null; cast rpc --rpc-url "$RPC" evm_mine >/dev/null; }

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  step "Starting anvil"
  anvil --silent >/dev/null 2>&1 &
  OWN_ANVIL=1
  for _ in $(seq 1 30); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.3; done
fi
cleanup() { [ "$OWN_ANVIL" = 1 ] && pkill -f "anvil --silent" 2>/dev/null; }
trap cleanup EXIT

for a in $DEPLOYER $ORIG $BORR $AGENT $BUYER; do fund "$a"; done

step "1. Deploy and wire"
DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" --broadcast >/dev/null 2>&1 || { echo "deploy failed"; exit 1; }
CHAIN=$(cast chain-id --rpc-url "$RPC")
J=deployments/$CHAIN.json
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
REG=$(g PartyRegistry); QUEUE=$(g IssuanceQueue); FACTORY=$(g NoteFactory)
VAULT=$(g RepaymentVault); RELAY=$(g ServicingRelay); OFFER=$(g Offering)
ok "factory wired to vault" "$(call $FACTORY 'vault()(address)')" "$VAULT"
ok "factory wired to relay" "$(call $FACTORY 'relay()(address)')" "$RELAY"
ok "vault wired to relay"   "$(call $VAULT 'relay()(address)')" "$RELAY"

step "2. Both parties pass personhood"
send $DEPLOYER_PK $REG 'verify(address,bytes)' $ORIG "$(cast abi-encode 'f(address,bytes32)' $ORIG $(cast keccak "human-orig"))"
send $DEPLOYER_PK $REG 'verify(address,bytes)' $BORR "$(cast abi-encode 'f(address,bytes32)' $BORR $(cast keccak "human-borr"))"
ok "originator verified" "$(call $REG 'isVerified(address)(bool)' $ORIG)" "true"
ok "borrower verified"   "$(call $REG 'isVerified(address)(bool)' $BORR)" "true"
reverts "one human cannot claim a second address" \
  cast send --rpc-url "$RPC" --private-key $DEPLOYER_PK $REG 'verify(address,bytes)' $BUYER \
    "$(cast abi-encode 'f(address,bytes32)' $BUYER $(cast keccak "human-orig"))"

step "3. Propose"
NOW=$(cast block latest --rpc-url "$RPC" -f timestamp)
DEADLINE=$((NOW + 86400))
PRINCIPAL=100000000000000000000000   # 100,000 at 18dp
TERMS="($BORR,$PRINCIPAL,100,50,3,600,120,600,$DEADLINE,$ORIG)"
DOC=$(cast keccak "the signed agreement")
send $ORIG_PK $QUEUE 'propose((address,uint256,uint16,uint16,uint16,uint64,uint64,uint64,uint64,address),bytes32,string)' "$TERMS" "$DOC" "ipfs://manifest"
PID=$(call $QUEUE 'proposalCount()(uint256)')
ok "proposal created" "$PID" "1"
ok "status Proposed" "$(call $QUEUE 'statusOf(uint256)(uint8)' $PID)" "0"
reverts "admin cannot approve before the borrower accepts" \
  cast send --rpc-url "$RPC" --private-key $DEPLOYER_PK $QUEUE 'approve(uint256)' $PID
reverts "originator cannot accept for the borrower" \
  cast send --rpc-url "$RPC" --private-key $ORIG_PK $QUEUE 'accept(uint256)' $PID

step "4. Borrower accepts, admin approves"
send $BORR_PK $QUEUE 'accept(uint256)' $PID
ok "status Accepted" "$(call $QUEUE 'statusOf(uint256)(uint8)' $PID)" "1"
send $DEPLOYER_PK $QUEUE 'approve(uint256)' $PID
ok "status Approved" "$(call $QUEUE 'statusOf(uint256)(uint8)' $PID)" "2"

step "5. Mint"
send $ORIG_PK $QUEUE 'mint(uint256)' $PID
NOTE=$(call $FACTORY 'noteOf(uint256)(address)' 1)
ok "status Minted" "$(call $QUEUE 'statusOf(uint256)(uint8)' $PID)" "3"
ok "note is Active" "$(call $NOTE 'status()(uint8)')" "0"
ok "originator holds the whole supply" "$(call $NOTE 'balanceOf(address)(uint256)' $ORIG)" "$PRINCIPAL"
send $ORIG_PK $RELAY 'delegate(uint256,address)' 1 $AGENT
ok "agent delegated" "$(call $RELAY 'agentOf(uint256)(address)' 1)" "$AGENT"

step "6. Originator lists 25% at 97, a buyer takes it"
QUARTER=25000000000000000000000
send $ORIG_PK $NOTE 'approve(address,uint256)' $OFFER $QUARTER
send $ORIG_PK $OFFER 'list(uint256,uint256,uint16)' 1 $QUARTER 9700
COST=$(call $OFFER 'costOf(uint256,uint256)(uint256)' 1 $QUARTER)
ok "priced at 97% of par" "$COST" "24250000000000000000000"
reverts "wrong payment is refused" \
  cast send --rpc-url "$RPC" --private-key $BUYER_PK --value 1 $OFFER 'buy(uint256,uint256)' 1 $QUARTER
send $BUYER_PK --value $COST $OFFER 'buy(uint256,uint256)' 1 $QUARTER
ok "buyer holds 25%" "$(call $NOTE 'balanceOf(address)(uint256)' $BUYER)" "$QUARTER"
ok "originator kept 75%" "$(call $NOTE 'balanceOf(address)(uint256)' $ORIG)" "75000000000000000000000"

step "7. Borrower repays period 0"
DUE=$(call $NOTE 'periodDue(uint16)(uint256)' 0)
send $BORR_PK --value $DUE $VAULT 'repay(uint256,uint16)' 1 0
ok "vault holds the repayment" "$(call $VAULT 'balanceOf(uint256)(uint256)' 1)" "$DUE"
reverts "agent cannot settle before the period ends" \
  cast send --rpc-url "$RPC" --private-key $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0

step "8. Period ends; the agent settles, unattended"
END=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 0 | tail -1)
warp_to "$END"
reverts "a stranger cannot settle" \
  cast send --rpc-url "$RPC" --private-key $BUYER_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0
AGENT_BEFORE=$(cast balance $AGENT --rpc-url "$RPC")
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0
ok "period 0 Settled" "$(call $NOTE 'periodStatus(uint16)(uint8)' 0)" "1"
FEE=$(bn "$DUE * 50 // 10000")
ok "fee reached the recipient fixed at issuance" "$(call $NOTE 'totalDistributed()(uint256)')" "$(bn "$DUE - $FEE")"
ok "vault emptied" "$(call $VAULT 'balanceOf(uint256)(uint256)' 1)" "0"
reverts "settling twice reverts (idempotent by contract)" \
  cast send --rpc-url "$RPC" --private-key $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 0

step "9. Holders claim"
NET=$(bn "$DUE - $FEE")
ok "buyer owed a quarter"     "$(call $NOTE 'claimable(address)(uint256)' $BUYER)" "$(bn "$NET // 4")"
ok "originator owed the rest" "$(call $NOTE 'claimable(address)(uint256)' $ORIG)" "$(bn "$NET * 3 // 4")"
send $BUYER_PK $NOTE 'claim()'
ok "buyer's claim is settled" "$(call $NOTE 'claimable(address)(uint256)' $BUYER)" "0"

step "10. Period 1 is missed; the agent marks it, unprompted"
END1=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 1 | tail -1)
warp_to "$((END1 + 30))"
reverts "cannot mark delinquent inside grace" \
  cast send --rpc-url "$RPC" --private-key $AGENT_PK $RELAY 'markDelinquent(uint256,uint16)' 1 1
warp_to "$((END1 + 200))"
send $AGENT_PK $RELAY 'markDelinquent(uint256,uint16)' 1 1
ok "period 1 Missed" "$(call $NOTE 'periodStatus(uint16)(uint8)' 1)" "2"
ok "note is Delinquent" "$(call $NOTE 'status()(uint8)')" "1"

step "11. A third party cures the miss"
DUE1=$(call $NOTE 'periodDue(uint16)(uint256)' 1)
send $DEPLOYER_PK --value $DUE1 $VAULT 'repay(uint256,uint16)' 1 1
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 1
ok "period 1 Cured, not Settled" "$(call $NOTE 'periodStatus(uint16)(uint8)' 1)" "3"
ok "note back to Active" "$(call $NOTE 'status()(uint8)')" "0"

step "12. Final period matures the note"
DUE2=$(call $NOTE 'periodDue(uint16)(uint256)' 2)
send $BORR_PK --value $DUE2 $VAULT 'repay(uint256,uint16)' 1 2
END2=$(call $NOTE 'periodBounds(uint16)(uint64,uint64)' 2 | tail -1)
warp_to "$END2"
send $AGENT_PK $RELAY 'settlePeriod(uint256,uint16)' 1 2
ok "note Matured" "$(call $NOTE 'status()(uint8)')" "2"
reverts "a matured note refuses further servicing" \
  cast send --rpc-url "$RPC" --private-key $AGENT_PK $RELAY 'markDefaulted(uint256)' 1

printf "\n"
if [ "$FAILURES" -eq 0 ]; then printf "\033[32mALL CHECKS PASSED\033[0m\n"; else printf "\033[31m%d CHECK(S) FAILED\033[0m\n" "$FAILURES"; fi
exit $FAILURES
