import type { Address, PublicClient } from "viem";
import { noteAbi, noteFactoryAbi, queueAbi, vaultAbi } from "@/chain/abis";
import { getLogsChunked } from "./logs";
import { NoteStatus, PeriodStatus } from "@/agent/decide";

/**
 * The intel data, read from chain.
 *
 * docs/01-architecture.md makes the subgraph the read path and it should be —
 * this walks every note on every request, which is fine at demo scale and
 * nothing like fine at real scale. It exists so the product is complete before
 * the indexer is, and it is the first thing the subgraph replaces.
 */

export type BorrowerScorecard = {
  borrower: Address;
  notesAccepted: number;
  notesMatured: number;
  notesDefaulted: number;
  /** 18-decimal native base units — contract state, not a price. */
  principalOwed: string;
  principalRepaid: string;
  decimals: 18;
  periods: { settled: number; missed: number; cured: number; outstanding: number };
  punctuality: {
    onTimeRate: number | null;
    curedAfterMissing: number;
  };
  /**
   * Lateness needs the timestamp a period was settled at, which lives in the
   * PeriodStatusChanged event rather than in any getter. It arrives with the
   * subgraph. Omitted rather than reported as zero — a field that is always
   * zero reads as "always on time", which is the opposite of not knowing.
   */
  latencyAvailable: false;
  asOfBlock: number;
};

/** Mirrors ProposalStatus in contracts/src/Types.sol. */
const Proposal = { Proposed: 0, Accepted: 1, Approved: 2, Minted: 3, Rejected: 4, Expired: 5 } as const;

export class IntelReader {
  constructor(
    private readonly client: PublicClient,
    private readonly factory: Address,
    private readonly queue?: Address,
    private readonly vault?: Address,
    /** Deployment block; nothing before it can concern these contracts. */
    private readonly fromBlock: bigint = 0n,
  ) {}

  async originator(address: Address): Promise<OriginatorScorecard> {
    if (!this.queue || !this.vault) {
      throw new Error("originator scorecards need the IssuanceQueue and RepaymentVault addresses");
    }
    const head = await this.client.getBlockNumber();

    // `originator` is an indexed topic, so the node filters rather than us.
    const proposed = await getLogsChunked(this.client, {
      address: this.queue,
      event: queueAbi[2] as never,
      args: { originator: address },
      fromBlock: this.fromBlock,
      toBlock: head,
    });

    let minted = 0, accepted = 0, rejected = 0, expired = 0;
    for (const log of proposed) {
      const id = (log as unknown as { args: { proposalId: bigint } }).args.proposalId;
      const status = await this.client.readContract({
        address: this.queue, abi: queueAbi, functionName: "statusOf", args: [id],
      });
      if (status === Proposal.Minted) minted++;
      else if (status === Proposal.Accepted || status === Proposal.Approved) accepted++;
      else if (status === Proposal.Rejected) rejected++;
      else if (status === Proposal.Expired) expired++;
    }

    // Which notes are theirs, and how those notes are doing.
    const noteCount = await this.client.readContract({
      address: this.factory, abi: noteFactoryAbi, functionName: "noteCount",
    });
    let principal = 0n, matured = 0, defaulted = 0, live = 0, periodsMissed = 0;
    const mine: Array<{ id: bigint; address: Address }> = [];

    for (let id = 1n; id <= noteCount; id++) {
      const note = await this.client.readContract({
        address: this.factory, abi: noteFactoryAbi, functionName: "noteOf", args: [id],
      });
      const owner = await this.client.readContract({ address: note, abi: noteAbi, functionName: "originator" });
      if (owner.toLowerCase() !== address.toLowerCase()) continue;

      mine.push({ id, address: note });
      const [status, terms] = await Promise.all([
        this.client.readContract({ address: note, abi: noteAbi, functionName: "status" }),
        this.client.readContract({ address: note, abi: noteAbi, functionName: "terms" }),
      ]);
      principal += terms.principal;

      // Deliberately NOT note.periodsMissed(), which counts misses still
      // outstanding — the contract decrements it when a period is cured. Using
      // it here would drop every cured miss out of the denominator, so
      // selfCureRate would divide by zero in precisely the case it exists to
      // describe. A period that was ever missed is Missed now or Cured now.
      for (let i = 0; i < terms.periodCount; i++) {
        const st = await this.client.readContract({
          address: note, abi: noteAbi, functionName: "periodStatus", args: [i],
        });
        if (st === PeriodStatus.Missed || st === PeriodStatus.Cured) periodsMissed++;
      }
      if (status === NoteStatus.Matured) matured++;
      else if (status === NoteStatus.Defaulted) defaulted++;
      else live++;
    }

    // The interesting one. A repayment on their own note, made by them rather
    // than by the borrower, against a period that ended up Cured — the
    // originator making good on somebody else's miss.
    let selfCured = 0;
    for (const note of mine) {
      const repaid = await getLogsChunked(this.client, {
        address: this.vault,
        event: vaultAbi[0] as never,
        args: { noteId: note.id, payer: address },
        fromBlock: this.fromBlock,
        toBlock: head,
      });
      const periods = new Set(
        repaid.map((l) => Number((l as unknown as { args: { periodIndex: number } }).args.periodIndex)),
      );
      for (const index of periods) {
        const st = await this.client.readContract({
          address: note.address, abi: noteAbi, functionName: "periodStatus", args: [index],
        });
        if (st === PeriodStatus.Cured) selfCured++;
      }
    }

    const closed = matured + defaulted;
    return {
      originator: address,
      notesProposed: proposed.length,
      notesMinted: minted,
      proposalsAccepted: accepted,
      proposalsRejected: rejected,
      proposalsExpired: expired,
      principalOriginated: principal.toString(),
      decimals: 18,
      book: {
        // No closed notes means no rate. A book with everything still open has
        // not demonstrated anything yet, and saying 0% default would imply it
        // has.
        maturedRate: closed > 0 ? round4(matured / closed) : null,
        defaultRate: closed > 0 ? round4(defaulted / closed) : null,
        // Every period that was ever missed, cured or not — never silently
        // un-count a miss, or the reputation data claims something that did
        // not happen.
        periodsMissed,
        selfCuredPeriods: selfCured,
        selfCureRate: periodsMissed > 0 ? round4(selfCured / periodsMissed) : null,
      },
      asOfBlock: Number(head),
    };
  }

