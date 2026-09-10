"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatBaseUnits } from "@/lib/format";
import { Chip } from "./ui";

/**
 * What a paid /intel query returns, and what it costs.
 *
 * This used to show invented figures — an 0.83 on-time rate against 84,000
 * repaid, captioned "illustrative". On a page arguing that servicing produces
 * a dataset worth money, numbers nobody measured are the one thing that cannot
 * appear, however carefully they are labelled.
 *
 * So: the real prices, read from the free /intel/pricing endpoint, and the
 * real field names the scorecard answers with. No values, because the values
 * belong to whichever address a buyer asks about, and this page has not asked.
 */

type Pricing = {
  decimals: number;
  endpoints: { path: string; price: string; description: string }[];
};

/**
 * The shape of `BorrowerScorecard` — backend/src/intel/reader.ts. Field names
 * only. If that type changes this list goes stale, which is the cost of
 * showing a real shape rather than a picture of one.
 */
const FIELDS = [
  "notesAccepted",
  "notesMatured",
  "notesDefaulted",
  "principalOwed",
  "principalRepaid",
  "periods.settled",
  "periods.missed",
  "periods.cured",
  "punctuality.onTimeRate",
  "punctuality.curedAfterMissing",
  "asOfBlock",
];

export function IntelPreview() {
  const pricing = useQuery({
    queryKey: ["intel", "pricing"],
    queryFn: () => api<Pricing>("/intel/pricing"),
    retry: false,
  });

  const borrower = pricing.data?.endpoints.find((e) => e.path.includes("/borrower/"));
  const decimals = pricing.data?.decimals ?? 6;

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
            {borrower ? `paid ${formatBaseUnits(BigInt(borrower.price), decimals)}` : "paid"}
          </Chip>
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="eyebrow">answers with</p>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {FIELDS.map((f) => (
            <li key={f} className="font-mono text-[11.5px] text-muted">
              {f}
            </li>
          ))}
        </ul>
      </div>

      {pricing.data ? (
        <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
          {pricing.data.endpoints.map((e) => (
            <div key={e.path} className="bg-panel px-4 py-3">
              <dt className="font-mono text-[10.5px] break-all text-faint">
                {e.path.replace("/intel/", "")}
              </dt>
              <dd className="mt-1 font-mono text-[15px] text-accent tnum">
                ${formatBaseUnits(BigInt(e.price), decimals)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-relaxed text-faint">
        no account · no API key · payment is the auth
      </p>
    </div>
  );
}
