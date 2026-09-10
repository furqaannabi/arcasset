import type { Address, Hash } from "viem";
import { decide } from "./decide";
import type { Action, Decision } from "./decide";
import type { NoteSource, PeriodMandate, ServiceableNote } from "./source";

/**
 * The tick. Reads, decides, acts, records — and stops itself when any of the
 * conditions that make unattended action safe stop holding.
 *
 * The rails are not decoration. The signing key is hot, on a server, acting
 * without a human. Each one below exists because of a specific way this could
 * go wrong. See docs/04-backend.md.
 */

export interface Executor {
  settlePeriod(noteId: bigint, index: number): Promise<Hash>;
  collect(noteId: bigint, index: number, mandate: PeriodMandate): Promise<Hash>;
  markDelinquent(noteId: bigint, index: number): Promise<Hash>;
  markDefaulted(noteId: bigint): Promise<Hash>;
  gasBalance(): Promise<bigint>;
}

export type AgentConfig = {
  agent: Address;
  maxActionsPerTick: number;
  maxLagBlocks: number;
  minGasBalance: bigint;
  /** Marking a real borrower defaulted is the one irreversible act. */
  defaultDryRun: boolean;
};

export type LogLine = {
  /** Set when a runner records the line; absent on a bare tick. */
  at?: number;
  noteId: string;
  period: number | null;
  decision: Action;
  reason: string;
  due?: string;
  paid?: string;
  tx?: Hash;
  error?: string;
  dryRun?: boolean;
};

export type TickReport = {
  skipped: null | "lagging" | "low-gas";
  notesConsidered: number;
  actionsTaken: number;
  capped: boolean;
  log: LogLine[];
};

export async function tick(
  source: NoteSource,
  executor: Executor,
  config: AgentConfig,
  /** Overridable for tests. Otherwise the chain's clock — never this machine's. */
  nowOverride?: number,
): Promise<TickReport> {
  const report: TickReport = {
    skipped: null,
    notesConsidered: 0,
    actionsTaken: 0,
    capped: false,
    log: [],
  };

  // Rail: never act on stale data. A lagging read makes the agent mark
  // delinquencies that were cured minutes ago.
  const lag = await source.lagBlocks();
  if (lag > config.maxLagBlocks) {
    report.skipped = "lagging";
    report.log.push({
      noteId: "-", period: null, decision: "WAIT",
      reason: `source is ${lag} blocks behind, limit ${config.maxLagBlocks}`,
    });
    return report;
  }

  // Rail: stop before half-servicing a note for want of gas.
  const balance = await executor.gasBalance();
  if (balance < config.minGasBalance) {
    report.skipped = "low-gas";
    report.log.push({
      noteId: "-", period: null, decision: "WAIT",
      reason: `gas balance ${balance} below floor ${config.minGasBalance}`,
    });
    return report;
  }

  const now = nowOverride ?? (await source.chainTime());
  const notes = await source.serviceable(config.agent);
  report.notesConsidered = notes.length;

  for (const entry of notes) {
    // Rail: at most one default per note per tick, so a bad read cannot cascade.
    let defaultedThisNote = false;

    for (const period of entry.periods) {
      if (report.actionsTaken >= config.maxActionsPerTick) {
        report.capped = true;
        return report;
      }

      // The fourth argument and the COLLECT branch below land together, as
      // docs/09-mandate.md insists: passing this without a branch to receive it
      // is what would have defaulted a borrower who had signed to pay.
      const mandate = entry.mandates[period.index] ?? null;
      const d = decide(entry.note, period, now, mandate);
      const line: LogLine = {
        noteId: entry.note.noteId.toString(),
        period: period.index,
        decision: d.action,
        reason: d.reason,
        due: period.due.toString(),
        paid: period.paid.toString(),
      };

      if (d.action === "WAIT") {
        // Logged too. In a demo the log is the agent, and a decision not to act
        // is still a decision worth being able to point at.
        report.log.push(line);
        continue;
      }

      if (d.action === "DEFAULT") {
        if (defaultedThisNote) {
          report.log.push({ ...line, decision: "WAIT", reason: "already defaulted this tick" });
          continue;
        }
        defaultedThisNote = true;
        if (config.defaultDryRun) {
          // Marking a real borrower defaulted by accident is the worst thing
          // this system can do, so it is the slowest path: logged, not sent,
          // until a human flips the flag.
          report.log.push({ ...line, dryRun: true });
          continue;
        }
      }

      await act(entry, period.index, d, executor, report, line, mandate);
    }
  }

  return report;
}

async function act(
  entry: ServiceableNote,
  index: number,
  d: Decision,
  executor: Executor,
  report: TickReport,
  line: LogLine,
  mandate: PeriodMandate | null,
): Promise<void> {
  const noteId = entry.note.noteId;
  try {
    // Sends are awaited one at a time, deliberately. A single signer with
    // parallel sends is a nonce collision waiting to happen, and the throughput
    // we would gain is throughput we do not need.
    const tx = await send(d.action, executor, noteId, index, mandate);

    report.actionsTaken++;
    report.log.push({ ...line, tx });
  } catch (err) {
    // Reverts are expected under lag — the contract is the arbiter of whether
    // an action was already taken, and it saying "already settled" means the
    // agent is behind, not broken. It never tracks that in memory, because
    // memory is lost on restart and a restarted agent that trusts itself
    // double-sends.
    const message = err instanceof Error ? err.message : String(err);
    report.log.push({ ...line, error: message });
  }
}

/**
 * The one place a decision becomes a transaction.
 *
 * A switch with a `never` fallthrough, not a ternary chain. This was a ternary
 * chain, and when COLLECT joined the Action union it inherited the last arm —
 * markDefaulted, the single irreversible act in the system — in exactly the
 * case where the borrower had already signed to pay. Nothing failed to compile
 * and no test went red, because a ternary's final arm is total by construction.
 *
 * The `never` assignment below is the actual fix. Widening Action now breaks
 * the build here until the new case is handled.
 */
export async function send(
  action: Decision["action"],
  executor: Executor,
  noteId: bigint,
  index: number,
  mandate: PeriodMandate | null = null,
): Promise<Hash> {
  switch (action) {
    case "SETTLE":
      return executor.settlePeriod(noteId, index);
    case "DELINQUENT":
      return executor.markDelinquent(noteId, index);
    case "DEFAULT":
      return executor.markDefaulted(noteId);
    case "COLLECT":
      // decide only returns COLLECT when it was handed a mandate, so this is
      // unreachable in the loop. It stays because `send` is called directly by
      // tests, and because an unchecked null here would be a send with no
      // authority behind it.
      if (!mandate) throw new Error("COLLECT decided with no mandate to collect");
      return executor.collect(noteId, index, mandate);
    case "WAIT":
      throw new Error("WAIT reached act(), which filters it");
    default: {
      const unhandled: never = action;
      throw new Error(`unhandled action ${String(unhandled)}`);
    }
  }
}
