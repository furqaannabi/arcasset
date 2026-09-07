import type { AbiEvent, Address, Log, PublicClient } from "viem";

/**
 * Arc's RPC refuses large `eth_getLogs` ranges — 20,000 blocks answer, 50,000
 * return "requested range too large". So every log read is chunked, and the
 * chunk halves on rejection rather than giving up, because the limit is the
 * provider's and can change without telling us.
 */
export const DEFAULT_CHUNK = 10_000n;

export async function getLogsChunked<TEvent extends AbiEvent>(
  client: PublicClient,
  opts: {
    address: Address;
    event: TEvent;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
    chunk?: bigint;
  },
): Promise<Log[]> {
  const out: Log[] = [];
  let chunk = opts.chunk ?? DEFAULT_CHUNK;
  let from = opts.fromBlock;

  while (from <= opts.toBlock) {
    const to = from + chunk - 1n > opts.toBlock ? opts.toBlock : from + chunk - 1n;
    try {
      const logs = await client.getLogs({
        address: opts.address,
        event: opts.event,
        args: opts.args as never,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...(logs as Log[]));
      from = to + 1n;
    } catch (err) {
      if (chunk <= 1_000n) throw err;
      // Halve and retry the same window rather than skipping it. Skipping would
      // silently drop events and produce a scorecard that is quietly wrong.
      chunk /= 2n;
    }
  }
  return out;
}
