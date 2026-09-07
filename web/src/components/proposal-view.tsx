"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { issuanceQueueAbi } from "@/lib/abis";
import { ISSUANCE_QUEUE } from "@/lib/deployments";
import { buildSchedule } from "@/lib/schedule";
import {
  annualisedRate,
  formatBps,
  formatDuration,
  formatRate,
  formatTimestamp,
  formatUsdc,
  shortAddress,
} from "@/lib/format";
import { txUrl, addressUrl } from "@/lib/chain";
import { Button, Chip, Eyebrow, Panel, SectionHead, Stat } from "./ui";
import { Lifecycle, type Stage } from "./lifecycle";
import { ErrorState, Skeleton } from "./states";
import { ScheduleChart } from "./schedule-chart";

/**
 * One screen, three audiences — see docs/05-web.md.
 *
 * What it offers depends on who is connected and what state the proposal is
 * in, because a proposal is a queue position: the most useful thing to tell
 * anyone looking at one is whose turn it is. It leads with the obligation
 * rather than a button, since it exists to make a consequential signature
 * legible.
 */

const STATUS = ["Proposed", "Accepted", "Approved", "Minted", "Rejected", "Expired"] as const;
type Status = (typeof STATUS)[number];

const STAGE_FOR: Partial<Record<Status, Stage>> = {
  Proposed: "accept",
  Accepted: "approve",
  Approved: "mint",
};

