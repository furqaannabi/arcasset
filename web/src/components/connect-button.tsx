"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { Button, Dot } from "./ui";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <Button
        tone="primary"
        disabled={!connector || isPending}
        onClick={() => connector && connect({ connector })}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  // Wrong network blocks, it does not fail silently — docs/05-web.md.
  if (chainId !== CHAIN.id) {
    return (
      <Button
        tone="secondary"
        className="border-warn/50 text-warn"
        onClick={() => switchChain({ chainId: CHAIN.id })}
      >
        Switch to {CHAIN.name}
      </Button>
    );
  }

  return (
    <Button tone="secondary" title={address} onClick={() => disconnect()}>
      <span className="inline-flex items-center gap-2">
        <Dot tone="accent" />
        {address ? shortAddress(address) : ""}
      </span>
    </Button>
  );
}
