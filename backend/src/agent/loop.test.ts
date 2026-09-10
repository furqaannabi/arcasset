import { expect, test, describe } from "bun:test";
import { tick, send } from "./loop";
import type { AgentConfig, Executor } from "./loop";
import { NoteStatus, PeriodStatus } from "./decide";
import type { NoteView, PeriodView } from "./decide";
import type { NoteSource, PeriodMandate, ServiceableNote } from "./source";
import type { Address, Hash } from "viem";

const AGENT = "0x00000000000000000000000000000000000000a1" as Address;
const NOW = 1_757_000_000;
const DAY = 86_400;

const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  agent: AGENT,
  maxActionsPerTick: 25,
  maxLagBlocks: 200,
  minGasBalance: 10n ** 16n,
  defaultDryRun: true,
  ...over,
});

class FakeSource implements NoteSource {
  constructor(
    private readonly notes: ServiceableNote[],
    private readonly lag = 0,
  ) {}
  async serviceable(): Promise<ServiceableNote[]> {
    return this.notes;
  }
  async lagBlocks(): Promise<number> {
    return this.lag;
  }
  async chainTime(): Promise<number> {
    return NOW;
  }
}

class FakeExecutor implements Executor {
  settles: Array<[bigint, number]> = [];
  delinquents: Array<[bigint, number]> = [];
  defaults: bigint[] = [];
  collects: Array<[bigint, number, bigint]> = [];
  inFlight = 0;
  maxConcurrent = 0;
  constructor(
    private readonly balance = 10n ** 18n,
    private readonly failWith?: string,
  ) {}
  private async record<T>(fn: () => T): Promise<Hash> {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    await Promise.resolve();
    if (this.failWith) {
      this.inFlight--;
      throw new Error(this.failWith);
    }
    fn();
    this.inFlight--;
    return ("0x" + "ab".repeat(32)) as Hash;
  }
  settlePeriod(id: bigint, i: number) {
    return this.record(() => this.settles.push([id, i]));
  }
  markDelinquent(id: bigint, i: number) {
    return this.record(() => this.delinquents.push([id, i]));
  }
  markDefaulted(id: bigint) {
    return this.record(() => this.defaults.push(id));
  }
  collect(id: bigint, i: number, m: PeriodMandate) {
    return this.record(() => this.collects.push([id, i, m.value]));
  }
  async gasBalance() {
    return this.balance;
  }
}

const note = (over: Partial<NoteView> = {}): NoteView => ({
  noteId: 1n,
  status: NoteStatus.Active,
  gracePeriod: 2 * DAY,
  cureWindow: 30 * DAY,
  firstMissedAt: 0,
  ...over,
});
const period = (over: Partial<PeriodView> = {}): PeriodView => ({
  index: 0,
  end: NOW - DAY,
  due: 1_000n,
  paid: 0n,
  status: PeriodStatus.Pending,
  ...over,
});
const entry = (
  n: NoteView,
  ps: PeriodView[],
  mandates: ServiceableNote["mandates"] = {},
): ServiceableNote => ({
  note: n,
  address: "0x00000000000000000000000000000000000000ff" as Address,
  periods: ps,
  mandates,
});

describe("acting", () => {
  test("settles a funded ended period", async () => {
    const ex = new FakeExecutor();
    const r = await tick(new FakeSource([entry(note(), [period({ paid: 1_000n })])]), ex, config(), NOW);
    expect(ex.settles).toEqual([[1n, 0]]);
    expect(r.actionsTaken).toBe(1);
  });

  test("marks delinquent past grace", async () => {
    const ex = new FakeExecutor();
    await tick(new FakeSource([entry(note(), [period({ end: NOW - 10 * DAY })])]), ex, config(), NOW);
    expect(ex.delinquents).toEqual([[1n, 0]]);
  });

  test("logs every WAIT as well as every action", async () => {
    const ex = new FakeExecutor();
    const r = await tick(
      new FakeSource([entry(note(), [period({ paid: 0n }), period({ index: 1, paid: 1_000n })])]),
      ex, config(), NOW,
    );
    expect(r.log).toHaveLength(2);
    expect(r.log.map((l) => l.decision).sort()).toEqual(["SETTLE", "WAIT"]);
    for (const l of r.log) expect(l.reason.length).toBeGreaterThan(0);
  });
});

