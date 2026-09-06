"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { buildSchedule } from "@/lib/schedule";
import {
  hashFile,
  manifestHash,
  dedupe,
  rejectReason,
  MAX_FILES,
  type DocumentEntry,
} from "@/lib/manifest";
import {
  validateProposal,
  validateTerms,
  errorFor,
  type Terms,
} from "@/lib/terms";
import { Button, Field, SectionHead, Stat, inputClass as inputCls } from "./ui";
import { StackBadge } from "./stack";
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
  couponBps: string;
  servicingFeeBps: string;
  periodCount: string;
  periodLength: number;
  gracePeriod: number;
  cureWindow: number;
  acceptHours: string;
};

const INITIAL: Draft = {
  borrower: "",
  principal: "100,000.00",
  couponBps: "100",
  servicingFeeBps: "50",
  periodCount: "12",
  periodLength: 30 * DAY,
  gracePeriod: 3 * DAY,
  cureWindow: 30 * DAY,
  acceptHours: "48",
};

function toTerms(d: Draft, now: number): { terms: Terms | null; parseError?: string } {
  try {
    return {
      terms: {
        borrower: d.borrower.trim(),
        principal: parseUsdc(d.principal),
        couponBps: Number(d.couponBps || 0),
        servicingFeeBps: Number(d.servicingFeeBps || 0),
        periodCount: Number(d.periodCount || 0),
        periodLength: d.periodLength,
        gracePeriod: d.gracePeriod,
        cureWindow: d.cureWindow,
        acceptDeadline: now + Number(d.acceptHours || 0) * HOUR,
      },
    };
  } catch (e) {
    return { terms: null, parseError: e instanceof Error ? e.message : "invalid amount" };
  }
}

