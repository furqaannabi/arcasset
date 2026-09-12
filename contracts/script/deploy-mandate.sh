#!/usr/bin/env bash
# Replace RepaymentMandate alone, leaving the other seven contracts in place.
#
#   ./script/deploy-mandate.sh --keystore ~/.foundry/keystores/<name>
#   ./script/deploy-mandate.sh --private-key 0x...
#
# Use this rather than deploy-testnet.sh when only the mandate has changed.
# The full script redeploys everything, and everything downstream is wired with
# immutables: a fresh PartyRegistry means every verified human verifies again,
# a fresh NoteFactory orphans every note already minted, and the subgraph
# reindexes from a new start block. None of that is needed to change how a
# repayment is authorised.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-https://rpc.testnet.arc.network}
VERIFIER_URL=${VERIFIER_URL:-https://testnet.arcscan.app/api}
CHAIN=5042002

if [ $# -eq 0 ]; then
  echo "usage: $0 --keystore <path> | --private-key <0x...>  [extra forge args]" >&2
  exit 64
fi

# Confirm the chain is the one we think it is before spending anything.
ACTUAL=$(cast chain-id --rpc-url "$RPC")
if [ "$ACTUAL" != "$CHAIN" ]; then
  echo "refusing to deploy: RPC reports chain $ACTUAL, expected $CHAIN" >&2
  exit 1
fi

BEFORE=$(python3 -c "import json;print(json.load(open('deployments/$CHAIN.json'))['RepaymentMandate'])")
echo "replacing RepaymentMandate $BEFORE"
echo

forge script script/DeployMandate.s.sol:DeployMandate \
  --rpc-url "$RPC" \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  "$@"

AFTER=$(python3 -c "import json;print(json.load(open('deployments/$CHAIN.json'))['RepaymentMandate'])")
echo
echo "RepaymentMandate $BEFORE -> $AFTER"
echo "https://testnet.arcscan.app/address/$AFTER"
echo
echo "Still to do, in this order:"
echo "  1. subgraph: bun run sync:check && bun run deploy:studio   (it is a data source)"
echo "  2. web:      rebuild — addresses are injected at build time"
echo "  3. backend:  restart — it reads deployments/$CHAIN.json at startup"
