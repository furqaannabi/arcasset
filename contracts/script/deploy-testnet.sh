#!/usr/bin/env bash
# Deploy to Arc testnet and verify on Blockscout, in one command.
#
#   ./script/deploy-testnet.sh --keystore ~/.foundry/keystores/<name>
#   ./script/deploy-testnet.sh --private-key 0x...
#
# Anything after the signer flags is passed through to forge script.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-https://rpc.testnet.arc.network}
# Blockscout v11, Etherscan-compatible endpoint. No API key required.
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

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  "$@"

echo
echo "Deployed. Addresses written to deployments/$CHAIN.json:"
python3 -m json.tool "deployments/$CHAIN.json"
echo
echo "Explorer: https://testnet.arcscan.app/address/<address>"
