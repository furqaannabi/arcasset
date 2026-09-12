import { expect, test, describe } from "bun:test";
import { decide, NoteStatus, PeriodStatus } from "./decide";
import type { MandateView, NoteView, PeriodView } from "./decide";

const HOUR = 3600;
const DAY = 86_400;
const NOW = 1_757_000_000;

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
  end: NOW - HOUR, // ended an hour ago unless overridden
  due: 1_000n,
  paid: 0n,
  status: PeriodStatus.Pending,
  ...over,
});

const mandate = (over: Partial<MandateView> = {}): MandateView => ({
  kind: "signed",
  validAfter: NOW - DAY,
  validBefore: NOW + DAY,
  value: 1_000n,
  ...over,
});

describe("collecting a signed mandate", () => {
  test("collects when the period is short and the mandate is live", () => {
    const d = decide(note(), period({ paid: 0n }), NOW, mandate());
    expect(d.action).toBe("COLLECT");
  });

  test("collects rather than marking delinquent once grace has ended", () => {
    // The whole point. A mandate the borrower signed must be tried before
    // their record is marked, or the agent manufactures the delinquency.
    const p = period({ end: NOW - 5 * DAY, paid: 0n });
    expect(decide(note(), p, NOW).action).toBe("DELINQUENT");
    expect(decide(note(), p, NOW, mandate()).action).toBe("COLLECT");
  });

  test("settles rather than collecting when the money is already there", () => {
    const d = decide(note(), period({ paid: 1_000n }), NOW, mandate());
    expect(d.action).toBe("SETTLE");
  });

  test("ignores a mandate that is not yet valid", () => {
    const d = decide(note(), period({ end: NOW + HOUR }), NOW, mandate({ validAfter: NOW + HOUR }));
    expect(d.action).toBe("WAIT");
  });

  test("ignores an expired mandate", () => {
    const p = period({ end: NOW - 5 * DAY, paid: 0n });
    const d = decide(note(), p, NOW, mandate({ validBefore: NOW - HOUR }));
    expect(d.action).toBe("DELINQUENT");
  });

  test("does not collect against a settled period", () => {
    const d = decide(note(), period({ status: PeriodStatus.Settled }), NOW, mandate());
    expect(d.action).toBe("WAIT");
  });

  test("does not collect on a terminal note", () => {
    const d = decide(note({ status: NoteStatus.Defaulted }), period(), NOW, mandate());
    expect(d.action).toBe("WAIT");
  });

  test("a closed cure window outranks a live mandate", () => {
    // Past the cure window the note's fate is already decided; pulling more
    // money from the borrower does not change it and should not be done.
    const n = note({ firstMissedAt: NOW - 31 * DAY, cureWindow: 30 * DAY });
    const d = decide(n, period({ paid: 0n }), NOW, mandate());
    expect(d.action).toBe("DEFAULT");
  });
});

describe("settling", () => {
  test("settles a funded period once it has ended", () => {
    const d = decide(note(), period({ paid: 1_000n }), NOW);
    expect(d.action).toBe("SETTLE");
  });

  test("overpayment still settles", () => {
    expect(decide(note(), period({ paid: 5_000n }), NOW).action).toBe("SETTLE");
  });

  /// The contract rejects settlement before the period ends, so acting here
  /// would burn gas on a guaranteed revert.
  test("waits on a funded period that has not ended yet", () => {
    const d = decide(note(), period({ paid: 1_000n, end: NOW + HOUR }), NOW);
    expect(d.action).toBe("WAIT");
    expect(d.reason).toContain("period ends at");
  });

  test("settles exactly at the period boundary", () => {
    const d = decide(note(), period({ paid: 1_000n, end: NOW }), NOW);
    expect(d.action).toBe("SETTLE");
  });

  test("never re-settles", () => {
    for (const status of [PeriodStatus.Settled, PeriodStatus.Cured] as const) {
      expect(decide(note(), period({ paid: 1_000n, status }), NOW).action).toBe("WAIT");
    }
  });
});

