import { Chip } from "./ui";

/**
 * What a paid /intel query actually returns.
 *
 * Showing the artifact beats describing it: the whole claim is that servicing
 * produces a dataset worth money, and a reader can judge that in two seconds
 * from the shape of a real response. Figures are illustrative — the endpoint
 * serves indexed history — and the page says so.
 */
const ROWS: { label: string; value: string; tone?: "accent" | "warn" }[] = [
  { label: "on-time rate", value: "0.83", tone: "accent" },
  { label: "periods settled", value: "10" },
  { label: "periods missed", value: "2", tone: "warn" },
  { label: "cured after missing", value: "1" },
  { label: "principal repaid", value: "84,000.00" },
  { label: "notes matured", value: "1" },
];

export function SampleScorecard() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11.5px] text-muted">
          GET <span className="text-ink">/intel/borrower/0x…</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Chip tone="warn">402</Chip>
          <span className="text-faint">→</span>
          <Chip tone="accent" dot>
            paid 0.50
          </Chip>
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line">
        {ROWS.map((r) => (
          <div key={r.label} className="bg-panel px-4 py-3">
            <dt className="eyebrow">{r.label}</dt>
            <dd
              className={`mt-1 font-mono text-[15px] tnum ${
                r.tone === "accent" ? "text-accent" : r.tone === "warn" ? "text-warn" : "text-ink"
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-relaxed text-faint">
        no account · no API key · payment is the auth
      </p>
    </div>
  );
}