export function ProposalView({ id }: { id: string }) {
  const { address } = useAccount();
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const proposalId = safeBigInt(id);

  const proposal = useReadContract({
    address: ISSUANCE_QUEUE,
    abi: issuanceQueueAbi,
    functionName: "proposalOf",
    args: proposalId === null ? undefined : [proposalId],
    query: { enabled: proposalId !== null },
  });

  const admin = useReadContract({
    address: ISSUANCE_QUEUE,
    abi: issuanceQueueAbi,
    functionName: "isAdmin",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  if (proposalId === null) {
    return <ErrorState error={`"${id}" is not a proposal id.`} />;
  }
  if (proposal.isLoading) return <Skeleton rows={4} />;
  if (proposal.error) {
    return (
      <ErrorState
        error={
          /UnknownProposal/i.test(proposal.error.message)
            ? `Proposal #${id} does not exist.`
            : proposal.error
        }
        onRetry={() => void proposal.refetch()}
      />
    );
  }
  if (!proposal.data) return <Skeleton rows={4} />;

  const p = proposal.data;
  const status = STATUS[p.status] ?? "Proposed";
  const terms = p.terms;
  const me = address?.toLowerCase();
  const isBorrower = me === terms.borrower.toLowerCase();
  const isOriginator = me === p.originator.toLowerCase();
  const isAdmin = Boolean(admin.data);

  // Pinned once per mount. A ticking clock would re-run the schedule build
  // on every render and make the preview jitter, and the deadline does not
  // need second-by-second accuracy to be legible.
  const deadlinePassed = now > Number(terms.acceptDeadline);

  // Dates run from mint, which has not happened — the amounts are exact, the
  // dates are indicative, and the page says so rather than implying otherwise.
  const schedule = buildSchedule(
    {
      borrower: terms.borrower,
      principal: terms.principal,
      couponBps: terms.couponBps,
      servicingFeeBps: terms.servicingFeeBps,
      periodCount: terms.periodCount,
      periodLength: Number(terms.periodLength),
      gracePeriod: Number(terms.gracePeriod),
      cureWindow: Number(terms.cureWindow),
      acceptDeadline: Number(terms.acceptDeadline),
    },
    now,
  );

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Eyebrow>Proposal #{id}</Eyebrow>
          <h1 className="text-2xl font-medium tracking-tight">
            {formatUsdc(terms.principal)} <span className="text-muted">USDC</span>
          </h1>
          <p className="max-w-xl text-[13px] leading-relaxed text-muted">
            {whoseTurn(status, deadlinePassed)}
          </p>
        </div>
        <StatusChip status={status} />
      </div>

      {STAGE_FOR[status] ? <Lifecycle current={STAGE_FOR[status]} /> : null}

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-8">
          <section className="space-y-4">
            <SectionHead index="A" title="Parties" />
            <dl className="grid gap-px border border-line bg-line sm:grid-cols-2">
              <Party label="Originator" address={p.originator} you={isOriginator} />
              <Party label="Borrower" address={terms.borrower} you={isBorrower} />
            </dl>
          </section>

          <section className="space-y-4">
            <SectionHead index="B" title="The obligation" />
            <dl className="grid gap-px border border-line bg-line sm:grid-cols-3">
              {[
                ["Principal", formatUsdc(terms.principal)],
                ["Coupon", `${formatBps(terms.couponBps)} / period`],
                ["Periods", `${terms.periodCount} × ${formatDuration(Number(terms.periodLength))}`],
                ["Total repayable", formatUsdc(schedule.totalRepayment)],
                ["Implied APR", formatRate(annualisedRate(terms.couponBps, Number(terms.periodLength)))],
                ["Grace", formatDuration(Number(terms.gracePeriod))],
              ].map(([label, value]) => (
                <div key={label} className="bg-panel px-4 py-3.5">
                  <Stat label={label} value={value} />
                </div>
              ))}
            </dl>
            <Panel>
              <ScheduleChart schedule={schedule} />
            </Panel>
          </section>

          <section className="space-y-4">
            <SectionHead index="C" title="The agreement" />
            <Panel>
              <dl className="space-y-3">
                <Row label="Manifest hash">
                  <span className="break-all text-muted">{p.documentHash}</span>
                </Row>
                <Row label="Location">
                  <span className="break-all text-muted">{p.documentURI || "—"}</span>
                </Row>
              </dl>
              <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
                The manifest hash is what is committed on-chain. Anyone can
                recompute it from the files and compare; only the originator,
                the borrower and the admin can read the contents.
              </p>
            </Panel>
          </section>
        </div>

        <div className="space-y-4">
          <SectionHead index="D" title="Your turn" />
          <Actions
            proposalId={proposalId}
            status={status}
            isBorrower={isBorrower}
            isOriginator={isOriginator}
            isAdmin={isAdmin}
            deadlinePassed={deadlinePassed}
            acceptDeadline={Number(terms.acceptDeadline)}
            connected={Boolean(address)}
            onDone={() => void proposal.refetch()}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * Every branch of the write path. Controls a role cannot use are absent, not
 * disabled — before acceptance it is simply not the admin's turn, and a greyed
 * button invites someone to wonder what they did wrong.
 */
function Actions({
  proposalId,
  status,
  isBorrower,
  isOriginator,
  isAdmin,
  deadlinePassed,
  acceptDeadline,
  connected,
  onDone,
}: {
  proposalId: bigint;
  status: Status;
  isBorrower: boolean;
  isOriginator: boolean;
  isAdmin: boolean;
  deadlinePassed: boolean;
  acceptDeadline: number;
  connected: boolean;
  onDone: () => void;
}) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const [reason, setReason] = useState("");

  if (receipt.isSuccess) {
    return (
      <Panel>
        <Eyebrow className="text-accent">Done</Eyebrow>
        <p className="mt-2 text-[13px] text-muted">
          Recorded on-chain.{" "}
          <a className="underline underline-offset-2" href={txUrl(hash!)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
        <div className="mt-3">
          <Button onClick={onDone}>Refresh</Button>
        </div>
      </Panel>
    );
  }

  const send = (functionName: "accept" | "approve" | "mint" | "reject") => {
    reset();
    writeContract({
      address: ISSUANCE_QUEUE,
      abi: issuanceQueueAbi,
      functionName,
      args: functionName === "reject" ? [proposalId, reason] : [proposalId],
    } as Parameters<typeof writeContract>[0]);
  };

  const busy = isPending || receipt.isLoading;
  const label = busy ? (isPending ? "Confirm in wallet…" : "Recording…") : null;

  if (!connected) {
    return <Panel><p className="text-[13px] text-muted">Connect the wallet this proposal names to act on it.</p></Panel>;
  }

  if (status === "Rejected" || status === "Expired" || status === "Minted") {
    return (
      <Panel>
        <p className="text-[13px] text-muted">
          {status === "Minted"
            ? "This proposal has been minted. Nothing further is required here."
            : `This proposal is ${status.toLowerCase()} and cannot move further.`}
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      {status === "Proposed" && isBorrower && !deadlinePassed ? (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink">
            You are named as the borrower. Accepting records, from your own key,
            that you agree to this obligation.
          </p>
          <Button tone="primary" full disabled={busy} onClick={() => send("accept")}>
            {label ?? "Accept this proposal"}
          </Button>
          <p className="text-[12px] leading-relaxed text-muted">
            Doing nothing is a valid choice with a known outcome: after{" "}
            {formatTimestamp(acceptDeadline)} the proposal expires and anyone
            can close it. Nothing is minted and you owe nothing.
          </p>
        </div>
      ) : status === "Proposed" && isBorrower && deadlinePassed ? (
        <p className="text-[13px] text-muted">
          The acceptance window closed on {formatTimestamp(acceptDeadline)}. This
          proposal can no longer be accepted.
        </p>
      ) : status === "Accepted" && isAdmin ? (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink">
            The borrower has accepted. Read the agreement and decide. You can
            only block — you cannot alter terms, mint, or accept for anyone.
          </p>
          <Button tone="primary" full disabled={busy} onClick={() => send("approve")}>
            {label ?? "Approve"}
          </Button>
          <div className="space-y-2 border-t border-line pt-3">
            <input
              className="w-full rounded-card border border-line bg-raised px-3 py-2 font-mono text-[12px] text-ink"
              placeholder="Reason, shown to both parties"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              tone="danger"
              full
              disabled={busy || reason.trim().length === 0}
              onClick={() => send("reject")}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : status === "Approved" && isOriginator ? (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink">
            Approved. Minting deploys the note and gives you 100% of its supply;
            period one starts immediately.
          </p>
          <Button tone="primary" full disabled={busy} onClick={() => send("mint")}>
            {label ?? "Mint the note"}
          </Button>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">
          {waitingOn(status)} You are not the party being waited on, so there is
          nothing to sign here — but everything above is readable, which is the
          point.
        </p>
      )}

      {error ? (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-danger" role="alert">
          {friendly(error.message)}
        </p>
      ) : null}
    </Panel>
  );
}

function StatusChip({ status }: { status: Status }) {
  const tone =
    status === "Minted" ? "accent" : status === "Rejected" || status === "Expired" ? "danger" : "neutral";
  return <Chip tone={tone} dot>{status}</Chip>;
}

function Party({ label, address, you }: { label: string; address: string; you: boolean }) {
  return (
    <div className="bg-panel px-4 py-3.5">
      <p className="eyebrow">
        {label}
        {you ? " · you" : ""}
      </p>
      <a
        className="mt-1 block font-mono text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
      >
        {shortAddress(address)}
      </a>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <dt className="eyebrow w-28 shrink-0">{label}</dt>
      <dd className="min-w-0 font-mono text-[11.5px]">{children}</dd>
    </div>
  );
}

function whoseTurn(status: Status, deadlinePassed: boolean): string {
  if (status === "Proposed") {
    return deadlinePassed
      ? "The acceptance window has closed. Anyone can now expire this proposal."
      : "Waiting on the borrower to accept from their own key.";
  }
  if (status === "Accepted") return "Accepted. Waiting on an admin to read the agreement.";
  if (status === "Approved") return "Approved. Waiting on the originator to mint.";
  if (status === "Minted") return "Minted. The note exists and is accruing.";
  if (status === "Rejected") return "An admin rejected this proposal.";
  return "This proposal expired without being minted.";
}

function waitingOn(status: Status): string {
  if (status === "Proposed") return "Waiting on the borrower.";
  if (status === "Accepted") return "Waiting on an admin.";
  return "Waiting on the originator.";
}

/** Contract errors are precise but unreadable; the common ones get a sentence. */
function friendly(message: string): string {
  if (/NotBorrower/.test(message)) return "Only the named borrower can accept this.";
  if (/NotAdmin/.test(message)) return "Only an admin can approve or reject.";
  if (/NotOriginator/.test(message)) return "Only the originator can mint.";
  if (/AcceptWindowClosed/.test(message)) return "The acceptance window has closed.";
  if (/MintWindowClosed/.test(message)) return "The approval went stale — this proposal must be re-proposed.";
  if (/WrongStatus/.test(message)) return "This proposal has moved on; refresh the page.";
  if (/BorrowerNotVerified/.test(message)) return "The borrower is no longer verified.";
  if (/user rejected|denied transaction/i.test(message)) return "Transaction rejected.";
  return message;
}

function safeBigInt(v: string): bigint | null {
  try {
    if (!/^\d+$/.test(v)) return null;
    return BigInt(v);
  } catch {
    return null;
  }
}
