"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { keccak256 } from "viem";
import { buildSchedule } from "@/lib/schedule";
import { validateProposal, errorFor, ZERO_HASH, type Terms } from "@/lib/terms";
import {
  annualisedRate,
  formatBps,
  formatRate,
  formatUsdc,
  formatTimestamp,
  formatDuration,
  parseUsdc,
} from "@/lib/format";

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

const PERIOD_LENGTHS = [
  { label: "1 minute (demo)", value: MINUTE },
  { label: "5 minutes (demo)", value: 5 * MINUTE },
  { label: "1 hour", value: HOUR },
  { label: "1 day", value: DAY },
  { label: "7 days", value: 7 * DAY },
  { label: "30 days", value: 30 * DAY },
] as const;

type Draft = {
  borrower: string;
  principal: string;
  minPrincipal: string;
  couponBps: string;
  servicingFeeBps: string;
  periodCount: string;
  periodLength: number;
  fundingDeadlineHours: string;
  gracePeriod: number;
  cureWindow: number;
};

const INITIAL: Draft = {
  borrower: "",
  principal: "100,000.00",
  minPrincipal: "50,000.00",
  couponBps: "100",
  servicingFeeBps: "50",
  periodCount: "12",
  periodLength: 30 * DAY,
  fundingDeadlineHours: "48",
  gracePeriod: 3 * DAY,
  cureWindow: 30 * DAY,
};

function toTerms(d: Draft, now: number): { terms: Terms | null; parseError?: string } {
  try {
    return {
      terms: {
        borrower: d.borrower.trim(),
        principal: parseUsdc(d.principal),
        minPrincipal: parseUsdc(d.minPrincipal),
        couponBps: Number(d.couponBps || 0),
        servicingFeeBps: Number(d.servicingFeeBps || 0),
        periodCount: Number(d.periodCount || 0),
        periodLength: d.periodLength,
        fundingDeadline: now + Number(d.fundingDeadlineHours || 0) * HOUR,
        gracePeriod: d.gracePeriod,
        cureWindow: d.cureWindow,
      },
    };
  } catch (e) {
    return { terms: null, parseError: e instanceof Error ? e.message : "invalid amount" };
  }
}

