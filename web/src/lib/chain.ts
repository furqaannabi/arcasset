import type { Chain } from "viem";
import { arc, arcTestnet } from "viem/chains";

/**
 * One supported chain at a time — see docs/05-web.md ("Wallet and network").
 * Selected by env so local/demo builds differ only in configuration.
 */
export const CHAIN: Chain =
  process.env.NEXT_PUBLIC_CHAIN === "arc" ? arc : arcTestnet;

/** wagmi wants a non-empty tuple, not an array. */
export const CHAINS = [CHAIN] as const;

/** Optional override; falls back to the chain's public RPC. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || CHAIN.rpcUrls.default.http[0];

export const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

/**
 * Notes settle in Arc's NATIVE currency, which is USDC with 18 decimals
 * (viem/chains: arcTestnet). Gas and settlement are therefore the same asset —
 * there is no ERC-20 approve step anywhere in the app.
 *
 * Named rather than inlined so a chain whose native decimals differ cannot
 * silently shift every amount in the UI by twelve orders of magnitude.
 */
export const SETTLEMENT_DECIMALS = CHAIN.nativeCurrency.decimals; // 18 on Arc
export const NATIVE_DECIMALS = SETTLEMENT_DECIMALS;

export const EXPLORER_URL = CHAIN.blockExplorers?.default.url ?? "";

export function txUrl(hash: string) {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : "";
}

export function addressUrl(address: string) {
  return EXPLORER_URL ? `${EXPLORER_URL}/address/${address}` : "";
}