  async borrower(address: Address): Promise<BorrowerScorecard> {
    const [count, block] = await Promise.all([
      this.client.readContract({ address: this.factory, abi: noteFactoryAbi, functionName: "noteCount" }),
      this.client.getBlockNumber(),
    ]);

    let notesAccepted = 0, notesMatured = 0, notesDefaulted = 0;
    let owed = 0n, repaid = 0n;
    let settled = 0, missed = 0, cured = 0, outstanding = 0;

    for (let id = 1n; id <= count; id++) {
      const note = await this.client.readContract({
        address: this.factory, abi: noteFactoryAbi, functionName: "noteOf", args: [id],
      });
      const terms = await this.client.readContract({ address: note, abi: noteAbi, functionName: "terms" });
      if (terms.borrower.toLowerCase() !== address.toLowerCase()) continue;

      notesAccepted++;
      owed += terms.principal;

      const status = await this.client.readContract({ address: note, abi: noteAbi, functionName: "status" });
      if (status === NoteStatus.Matured) notesMatured++;
      if (status === NoteStatus.Defaulted) notesDefaulted++;

      for (let i = 0; i < terms.periodCount; i++) {
        const [pstatus, paid] = await Promise.all([
          this.client.readContract({ address: note, abi: noteAbi, functionName: "periodStatus", args: [i] }),
          this.client.readContract({ address: note, abi: noteAbi, functionName: "periodPaid", args: [i] }),
        ]);
        repaid += paid;
        if (pstatus === PeriodStatus.Settled) settled++;
        else if (pstatus === PeriodStatus.Cured) { settled++; cured++; missed++; }
        else if (pstatus === PeriodStatus.Missed) { missed++; outstanding++; }
        else outstanding++;
      }
    }

    const resolved = settled + missed - cured; // a cured period is one event, counted once
    return {
      borrower: address,
      notesAccepted,
      notesMatured,
      notesDefaulted,
      principalOwed: owed.toString(),
      principalRepaid: repaid.toString(),
      decimals: 18,
      periods: { settled, missed, cured, outstanding },
      punctuality: {
        // No settled periods means no rate. Publishing 1.0 for a borrower who
        // has never paid anything would be worse than publishing nothing.
        onTimeRate: resolved > 0 ? round4((settled - cured) / resolved) : null,
        curedAfterMissing: cured,
      },
      latencyAvailable: false,
      asOfBlock: Number(block),
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Book quality for one originator — do the loans this party writes perform.
 *
 * Priced higher than borrower punctuality because it answers the question a
 * capital allocator actually has. The field that earns that is `selfCureRate`:
 * an originator quietly paying down their own borrower's misses is holding the
 * headline default rate up out of their own pocket, and nobody outside the
 * servicer can see it.
 */
export type OriginatorScorecard = {
  originator: Address;
  notesProposed: number;
  notesMinted: number;
  proposalsAccepted: number;
  proposalsRejected: number;
  proposalsExpired: number;
  principalOriginated: string;
  decimals: 18;
  book: {
    maturedRate: number | null;
    defaultRate: number | null;
    periodsMissed: number;
    selfCuredPeriods: number;
    selfCureRate: number | null;
  };
  asOfBlock: number;
};
