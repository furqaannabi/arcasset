import type { Address, Hash } from "viem";
import { decide } from "./decide";
import type { Action, Decision } from "./decide";
import type { NoteSource, ServiceableNote } from "./source";

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
  now: number = Math.floor(Date.now() / 1000),
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

      const d = decide(entry.note, period, now);
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

      await act(entry, period.index, d, executor, report, line);
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
): Promise<void> {
  const noteId = entry.note.noteId;
  try {
    // Sends are awaited one at a time, deliberately. A single signer with
    // parallel sends is a nonce collision waiting to happen, and the throughput
    // we would gain is throughput we do not need.
    const tx =
      d.action === "SETTLE"
        ? await executor.settlePeriod(noteId, index)
        : d.action === "DELINQUENT"
          ? await executor.markDelinquent(noteId, index)
          : await executor.markDefaulted(noteId);

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
