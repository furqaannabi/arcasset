import type { Address, PublicClient } from "viem";
import { noteAbi, noteFactoryAbi } from "@/chain/abis";
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

export class IntelReader {
  constructor(
    private readonly client: PublicClient,
    private readonly factory: Address,
  ) {}

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
