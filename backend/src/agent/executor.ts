import type { Account, Address, Hash, Hex, PublicClient, WalletClient } from "viem";
import { relayAbi } from "@/chain/abis";
import type { Executor } from "./loop";

/**
 * Turns a decision into a transaction against ServicingRelay, and does not
 * return until the chain has said what happened.
 *
 * The relay is the only contract this reaches, and it cannot direct funds — the
 * servicing fee goes to an address fixed at issuance, read from the note. So a
 * fully compromised key here can grief and nothing more.
 */
export class ChainExecutor implements Executor {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly wallet: WalletClient,
    private readonly relay: Address,
  ) {}

  get address(): Address {
    return (this.wallet.account as Account).address;
  }

  async gasBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  settlePeriod(noteId: bigint, index: number): Promise<Hash> {
    return this.send("settlePeriod", [noteId, index]);
  }

  markDelinquent(noteId: bigint, index: number): Promise<Hash> {
    return this.send("markDelinquent", [noteId, index]);
  }

  markDefaulted(noteId: bigint): Promise<Hash> {
    return this.send("markDefaulted", [noteId]);
  }

  /**
   * Simulate, send, then wait for the receipt.
   *
   * Simulating first turns a would-be revert into a thrown error before a
   * transaction is signed, so the common case under lag — the contract saying
   * "already settled" — costs nothing rather than gas.
   *
   * Waiting for the receipt is the point of this method. The agent confirms by
   * receipt and never by re-reading state, because a read can lag behind the
   * chain and an agent that polls to learn whether its own transaction landed
   * will eventually send it twice.
   */
  private async send(
    functionName: "settlePeriod" | "markDelinquent" | "markDefaulted",
    args: readonly unknown[],
  ): Promise<Hash> {
    const { request } = await this.publicClient.simulateContract({
      address: this.relay,
      abi: relayAbi,
      functionName,
      args: args as never,
      account: this.wallet.account as Account,
    });

    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") {
      throw new Error(`${functionName} reverted on-chain in ${hash}`);
    }
    return hash;
  }
}

export function privateKeyFrom(env: string | undefined): Hex | null {
  if (!env) return null;
  const key = env.startsWith("0x") ? env : `0x${env}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("AGENT_PRIVATE_KEY is set but is not a 32-byte hex key");
  }
  return key as Hex;
}
