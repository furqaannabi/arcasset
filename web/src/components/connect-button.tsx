"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/chain";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <button
        disabled={!connector || isPending}
        onClick={() => connector && connect({ connector })}
        className="rounded border border-current px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  // Wrong network blocks, it does not fail silently — docs/05-web.md.
  if (chainId !== CHAIN.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: CHAIN.id })}
        className="rounded border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-600"
      >
        Switch to {CHAIN.name}
      </button>
    );
  }

  return (
    <button
      onClick={() => disconnect()}
      title={address}
      className="rounded border border-current px-3 py-1.5 font-mono text-sm"
    >
      {address ? shortAddress(address) : ""}
    </button>
  );
}
