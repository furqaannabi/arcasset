import { hexToNumber, slice } from "viem";
import type { Account, Address, Hash, Hex, PublicClient, WalletClient } from "viem";
import { mandateAbi, relayAbi } from "@/chain/abis";
import type { StoredMandate } from "./source";
import type { Executor } from "./loop";

/**
 * Turns a decision into a transaction against ServicingRelay, and does not
 * return until the chain has said what happened.
 *
 * Two contracts, both of which refuse to let this key direct funds. The relay's
 * servicing fee goes to an address fixed at issuance and read from the note.
 * RepaymentMandate moves the borrower's money to the borrower's own note under
 * the borrower's own signature, with a nonce derived from the note and period
 * rather than chosen here. So a fully compromised key can grief and nothing
 * more — it can pay somebody's debt early, and that is the worst of it.
 */
export class ChainExecutor implements Executor {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly wallet: WalletClient,
    private readonly relay: Address,
    private readonly mandate: Address | null = null,
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
   * Present a mandate the borrower signed and let the contract pull it.
   *
   * The struct takes the signature split into v/r/s rather than as 65 bytes,
   * which is EIP-3009's shape and not ours to argue with. Some signers produce
   * a recovery id of 0 or 1 where the token expects 27 or 28; intel/settle.ts
   * normalises the same way for the same reason.
   */
  async collect(noteId: bigint, index: number, m: StoredMandate): Promise<Hash> {
    if (!this.mandate) throw new Error("no RepaymentMandate address configured");

    const r = slice(m.signature, 0, 32);
    const s = slice(m.signature, 32, 64);
    let v = hexToNumber(slice(m.signature, 64, 65));
    if (v < 27) v += 27;

    const { request } = await this.publicClient.simulateContract({
      address: this.mandate,
      abi: mandateAbi,
      functionName: "collect",
      args: [
        noteId,
        index,
        { value: m.value, validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore), v, r, s },
      ],
      account: this.wallet.account as Account,
    });

    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`collect reverted on-chain in ${hash}`);
    return hash;
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
