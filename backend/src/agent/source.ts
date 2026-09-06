import type { Address, PublicClient } from "viem";
import { noteAbi, noteFactoryAbi, relayAbi, vaultAbi } from "@/chain/abis";
import { NoteStatus, PeriodStatus } from "./decide";
import type { NoteView, PeriodView } from "./decide";

/**
 * Where the agent gets its view of the world.
 *
 * The interface exists so the decision loop does not care. Today the only
 * implementation reads contracts over RPC; when the subgraph lands it becomes
 * the read path and this one stays as the fallback that needs no indexer.
 * docs/01-architecture.md says the subgraph is the only read path, and that
 * remains the intent — this is what runs before there is one.
 */
export interface NoteSource {
  /** Notes this agent is delegated to service, with their unsettled periods. */
  serviceable(agent: Address): Promise<ServiceableNote[]>;
  /** How far behind the source is, in blocks. Zero for a direct RPC read. */
  lagBlocks(): Promise<number>;
  /**
   * The chain's clock, not this machine's.
   *
   * Every deadline the agent reasons about is compared against
   * block.timestamp by the contract, so deciding on wall time means deciding
   * with a different clock than the one that will judge the transaction. They
   * are close on a live chain and wildly apart on a warped test chain, which
   * is exactly where the difference is easiest to miss.
   */
  chainTime(): Promise<number>;
}

export type ServiceableNote = {
  note: NoteView;
  address: Address;
  periods: PeriodView[];
};

export class RpcNoteSource implements NoteSource {
  constructor(
    private readonly client: PublicClient,
    private readonly factory: Address,
    private readonly relay: Address,
    private readonly vault: Address,
  ) {}

  /** Direct reads are always at head, by definition. */
  async lagBlocks(): Promise<number> {
    return 0;
  }

  async chainTime(): Promise<number> {
    const block = await this.client.getBlock({ blockTag: "latest" });
    return Number(block.timestamp);
  }

  async serviceable(agent: Address): Promise<ServiceableNote[]> {
    const count = await this.client.readContract({
      address: this.factory,
      abi: noteFactoryAbi,
      functionName: "noteCount",
    });

    const out: ServiceableNote[] = [];
    for (let id = 1n; id <= count; id++) {
      const delegated = await this.client.readContract({
        address: this.relay,
        abi: relayAbi,
        functionName: "agentOf",
        args: [id],
      });
      if (delegated.toLowerCase() !== agent.toLowerCase()) continue;

      const noteAddress = await this.client.readContract({
        address: this.factory,
        abi: noteFactoryAbi,
        functionName: "noteOf",
        args: [id],
      });

      const loaded = await this.loadNote(id, noteAddress);
      if (loaded) out.push(loaded);
    }
    return out;
  }

  private async loadNote(id: bigint, address: Address): Promise<ServiceableNote | null> {
    const [status, terms, firstMissedAt] = await Promise.all([
      this.client.readContract({ address, abi: noteAbi, functionName: "status" }),
      this.client.readContract({ address, abi: noteAbi, functionName: "terms" }),
      this.client.readContract({ address, abi: noteAbi, functionName: "firstMissedAt" }),
    ]);

    if (status === NoteStatus.Matured || status === NoteStatus.Defaulted) return null;

    const note: NoteView = {
      noteId: id,
      status: status as NoteStatus,
      gracePeriod: Number(terms.gracePeriod),
      cureWindow: Number(terms.cureWindow),
      firstMissedAt: Number(firstMissedAt),
    };

    const periods: PeriodView[] = [];
    for (let i = 0; i < terms.periodCount; i++) {
      const index = i as number;
      const [bounds, due, paid, pstatus] = await Promise.all([
        this.client.readContract({ address, abi: noteAbi, functionName: "periodBounds", args: [index] }),
        this.client.readContract({ address, abi: noteAbi, functionName: "periodDue", args: [index] }),
        // Paid comes from the vault, which is the contract value actually moved
        // through. The note mirrors it, but the vault is the one that counted.
        this.client.readContract({ address: this.vault, abi: vaultAbi, functionName: "paidOf", args: [id, index] }),
        this.client.readContract({ address, abi: noteAbi, functionName: "periodStatus", args: [index] }),
      ]);
      if (pstatus === PeriodStatus.Settled || pstatus === PeriodStatus.Cured) continue;
      periods.push({
        index,
        end: Number(bounds[1]),
        due,
        paid,
        status: pstatus as PeriodStatus,
      });
    }

    return { note, address, periods };
  }
}