describe("rails", () => {
  test("skips the tick entirely when the source is lagging", async () => {
    const ex = new FakeExecutor();
    const r = await tick(
      new FakeSource([entry(note(), [period({ paid: 1_000n })])], 500),
      ex, config({ maxLagBlocks: 200 }), NOW,
    );
    expect(r.skipped).toBe("lagging");
    expect(ex.settles).toHaveLength(0);
  });

  test("skips the tick when gas is below the floor", async () => {
    const ex = new FakeExecutor(1n);
    const r = await tick(
      new FakeSource([entry(note(), [period({ paid: 1_000n })])]),
      ex, config({ minGasBalance: 10n ** 16n }), NOW,
    );
    expect(r.skipped).toBe("low-gas");
    expect(ex.settles).toHaveLength(0);
  });

  /// A bad read must not be able to produce ten thousand transactions before a
  /// human notices.
  test("caps actions per tick", async () => {
    const ex = new FakeExecutor();
    const many = Array.from({ length: 100 }, (_, i) => period({ index: i, paid: 1_000n }));
    const r = await tick(new FakeSource([entry(note(), many)]), ex, config({ maxActionsPerTick: 5 }), NOW);
    expect(r.actionsTaken).toBe(5);
    expect(r.capped).toBe(true);
    expect(ex.settles).toHaveLength(5);
  });

  /// A single signer with parallel sends is a nonce collision waiting to happen.
  test("never has two transactions in flight at once", async () => {
    const ex = new FakeExecutor();
    const many = Array.from({ length: 20 }, (_, i) => period({ index: i, paid: 1_000n }));
    await tick(new FakeSource([entry(note(), many)]), ex, config(), NOW);
    expect(ex.maxConcurrent).toBe(1);
  });

  test("default is dry-run by default and sends nothing", async () => {
    const ex = new FakeExecutor();
    const n = note({ firstMissedAt: NOW - 40 * DAY, cureWindow: 30 * DAY });
    const r = await tick(
      new FakeSource([entry(n, [period({ status: PeriodStatus.Missed })])]),
      ex, config({ defaultDryRun: true }), NOW,
    );
    expect(ex.defaults).toHaveLength(0);
    expect(r.log[0]?.dryRun).toBe(true);
    expect(r.actionsTaken).toBe(0);
  });

  test("default fires only when a human has flipped the flag", async () => {
    const ex = new FakeExecutor();
    const n = note({ firstMissedAt: NOW - 40 * DAY, cureWindow: 30 * DAY });
    await tick(
      new FakeSource([entry(n, [period({ status: PeriodStatus.Missed })])]),
      ex, config({ defaultDryRun: false }), NOW,
    );
    expect(ex.defaults).toEqual([1n]);
  });

  test("at most one default per note per tick", async () => {
    const ex = new FakeExecutor();
    const n = note({ firstMissedAt: NOW - 40 * DAY, cureWindow: 30 * DAY });
    const ps = [0, 1, 2].map((i) => period({ index: i, status: PeriodStatus.Missed }));
    await tick(new FakeSource([entry(n, ps)]), ex, config({ defaultDryRun: false }), NOW);
    expect(ex.defaults).toEqual([1n]);
  });
});

describe("failure handling", () => {
  /// The contract is the arbiter of whether an action was already taken. A
  /// revert means the agent is behind, not broken.
  test("a revert is logged and the tick continues", async () => {
    const ex = new FakeExecutor(10n ** 18n, "AlreadySettled()");
    const r = await tick(
      new FakeSource([
        entry(note(), [period({ paid: 1_000n })]),
        entry(note({ noteId: 2n }), [period({ paid: 1_000n })]),
      ]),
      ex, config(), NOW,
    );
    expect(r.actionsTaken).toBe(0);
    expect(r.log).toHaveLength(2);
    for (const l of r.log) expect(l.error).toContain("AlreadySettled");
  });

  test("keeps no memory between ticks", async () => {
    const ex = new FakeExecutor();
    const src = new FakeSource([entry(note(), [period({ paid: 1_000n })])]);
    await tick(src, ex, config(), NOW);
    await tick(src, ex, config(), NOW);
    // Both attempts are made; the contract, not the agent, refuses the second.
    expect(ex.settles).toEqual([[1n, 0], [1n, 0]]);
  });
});