export function ProposeForm() {
  const { address, isConnected } = useAccount();
  const [documentHash, setDocumentHash] = useState<string>(ZERO_HASH);
  const [documentName, setDocumentName] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(INITIAL);

  // Pinned once per mount: a clock that ticks would make the preview jitter
  // and re-run validation on every render.
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const { terms, parseError } = useMemo(() => toTerms(draft, now), [draft, now]);
  const errors = useMemo(
    () => (terms ? validateProposal(terms, documentHash, address, now) : []),
    [terms, documentHash, address, now],
  );
  const schedule = useMemo(
    () => (terms && errors.length === 0 ? buildSchedule(terms, now) : null),
    [terms, errors, now],
  );

  const apr = terms ? annualisedRate(terms.couponBps, terms.periodLength) : 0;
  const blocked = !terms || errors.length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        <Field
          label="Borrower"
          hint="The counterparty who owes on this loan. Must be verified, and cannot be you."
          error={errorFor(errors, "borrower")}
        >
          <input
            className={inputCls}
            placeholder="0x…"
            spellCheck={false}
            value={draft.borrower}
            onChange={(e) => set("borrower", e.target.value)}
          />
        </Field>

        <Field
          label="Signed agreement"
          hint={
            documentName
              ? `${documentName} · ${documentHash.slice(0, 10)}…${documentHash.slice(-6)}`
              : "Hashed in your browser. The file is never uploaded here — only its hash reaches the chain."
          }
          error={errorFor(errors, "documentHash")}
        >
          <input
            type="file"
            className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-black/5 file:px-2 file:py-1 file:text-xs dark:file:bg-white/10`}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) {
                setDocumentHash(ZERO_HASH);
                setDocumentName("");
                return;
              }
              const bytes = new Uint8Array(await file.arrayBuffer());
              setDocumentHash(keccak256(bytes));
              setDocumentName(file.name);
            }}
          />
        </Field>

        <Field
          label="Principal"
          hint="Target raise, in USDC."
          error={errorFor(errors, "principal") ?? parseError}
        >
          <input
            className={inputCls}
            value={draft.principal}
            inputMode="decimal"
            onChange={(e) => set("principal", e.target.value)}
          />
        </Field>

        <Field
          label="Minimum raise"
          hint="Below this at the deadline, the note cancels and lenders are refunded."
          error={errorFor(errors, "minPrincipal")}
        >
          <input
            className={inputCls}
            value={draft.minPrincipal}
            inputMode="decimal"
            onChange={(e) => set("minPrincipal", e.target.value)}
          />
        </Field>

        <Field
          label="Coupon"
          hint={
            terms
              ? `${formatBps(terms.couponBps)} per ${formatDuration(terms.periodLength)} period · ≈${formatRate(apr)} APR`
              : "Basis points per period."
          }
          error={errorFor(errors, "couponBps")}
        >
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={draft.couponBps}
              inputMode="numeric"
              onChange={(e) => set("couponBps", e.target.value)}
            />
            <span className="text-xs opacity-60">bps</span>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Periods" error={errorFor(errors, "periodCount")}>
            <input
              className={inputCls}
              value={draft.periodCount}
              inputMode="numeric"
              onChange={(e) => set("periodCount", e.target.value)}
            />
          </Field>
          <Field label="Period length" error={errorFor(errors, "periodLength")}>
            <select
              className={inputCls}
              value={draft.periodLength}
              onChange={(e) => set("periodLength", Number(e.target.value))}
            >
              {PERIOD_LENGTHS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Grace period" hint="After a period ends, before it is late.">
            <select
              className={inputCls}
              value={draft.gracePeriod}
              onChange={(e) => set("gracePeriod", Number(e.target.value))}
            >
              <option value={5 * MINUTE}>5 minutes (demo)</option>
              <option value={HOUR}>1 hour</option>
              <option value={DAY}>1 day</option>
              <option value={3 * DAY}>3 days</option>
            </select>
          </Field>
          <Field label="Cure window" error={errorFor(errors, "cureWindow")}>
            <select
              className={inputCls}
              value={draft.cureWindow}
              onChange={(e) => set("cureWindow", Number(e.target.value))}
            >
              <option value={10 * MINUTE}>10 minutes (demo)</option>
              <option value={DAY}>1 day</option>
              <option value={7 * DAY}>7 days</option>
              <option value={30 * DAY}>30 days</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Servicing fee" hint="Basis points of each repayment." error={errorFor(errors, "servicingFeeBps")}>
            <input
              className={inputCls}
              value={draft.servicingFeeBps}
              inputMode="numeric"
              onChange={(e) => set("servicingFeeBps", e.target.value)}
            />
          </Field>
          <Field label="Funding window" hint="Hours from now." error={errorFor(errors, "fundingDeadline")}>
            <input
              className={inputCls}
              value={draft.fundingDeadlineHours}
              inputMode="numeric"
              onChange={(e) => set("fundingDeadlineHours", e.target.value)}
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled
          title="PartyRegistry and IssuanceQueue are not deployed yet"
          className="w-full rounded border border-current px-4 py-2 text-sm font-medium opacity-40"
        >
          {blocked ? "Fix the errors above" : "Propose note"}
        </button>
        <p className="text-xs opacity-60">
          Proposing is disabled until <code>PartyRegistry</code> and{" "}
          <code>IssuanceQueue</code> are deployed. The preview is live — it uses
          the same schedule maths the contract will. Nothing mints here: a
          proposal still needs the borrower to accept and an admin to approve
          the agreement.
        </p>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Schedule preview</h2>
        {schedule && terms ? (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
              <Stat label="Coupon per period" value={formatUsdc(schedule.couponPerPeriod)} />
              <Stat label="Total coupons" value={formatUsdc(schedule.totalCoupons)} />
              <Stat label="Total repayment" value={formatUsdc(schedule.totalRepayment)} />
              <Stat label="Servicing fees" value={formatUsdc(schedule.servicingFeeTotal)} />
              <Stat label="Maturity" value={formatTimestamp(schedule.maturity)} />
              <Stat label="Implied APR" value={formatRate(apr)} />
            </dl>

            <p className="text-xs opacity-60">
              Dates assume funding closes now. The real schedule starts when the
              note actually activates, so these shift — the shape and the amounts
              do not.
            </p>

            <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
              <table className="w-full text-sm">
                <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide opacity-60 dark:border-white/15">
                  <tr>
                    <th className="p-2 font-medium">#</th>
                    <th className="p-2 font-medium">Ends</th>
                    <th className="p-2 text-right font-medium">Coupon</th>
                    <th className="p-2 text-right font-medium">Principal</th>
                    <th className="p-2 text-right font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.map((r) => (
                    <tr key={r.index} className="border-b border-black/5 last:border-0 dark:border-white/10">
                      <td className="p-2 tabular-nums opacity-60">{r.index + 1}</td>
                      <td className="p-2 whitespace-nowrap">{formatTimestamp(r.end)}</td>
                      <td className="p-2 text-right tabular-nums">{formatUsdc(r.coupon)}</td>
                      <td className="p-2 text-right tabular-nums opacity-60">
                        {r.principalDue > 0n ? formatUsdc(r.principalDue) : "—"}
                      </td>
                      <td className="p-2 text-right font-medium tabular-nums">
                        {formatUsdc(r.due)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm opacity-70 dark:border-white/20">
            {parseError ?? "Fix the errors on the left to see the schedule."}
          </div>
        )}
        {!isConnected ? (
          <p className="text-xs opacity-60">
            Connect a wallet to propose. The preview works without one.
          </p>
        ) : null}
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="block text-xs opacity-60">{hint}</span>
      ) : null}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
