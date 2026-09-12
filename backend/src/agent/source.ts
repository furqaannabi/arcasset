import type { Address, Hex, PublicClient } from "viem";
import { mandateAbi, noteAbi, noteFactoryAbi, relayAbi, usdcAllowanceAbi, vaultAbi } from "@/chain/abis";
import { prisma } from "@/db";
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

/**
 * A mandate as the agent needs it: the window and amount to decide with, and
 * the signature to act with.
 *
 * `decide` sees only the first three — it must not be able to spend anything,
 * and a pure function holding a signature is a pure function one refactor away
 * from being impure.
 */
export type PeriodMandate = {
  /**
   * "signed" carries a single-use EIP-3009 instrument. "standing" is a permit
   * the borrower gave once for the whole schedule — there is nothing to carry,
   * and `signature` is absent because the contract is the authority on when
   * and how much may be pulled.
   */
  kind: "signed" | "standing";
  periodIndex: number;
  value: bigint;
  validAfter: number;
  validBefore: number;
  signature?: Hex;
};

export type ServiceableNote = {
  note: NoteView;
  address: Address;
  periods: PeriodView[];
  /** Keyed by period index. Absent when nothing is lodged. */
  mandates: Record<number, PeriodMandate>;
};

export class RpcNoteSource implements NoteSource {
  constructor(
    private readonly client: PublicClient,
    private readonly factory: Address,
    private readonly relay: Address,
    private readonly vault: Address,
    /** Absent means the standing path is off; only lodged mandates are used. */
    private readonly mandate: Address | null = null,
    private readonly usdc: Address = "0x3600000000000000000000000000000000000000",
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

    /**
     * Lodged mandates win over a standing permit for the same period. Both
     * would work, but a single-use instrument is the narrower authorisation
     * and spending it first means it cannot sit there expiring while a broader
     * one does the job.
     */
    const borrower = await this.client.readContract({
      address,
      abi: noteAbi,
      functionName: "borrower",
    });
    const standing = await this.standingFor(id, borrower, periods);
    const mandates = { ...standing, ...(await this.mandatesFor(id)) };

    return { note, address, periods, mandates };
  }

  /**
   * Mandates lodged for this note and not yet spent.
   *
   * The first thing the agent reads that is not the chain, which is why it
   * lives behind this interface with everything else. A spent mandate is
   * excluded here rather than filtered later: the token would refuse it
   * anyway, and offering one to `decide` would produce a COLLECT that can only
   * fail.
   */
  private async mandatesFor(noteId: bigint): Promise<Record<number, PeriodMandate>> {
    const rows = await prisma.mandate.findMany({
      where: { noteId: noteId.toString(), collectedTx: null },
    });
    const out: Record<number, PeriodMandate> = {};
    for (const r of rows) {
      out[r.periodIndex] = {
        kind: "signed",
        periodIndex: r.periodIndex,
        value: BigInt(r.value),
        validAfter: Number(r.validAfter),
        validBefore: Number(r.validBefore),
        signature: r.signature as Hex,
      };
    }
    return out;
  }

  /**
   * Whether a standing permit covers this note, and for which periods.
   *
   * Read from the chain rather than a table, because the chain is where it
   * lives: the borrower's permit sets an allowance on the token, and the
   * mandate contract records which periods it has already drawn. A database
   * copy of either would be a second source of truth that drifts, and this is
   * one place where being wrong means either failing to collect a debt or
   * trying to collect it twice.
   *
   * Cheap enough to do per note per tick: one allowance read, then one
   * `collected` read per unsettled period.
   */
  private async standingFor(
    noteId: bigint,
    borrower: Address,
    periods: PeriodView[],
  ): Promise<Record<number, PeriodMandate>> {
    if (!this.mandate) return {};

    const allowance = await this.client
      .readContract({
        address: this.usdc,
        abi: usdcAllowanceAbi,
        functionName: "allowance",
        args: [borrower, this.mandate],
      })
      .catch(() => 0n);
    if (allowance === 0n) return {};

    const out: Record<number, PeriodMandate> = {};
    for (const period of periods) {
      const taken = await this.client
        .readContract({
          address: this.mandate,
          abi: mandateAbi,
          functionName: "collected",
          args: [noteId, period.index],
        })
        // A failed read is not a free pass: assume taken, and let the next
        // tick decide once the node answers. Collecting twice is the worse
        // error, and the contract would refuse it anyway.
        .catch(() => true);
      if (taken) continue;

      out[period.index] = {
        kind: "standing",
        periodIndex: period.index,
        // The allowance is the ceiling for the whole note, not this period.
        // `decide` only asks whether something is collectable.
        value: allowance,
        // A standing authorisation has no window of its own — the contract
        // refuses a period that has not ended, which is the same rule, kept
        // where it cannot be got wrong.
        validAfter: period.end,
        validBefore: Number.MAX_SAFE_INTEGER,
      };
    }
    return out;
  }
}
