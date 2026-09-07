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
import {
  Button,
  Disclosure,
  Field,
  InlineInput,
  SectionHead,
  Segmented,
  Stat,
  inputClass as inputCls,
} from "./ui";
import { StackBadge } from "./stack";
import { ScheduleChart } from "./schedule-chart";
import { usePropose, STEP_LABEL } from "@/lib/use-propose";
import { txUrl } from "@/lib/chain";
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

const GRACE_OPTIONS = [
  { label: "5 min", value: 5 * MINUTE },
  { label: "1 hour", value: HOUR },
  { label: "1 day", value: DAY },
  { label: "3 days", value: 3 * DAY },
] as const;

const CURE_OPTIONS = [
  { label: "10 min", value: 10 * MINUTE },
  { label: "1 day", value: DAY },
  { label: "7 days", value: 7 * DAY },
  { label: "30 days", value: 30 * DAY },
] as const;

/** Errors from the fields that live in the sentence, shown together beneath it. */
const SENTENCE_FIELDS = ["principal", "borrower", "periodCount", "couponBps"] as const;

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

/**
 * Deal shapes people actually issue, so the common case is one click and the
 * form is where you adjust rather than where you start. "Demo" exists because
 * the contract's period floor is one minute precisely so a period can settle
 * on camera — see docs/02-contracts.md.
 */
const PRESETS = {
  receivable: {
    label: "Receivable",
    patch: { periodCount: "6", periodLength: 30 * DAY, couponBps: "85", gracePeriod: 3 * DAY, cureWindow: 30 * DAY },
  },
  advance: {
    label: "Revenue advance",
    patch: { periodCount: "12", periodLength: 30 * DAY, couponBps: "100", gracePeriod: 3 * DAY, cureWindow: 30 * DAY },
  },
  bridge: {
    label: "Short bridge",
    patch: { periodCount: "3", periodLength: 7 * DAY, couponBps: "150", gracePeriod: DAY, cureWindow: 7 * DAY },
  },
  demo: {
    label: "Demo · minutes",
    patch: { periodCount: "3", periodLength: MINUTE, couponBps: "100", gracePeriod: 5 * MINUTE, cureWindow: 10 * MINUTE },
  },
} as const;

type PresetKey = keyof typeof PRESETS | "custom";