describe("dispatch", () => {
  const mandate = (over: Partial<PeriodMandate> = {}): PeriodMandate => ({
    periodIndex: 0,
    value: 1_000_000n,
    validAfter: NOW - DAY,
    validBefore: NOW + DAY,
    signature: ("0x" + "11".repeat(65)) as `0x${string}`,
    ...over,
  });

  test("COLLECT never becomes a default", async () => {
    // The regression this guards: COLLECT joined the Action union while the
    // dispatch was a ternary chain, whose final arm was markDefaulted. It
    // compiled, every test stayed green, and the agent would have defaulted a
    // borrower who had signed to pay.
    const ex = new FakeExecutor();
    await send("COLLECT", ex, 1n, 0, mandate());
    expect(ex.collects).toEqual([[1n, 0, 1_000_000n]]);
    expect(ex.defaults).toEqual([]);
    expect(ex.settles).toEqual([]);
    expect(ex.delinquents).toEqual([]);
  });

  test("COLLECT without a mandate sends nothing at all", async () => {
    // A send with no authority behind it is worse than no send.
    const ex = new FakeExecutor();
    await expect(send("COLLECT", ex, 1n, 0, null)).rejects.toThrow(/no mandate/);
    expect(ex.collects).toEqual([]);
    expect(ex.defaults).toEqual([]);
  });

  test("each action reaches its own executor call", async () => {
    const ex = new FakeExecutor();
    await send("SETTLE", ex, 1n, 3);
    await send("DELINQUENT", ex, 2n, 4);
    await send("DEFAULT", ex, 5n, 0);
    expect(ex.settles).toEqual([[1n, 3]]);
    expect(ex.delinquents).toEqual([[2n, 4]]);
    expect(ex.defaults).toEqual([5n]);
  });

  test("WAIT is refused rather than silently sent", async () => {
    const ex = new FakeExecutor();
    await expect(send("WAIT", ex, 1n, 0)).rejects.toThrow(/filters it/);
    expect(ex.defaults).toEqual([]);
  });
});

describe("mandates in the loop", () => {
  const m = (over: Partial<PeriodMandate> = {}): PeriodMandate => ({
    periodIndex: 0,
    value: 1_000_000n,
    validAfter: NOW - DAY,
    validBefore: NOW + DAY,
    signature: ("0x" + "22".repeat(65)) as `0x${string}`,
    ...over,
  });

  test("a lodged mandate is collected instead of marking the period late", async () => {
    const n = note();
    const ps = [period({ end: NOW - 5 * DAY, paid: 0n })];
    const ex = new FakeExecutor();

    // Without one, the same state is a delinquency.
    await tick(new FakeSource([entry(n, ps)]), ex, config(), NOW);
    expect(ex.delinquents).toEqual([[1n, 0]]);
    expect(ex.collects).toEqual([]);

    const ex2 = new FakeExecutor();
    await tick(new FakeSource([entry(n, ps, { 0: m() })]), ex2, config(), NOW);
    expect(ex2.collects).toEqual([[1n, 0, 1_000_000n]]);
    expect(ex2.delinquents).toEqual([]);
    expect(ex2.defaults).toEqual([]);
  });

  test("a mandate for another period does not rescue this one", async () => {
    const ex = new FakeExecutor();
    const ps = [period({ end: NOW - 5 * DAY, paid: 0n })];
    await tick(
      new FakeSource([entry(note(), ps, { 1: m({ periodIndex: 1 }) })]),
      ex, config(), NOW,
    );
    expect(ex.collects).toEqual([]);
    expect(ex.delinquents).toEqual([[1n, 0]]);
  });
});
