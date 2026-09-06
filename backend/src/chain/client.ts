import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet } from "viem/chains";
import type { Chain, Hex, PublicClient, WalletClient } from "viem";

/**
 * Arc's own chains come from viem. Anything else is assumed to be a local node,
 * which is the only other thing we ever point at.
 */
export function chainFor(chainId: number): Chain {
  if (chainId === arc.id) return arc;
  if (chainId === arcTestnet.id) return arcTestnet;
  return defineChain({
    id: chainId,
    name: `local-${chainId}`,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  });
}

export function publicClientFor(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({ chain: chainFor(chainId), transport: http(rpcUrl) });
}

export function walletClientFor(chainId: number, rpcUrl: string, key: Hex): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: chainFor(chainId),
    transport: http(rpcUrl),
  });
}
