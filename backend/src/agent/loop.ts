import type { Address, Hash } from "viem";
import { decide } from "./decide";
import type { Action, Decision } from "./decide";
import type { NoteSource, ServiceableNote, StoredMandate } from "./source";

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
  /** Present a mandate the borrower signed. Optional: an agent without a
   * RepaymentMandate address simply never decides COLLECT. */
  collect?(noteId: bigint, index: number, mandate: StoredMandate): Promise<Hash>;
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

      const mandate = entry.mandates.get(period.index) ?? null;
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

      await act(entry, period.index, d, executor, report, line, source);
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
  source?: NoteSource,
): Promise<void> {
  const noteId = entry.note.noteId;
  try {
    // Sends are awaited one at a time, deliberately. A single signer with
    // parallel sends is a nonce collision waiting to happen, and the throughput
    // we would gain is throughput we do not need.
    //
    // Exhaustive on purpose. This was a ternary whose last branch was
    // markDefaulted, so a COLLECT — the case where the borrower had already
    // authorised the money — would have defaulted them instead, and
    // defaultDryRun would not have caught it because that guard keys on the
    // DEFAULT action. A new action must never fall through to the one
    // irreversible call.
    let tx: Hash;
    switch (d.action) {
      case "SETTLE":
        tx = await executor.settlePeriod(noteId, index);
        break;
      case "DELINQUENT":
        tx = await executor.markDelinquent(noteId, index);
        break;
      case "DEFAULT":
        tx = await executor.markDefaulted(noteId);
        break;
      case "COLLECT": {
        const mandate = entry.mandates.get(index);
        if (!mandate) throw new Error("decided COLLECT with no mandate to present");
        // Optional on the interface, because an agent with no RepaymentMandate
        // address should never have decided this in the first place. If it did,
        // that is a wiring fault and it says so rather than defaulting anyone.
        if (!executor.collect) throw new Error("this executor cannot collect mandates");
        tx = await executor.collect(noteId, index, mandate);
        // Burned now, by the token's own rule. Recording it stops the agent
        // presenting the same dead nonce on every tick from here on.
        await source?.markCollected?.(noteId, index, tx);
        break;
      }
      default:
        throw new Error(`no executor path for ${d.action as string}`);
    }

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