const PRESET_OPTIONS = [
  ...(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => ({
    label: PRESETS[k].label,
    value: k as PresetKey,
  })),
  { label: "Custom", value: "custom" as PresetKey },
];

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
  // The hashed metadata drives the manifest preview; the File itself is what
  // actually gets uploaded, so both are kept together.
  const [docs, setDocs] = useState<(DocumentEntry & { file: File })[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  const documentHash = useMemo(() => manifestHash(docs), [docs]);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [preset, setPreset] = useState<PresetKey>("advance");
  const { propose, step, error: proposeError, result } = usePropose();

  function applyPreset(key: PresetKey) {
    setPreset(key);
    if (key === "custom") return;
    setDraft((d) => ({ ...d, ...PRESETS[key].patch }));
  }

  // Pinned once per mount: a clock that ticks would make the preview jitter
  // and re-run validation on every render.
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  // Touching anything by hand means this is no longer a named shape — say so
  // rather than leaving a preset highlighted that no longer describes the deal.
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setPreset("custom");
  };

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
  const busy = step !== "idle" && step !== "done";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked || !terms) return;
          void propose(terms, docs.map((d) => d.file));
        }}
      >
        <section className="space-y-4">
          <SectionHead
            index="A"
            title="Terms"
            aside={<StackBadge sponsor="arc" role="native USDC" muted />}
          />

          <Segmented
            label="Deal shape"
            options={PRESET_OPTIONS}
            value={preset}
            onChange={applyPreset}
          />

          {/*
            The terms as a sentence. Eight labelled boxes make you check eight
            things separately; one line makes the deal readable in a glance and
            makes a wrong number look wrong.
          */}
          <div className="rounded-card border border-line bg-panel p-5 text-[15px] leading-[2.2]">
            Lend{" "}
            <InlineInput
              aria-label="Principal"
              value={draft.principal}
              inputMode="decimal"
              min={9}
              invalid={Boolean(errorFor(errors, "principal") ?? parseError)}
              onChange={(e) => set("principal", e.target.value)}
            />{" "}
            <span className="text-muted">USDC to</span>{" "}
            <InlineInput
              aria-label="Borrower address"
              value={draft.borrower}
              placeholder="0x…"
              spellCheck={false}
              min={12}
              className="text-[13px]"
              invalid={Boolean(errorFor(errors, "borrower"))}
              onChange={(e) => set("borrower", e.target.value)}
            />
            <span className="text-muted">, repaid over</span>{" "}
            <InlineInput
              aria-label="Number of periods"
              value={draft.periodCount}
              inputMode="numeric"
              min={3}
              invalid={Boolean(errorFor(errors, "periodCount"))}
              onChange={(e) => set("periodCount", e.target.value)}
            />{" "}
            <span className="text-muted">periods, paying</span>{" "}
            <InlineInput
              aria-label="Coupon in basis points per period"
              value={draft.couponBps}
              inputMode="numeric"
              min={4}
              invalid={Boolean(errorFor(errors, "couponBps"))}
              onChange={(e) => set("couponBps", e.target.value)}
            />{" "}
            <span className="text-muted">bps each.</span>
          </div>

          <div className="space-y-2">
            <p className="eyebrow">Period length</p>
            <Segmented
              label="Period length"
              options={PERIOD_LENGTHS}
              value={draft.periodLength}
              onChange={(v) => set("periodLength", v)}
            />
          </div>

          {/* Errors from the sentence, gathered where they can be read. */}
          {SENTENCE_FIELDS.map((f) => {
            const message = f === "principal" ? (errorFor(errors, f) ?? parseError) : errorFor(errors, f);
            return message ? (
              <p key={f} className="font-mono text-[11px] text-danger">
                {message}
              </p>
            ) : null;
          })}

          {terms ? (
            <p className="text-[12px] text-muted">
              {formatBps(terms.couponBps)} per {formatDuration(terms.periodLength)} period
              {" · ≈"}
              {formatRate(apr)} APR
            </p>
          ) : null}

          <Disclosure summary="Servicing & deadlines · defaults are fine">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="eyebrow">Grace period</p>
                <Segmented
                  label="Grace period"
                  options={GRACE_OPTIONS}
                  value={draft.gracePeriod}
                  onChange={(v) => set("gracePeriod", v)}
                />
                <p className="text-[11px] text-muted">After a period ends, before it is late.</p>
              </div>
              <div className="space-y-2">
                <p className="eyebrow">Cure window</p>
                <Segmented
                  label="Cure window"
                  options={CURE_OPTIONS}
                  value={draft.cureWindow}
                  onChange={(v) => set("cureWindow", v)}
                />
                {errorFor(errors, "cureWindow") ? (
                  <p className="font-mono text-[11px] text-danger">{errorFor(errors, "cureWindow")}</p>
                ) : null}
              </div>
              <Field
                label="Servicing fee"
                hint="Basis points of each repayment."
                error={errorFor(errors, "servicingFeeBps")}
              >
                <input
                  className={inputCls}
                  value={draft.servicingFeeBps}
                  inputMode="numeric"
                  onChange={(e) => set("servicingFeeBps", e.target.value)}
                />
              </Field>
              <Field
                label="Acceptance window (hours)"
                hint="After this the proposal expires and anyone can close it."
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
          </Disclosure>

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
                  file: f,
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

        <Button type="submit" tone="primary" full disabled={blocked || busy}>
          {busy
            ? "Working…"
            : blocked
              ? "Fix the errors above"
              : "Seal and propose"}
        </Button>

        {busy ? (
          <p className="font-mono text-[11px] text-muted" aria-live="polite">
            {STEP_LABEL[step as Exclude<typeof step, "idle" | "done">]}
          </p>
        ) : null}

        {proposeError ? (
          <p className="font-mono text-[11px] text-danger" role="alert">
            {proposeError}
          </p>
        ) : null}

        {result ? (
          <div className="rounded-card border border-accent/40 bg-accent-faint px-3.5 py-3">
            <p className="eyebrow text-accent">Proposed</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink/80">
              The documents are sealed and the proposal is on-chain. It is now
              the borrower&apos;s turn to accept.{" "}
              <a
                className="underline underline-offset-2"
                href={txUrl(result.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </p>
          </div>
        ) : null}
        <p className="text-[12px] leading-relaxed text-muted">
          Submitting is not wired up yet: sealing the draft has to upload these
          files and return the manifest hash before the transaction can be
          built. Hashing is live and runs in your browser, so the hash shown
          above is the one that will go on-chain. A proposal still needs the
          borrower to accept and an admin to approve before anything mints.
        </p>
      </form>

      <section className="space-y-4">
        <SectionHead index="C" title="Schedule preview" />
        {schedule && terms ? (
          <>
            <div className="rounded-card border border-line bg-panel">
              <div className="flex flex-wrap items-end justify-between gap-6 px-5 pt-5">
                <div>
                  <p className="eyebrow">Total repayment</p>
                  <p className="mt-1.5 font-mono text-[32px] leading-none tracking-tight tnum">
                    {formatUsdc(schedule.totalRepayment)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="eyebrow">Implied APR</p>
                  <p className="mt-1.5 font-mono text-[32px] leading-none tracking-tight tnum text-accent">
                    {formatRate(apr)}
                  </p>
                </div>
              </div>

              <div className="px-5 pt-6 pb-5">
                <ScheduleChart schedule={schedule} />
              </div>

              <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
                {[
                  ["Coupon / period", formatUsdc(schedule.couponPerPeriod)],
                  ["Total coupons", formatUsdc(schedule.totalCoupons)],
                  ["Servicing fees", formatUsdc(schedule.servicingFeeTotal)],
                  ["Maturity", formatTimestamp(schedule.maturity)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-panel px-4 py-3.5">
                    <Stat label={label} value={value} />
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-[12px] leading-relaxed text-muted">
              Dates assume the note mints now. The real schedule starts when it
              actually does, so these shift — the shape and the amounts do not.
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