export function ProposeForm() {
  const { address, isConnected } = useAccount();
  const [docs, setDocs] = useState<DocumentEntry[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  const documentHash = useMemo(() => manifestHash(docs), [docs]);
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
  // The schedule depends on the terms alone, so it renders as soon as those are
  // valid — an unfilled borrower or a missing document should not blank out the
  // preview the originator is using to check their own numbers.
  const termErrors = useMemo(
    () => (terms ? validateTerms(terms, now) : []),
    [terms, now],
  );
  const schedule = useMemo(
    () => (terms && termErrors.length === 0 ? buildSchedule(terms, now) : null),
    [terms, termErrors, now],
  );

  const apr = terms ? annualisedRate(terms.couponBps, terms.periodLength) : 0;
  const blocked = !terms || errors.length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
        <section className="space-y-4">
          <SectionHead index="A" title="Counterparty" />
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

        </section>

        <section className="space-y-4">
          <SectionHead index="B" title="Agreement" />
        <Field
          label="Agreement documents"
          hint={
            docs.length
              ? `${docs.length} file${docs.length === 1 ? "" : "s"} · manifest ${documentHash.slice(0, 10)}…${documentHash.slice(-6)}`
              : "Every document behind the loan. The admin reads these before approving — without them there is nothing to review."
          }
          error={errorFor(errors, "documentHash") ?? docError ?? undefined}
        >
          <input
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg"
            className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-xs file:text-muted`}
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!picked.length) return;

              const rejected = picked
                .map((f) => {
                  const why = rejectReason(f);
                  return why ? `${f.name}: ${why}` : null;
                })
                .filter(Boolean);
              setDocError(rejected.length ? rejected.join(" ") : null);

              const accepted = picked.filter((f) => !rejectReason(f));
              const hashed = await Promise.all(
                accepted.map(async (f) => ({
                  filename: f.name,
                  contentType: f.type,
                  byteSize: f.size,
                  contentHash: await hashFile(f),
                })),
              );
              setDocs((prev) => {
                const merged = dedupe([...prev, ...hashed]);
                if (merged.length > MAX_FILES) {
                  setDocError(`At most ${MAX_FILES} documents.`);
                  return merged.slice(0, MAX_FILES);
                }
                return merged;
              });
            }}
          />
        </Field>

        {docs.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {docs.map((d) => (
              <li
                key={d.contentHash}
                className="flex items-center gap-2 rounded-card border border-line px-2.5 py-1.5"
              >
                <span className="truncate">{d.filename}</span>
                <span className="ml-auto shrink-0 text-faint">
                  {(d.byteSize / 1024).toFixed(0)} KB
                </span>
                <code className="shrink-0 text-faint">
                  {d.contentHash.slice(0, 8)}…
                </code>
                <button
                  type="button"
                  aria-label={`Remove ${d.filename}`}
                  className="shrink-0 text-faint hover:text-ink"
                  onClick={() =>
                    setDocs((prev) => prev.filter((x) => x.contentHash !== d.contentHash))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        </section>

        <section className="space-y-4">
          <SectionHead
            index="C"
            title="Terms"
            aside={<StackBadge sponsor="arc" role="native USDC" muted />}
          />
        <Field
          label="Principal"
          hint="Face value of the loan, in USDC. This is also the token supply — you hold all of it at mint."
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
            <span className="eyebrow">bps</span>
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
          <Field
            label="Acceptance window"
            hint="Hours the borrower has to accept. After that the proposal expires and anyone can close it."
            error={errorFor(errors, "acceptDeadline")}
          >
            <input
              className={inputCls}
              value={draft.acceptHours}
              inputMode="numeric"
              onChange={(e) => set("acceptHours", e.target.value)}
            />
          </Field>
        </div>

        </section>

        <Button
          type="submit"
          tone="primary"
          full
          disabled
          title="The seal-then-propose path is not wired up yet"
        >
          {blocked ? "Fix the errors above" : "Seal and propose"}
        </Button>
        <p className="text-[12px] leading-relaxed text-muted">
          Submitting is not wired up yet: sealing the draft has to upload these
          files and return the manifest hash before the transaction can be
          built. Hashing is live and runs in your browser, so the hash shown
          above is the one that will go on-chain. A proposal still needs the
          borrower to accept and an admin to approve before anything mints.
        </p>
      </form>

      <section className="space-y-4">
        <SectionHead index="D" title="Schedule preview" />
        {schedule && terms ? (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-card border border-line bg-panel p-5">
              <Stat label="Coupon per period" value={formatUsdc(schedule.couponPerPeriod)} />
              <Stat label="Total coupons" value={formatUsdc(schedule.totalCoupons)} />
              <Stat label="Total repayment" value={formatUsdc(schedule.totalRepayment)} />
              <Stat label="Servicing fees" value={formatUsdc(schedule.servicingFeeTotal)} />
              <Stat label="Maturity" value={formatTimestamp(schedule.maturity)} />
              <Stat label="Implied APR" value={formatRate(apr)} />
            </dl>

            <p className="text-[12px] leading-relaxed text-muted">
              Dates assume funding closes now. The real schedule starts when the
              note actually activates, so these shift — the shape and the amounts
              do not.
            </p>

            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left">
                  <tr>
                    <th className="eyebrow p-2.5">#</th>
                    <th className="eyebrow p-2.5">Ends</th>
                    <th className="eyebrow p-2.5 text-right">Coupon</th>
                    <th className="eyebrow p-2.5 text-right">Principal</th>
                    <th className="eyebrow p-2.5 text-right">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.map((r) => (
                    <tr key={r.index} className="border-b border-line last:border-0">
                      <td className="p-2.5 font-mono text-[11px] tnum text-faint">{r.index + 1}</td>
                      <td className="p-2.5 font-mono text-[12px] whitespace-nowrap text-muted">{formatTimestamp(r.end)}</td>
                      <td className="p-2.5 text-right font-mono text-[12px] tnum">{formatUsdc(r.coupon)}</td>
                      <td className="p-2.5 text-right font-mono tnum text-muted">
                        {r.principalDue > 0n ? formatUsdc(r.principalDue) : "—"}
                      </td>
                      <td className="p-2.5 text-right font-mono text-[12px] tnum text-ink">
                        {formatUsdc(r.due)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-card border border-dashed border-line-strong p-10 text-center text-[13px] text-muted">
            {parseError ?? "Fix the errors on the left to see the schedule."}
          </div>
        )}
        {!isConnected ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Connect a wallet to propose. The preview works without one.
          </p>
        ) : null}
      </section>
    </div>
  );
}
