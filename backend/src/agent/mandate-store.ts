import { prisma } from "@/db";
import type { MandateStore, StoredMandate } from "./source";
import type { Hex } from "viem";

/**
 * The mandates a borrower has lodged and nobody has spent.
 *
 * Spent is recorded here rather than inferred, because the alternative is
 * presenting a burned nonce every tick and reading the revert as news. The
 * chain remains the authority on whether the money moved; this table only
 * answers whether we have already asked.
 */
export class PrismaMandateStore implements MandateStore {
  async unspentFor(noteId: bigint): Promise<Map<number, StoredMandate>> {
    const rows = await prisma.mandate.findMany({
      where: { noteId: noteId.toString(), collectedTx: null },
    });

    const out = new Map<number, StoredMandate>();
    for (const row of rows) {
      out.set(row.periodIndex, {
        value: BigInt(row.value),
        validAfter: Number(row.validAfter),
        validBefore: Number(row.validBefore),
        signature: row.signature as Hex,
      });
    }
    return out;
  }

  async markCollected(noteId: bigint, periodIndex: number, txHash: string): Promise<void> {
    await prisma.mandate.update({
      where: { noteId_periodIndex: { noteId: noteId.toString(), periodIndex } },
      data: { collectedTx: txHash },
    });
  }
}