describe("grace", () => {
  /// A borrower who has paid most of it with time left has not missed anything.
  test("partial payment inside grace waits, it is not delinquent", () => {
    const p = period({ paid: 800n, end: NOW - HOUR });
    const d = decide(note({ gracePeriod: 2 * DAY }), p, NOW);
    expect(d.action).toBe("WAIT");
    expect(d.reason).toContain("short by 200");
  });

  test("nothing paid but inside grace still waits", () => {
    expect(decide(note(), period({ paid: 0n }), NOW).action).toBe("WAIT");
  });

  test("waits on the last second of grace, marks on the next", () => {
    const end = NOW - 10 * DAY;
    const n = note({ gracePeriod: 2 * DAY });
    const graceEnds = end + 2 * DAY;
    expect(decide(n, period({ end }), graceEnds).action).toBe("WAIT");
    expect(decide(n, period({ end }), graceEnds + 1).action).toBe("DELINQUENT");
  });

  test("zero grace marks the moment the period ends", () => {
    const n = note({ gracePeriod: 0 });
    expect(decide(n, period({ end: NOW }), NOW).action).toBe("WAIT");
    expect(decide(n, period({ end: NOW }), NOW + 1).action).toBe("DELINQUENT");
  });
});

describe("delinquency and default", () => {
  test("marks delinquent past grace", () => {
    const d = decide(note(), period({ end: NOW - 10 * DAY }), NOW);
    expect(d.action).toBe("DELINQUENT");
  });

  test("does not re-mark a period already missed", () => {
    const p = period({ end: NOW - 10 * DAY, status: PeriodStatus.Missed });
    const d = decide(note({ firstMissedAt: NOW - 5 * DAY }), p, NOW);
    expect(d.action).toBe("WAIT");
    expect(d.reason).toContain("cure window open");
  });

  test("defaults once the cure window closes", () => {
    const missedAt = NOW - 40 * DAY;
    const p = period({ end: NOW - 45 * DAY, status: PeriodStatus.Missed });
    const d = decide(note({ firstMissedAt: missedAt, cureWindow: 30 * DAY }), p, NOW);
    expect(d.action).toBe("DEFAULT");
  });

  test("waits on the last second of the cure window", () => {
    const missedAt = NOW - 30 * DAY;
    const n = note({ firstMissedAt: missedAt, cureWindow: 30 * DAY });
    const p = period({ end: NOW - 35 * DAY, status: PeriodStatus.Missed });
    expect(decide(n, p, missedAt + 30 * DAY).action).toBe("WAIT");
    expect(decide(n, p, missedAt + 30 * DAY + 1).action).toBe("DEFAULT");
  });

  /// Once the note is going to default, marking more periods late is noise on
  /// the way to the same place.
  test("default outranks a fresh delinquency", () => {
    const n = note({ firstMissedAt: NOW - 40 * DAY, cureWindow: 30 * DAY });
    const p = period({ end: NOW - 10 * DAY, status: PeriodStatus.Pending });
    expect(decide(n, p, NOW).action).toBe("DEFAULT");
  });

  test("a cured note (firstMissedAt cleared) does not default", () => {
    const n = note({ firstMissedAt: 0, cureWindow: 30 * DAY });
    expect(decide(n, period({ end: NOW - 100 * DAY }), NOW).action).toBe("DELINQUENT");
  });
});

describe("terminal notes", () => {
  test("nothing is ever done to a matured or defaulted note", () => {
    for (const status of [NoteStatus.Matured, NoteStatus.Defaulted] as const) {
      const d = decide(note({ status }), period({ paid: 1_000n }), NOW);
      expect(d.action).toBe("WAIT");
      expect(d.reason).toBe("note is terminal");
    }
  });
});

describe("determinism", () => {
  /// The whole safety argument rests on this: the same inputs must always give
  /// the same action, so a restarted agent behaves identically to one that
  /// never stopped.
  test("is a pure function of its inputs", () => {
    const n = note({ firstMissedAt: NOW - 5 * DAY });
    const p = period({ paid: 400n, end: NOW - 3 * DAY });
    const first = decide(n, p, NOW);
    for (let i = 0; i < 50; i++) {
      expect(decide(n, p, NOW)).toEqual(first);
    }
  });

  test("every branch returns a reason a human can check", () => {
    const cases: Array<[NoteView, PeriodView, number]> = [
      [note(), period({ paid: 1_000n }), NOW],
      [note(), period({ paid: 1_000n, end: NOW + HOUR }), NOW],
      [note(), period({ paid: 0n }), NOW],
      [note(), period({ end: NOW - 10 * DAY }), NOW],
      [note({ firstMissedAt: NOW - 40 * DAY }), period({ status: PeriodStatus.Missed }), NOW],
      [note({ status: NoteStatus.Matured }), period(), NOW],
    ];
    for (const [n, p, t] of cases) {
      const d = decide(n, p, t);
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});
