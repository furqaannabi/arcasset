/**
 * The servicing agent's decision log.
 *
 * This is the product's actual moment — an agent reading indexed state,
 * deciding, and transacting with nobody watching — so it is the hero rather
 * than a stock illustration. The lines below are a representative tick, not
 * live data; the real one is on /agent.
 *
 * Rendered fully at rest. Nothing is parked at opacity 0 waiting to animate,
 * so the first frame (and a screenshot of it) shows the whole log.
 */

type Tone = "meta" | "read" | "act" | "warn" | "done";

const LINES: { t: string; scope: string; text: string; tone: Tone }[] = [
  { t: "14:22:01", scope: "tick #418", text: "indexer lag 2 blocks · within tolerance", tone: "meta" },
  { t: "14:22:01", scope: "note #3", text: "period 2 ended 41s ago", tone: "read" },
  { t: "14:22:01", scope: "note #3", text: "vault holds 1,000.00 · due 1,000.00", tone: "read" },
  { t: "14:22:02", scope: "note #3", text: "settlePeriod(3, 2) → 0x9f2a…8e41", tone: "act" },
  { t: "14:22:04", scope: "note #3", text: "settled · distributed 995.00 · fee 5.00", tone: "done" },
  { t: "14:22:04", scope: "note #7", text: "period 5 past grace by 6m 12s", tone: "warn" },
  { t: "14:22:05", scope: "note #7", text: "markDelinquent(7, 5) → 0x41bd…77a0", tone: "act" },
  { t: "14:22:06", scope: "note #7", text: "delinquent · shortfall 2,500.00", tone: "warn" },
  { t: "14:22:06", scope: "tick #418", text: "2 actions · next tick in 5s", tone: "meta" },
];

const TONE: Record<Tone, string> = {
  meta: "text-faint",
  read: "text-muted",
  act: "text-ink",
  warn: "text-warn",
  done: "text-accent",
};

export function AgentLog() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        <span className="eyebrow">agent · servicing unattended</span>
        <span className="eyebrow ml-auto hidden sm:inline">0x7a3f…c19d</span>
      </div>

      <ol className="divide-y divide-line/60">
        {LINES.map((l, i) => (
          <li
            key={`${l.t}-${i}`}
            className="flex gap-3 px-4 py-1.5 font-mono text-[11.5px] leading-relaxed"
          >
            <span className="shrink-0 text-faint tnum">{l.t}</span>
            <span className="hidden w-[68px] shrink-0 text-faint sm:inline">{l.scope}</span>
            <span className={`min-w-0 ${TONE[l.tone]}`}>{l.text}</span>
          </li>
        ))}
      </ol>

      <div className="border-t border-line px-4 py-2.5">
        <span className="font-mono text-[11.5px] text-faint">
          nobody touched anything
          <span className="ml-1 inline-block h-3 w-[7px] translate-y-[2px] animate-pulse bg-accent" />
        </span>
      </div>
    </div>
  );
}
