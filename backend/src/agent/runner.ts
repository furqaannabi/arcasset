import type { Address } from "viem";
import { tick } from "./loop";
import type { AgentConfig, Executor, LogLine, TickReport } from "./loop";
import type { NoteSource } from "./source";

/**
 * Runs the tick on an interval and keeps a short history in memory.
 *
 * The history is for looking at, not for deciding with. Nothing here feeds back
 * into the next tick — every decision is re-derived from the source, which is
 * what makes a restarted agent identical to one that never stopped.
 */
export class AgentRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  readonly log: LogLine[] = [];
  ticks = 0;
  lastTickAt: number | null = null;
  lastReport: TickReport | null = null;
  consecutiveFailures = 0;

  constructor(
    private readonly source: NoteSource,
    private readonly executor: Executor,
    private readonly config: AgentConfig,
    private readonly intervalMs: number,
    private readonly logLimit = 500,
  ) {}

  get agent(): Address {
    return this.config.agent;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.runOnce();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Exposed so a test or an operator can drive one tick without waiting. */
  async runOnce(): Promise<TickReport | null> {
    if (this.running) return null;
    this.running = true;
    let report: TickReport | null = null;
    try {
      report = await tick(this.source, this.executor, this.config);
      this.lastReport = report;
      this.consecutiveFailures = 0;
      this.record(report.log);
    } catch (err) {
      // A source that is unreachable is not a reason to stop; it is a reason to
      // do nothing this tick and try again.
      this.consecutiveFailures++;
      this.record([
        {
          noteId: "-",
          period: null,
          decision: "WAIT",
          reason: "tick failed",
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      this.ticks++;
      this.lastTickAt = Math.floor(Date.now() / 1000);
      this.running = false;
      this.schedule();
    }
    return report;
  }

  private schedule(): void {
    if (this.stopped) return;
    // Back off on repeated failure rather than hammering a source that is down,
    // capped so a recovered source is picked up within a minute or so.
    const backoff = Math.min(2 ** Math.min(this.consecutiveFailures, 5), 32);
    this.timer = setTimeout(() => void this.runOnce(), this.intervalMs * backoff);
    // Do not hold the process open purely to schedule the next tick.
    this.timer.unref?.();
  }

  private record(lines: LogLine[]): void {
    for (const line of lines) {
      this.log.unshift({ ...line, at: Math.floor(Date.now() / 1000) } as LogLine);
    }
    if (this.log.length > this.logLimit) this.log.length = this.logLimit;
  }
}
