import { Fragment } from "react";

/**
 * Where a note is in propose → accept → approve → mint, and whose turn it is.
 *
 * The order is enforced on-chain (IssuanceQueue), so this is not decoration:
 * a proposal is a queue position, and the single most useful thing to tell
 * someone looking at one is which of four people is being waited on.
 */
export const STAGES = [
  { key: "propose", label: "Propose", actor: "originator" },
  { key: "accept", label: "Accept", actor: "borrower" },
  { key: "approve", label: "Approve", actor: "admin" },
  { key: "mint", label: "Mint", actor: "originator" },
] as const;

export type Stage = (typeof STAGES)[number]["key"];

export function Lifecycle({ current }: { current: Stage }) {
  const index = STAGES.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-wrap items-stretch gap-px border border-line bg-line">
      {STAGES.map((stage, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <Fragment key={stage.key}>
            <li
              className={`flex min-w-[132px] flex-1 flex-col gap-1 px-4 py-3 ${
                active ? "bg-panel" : "bg-canvas"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[10.5px] tracking-widest ${
                    done ? "text-accent" : active ? "text-ink" : "text-faint"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-[13px] ${
                    active ? "font-medium text-ink" : done ? "text-muted" : "text-faint"
                  }`}
                >
                  {stage.label}
                </span>
                {active ? (
                  <span className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                ) : null}
              </div>
              <span className="eyebrow">{stage.actor}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
