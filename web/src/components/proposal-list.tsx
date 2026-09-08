"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useRowLink } from "@/lib/use-row-link";
import { query } from "@/lib/subgraph";
import { formatTimestamp, shortAddress } from "@/lib/format";
import { Chip, Eyebrow, SectionHead } from "./ui";
import { EmptyState, ErrorState, Skeleton } from "./states";
import { StackBadge } from "./stack";

/**
 * Every proposal, and — when a wallet is connected — the ones waiting on it
 * first.
 *
 * This exists because a proposal is otherwise undiscoverable: propose() emits
 * an id and nothing hands it to the borrower, so without a list the only way
 * to reach /proposal/[id] is to be told the number. The borrower is the party
 * least likely to have been told.
 *
 * Read from the subgraph rather than the chain: "every proposal naming this
 * address" is a query over history, which is exactly what an index is for and
 * exactly what a contract cannot answer.
 */
const PROPOSALS = `
  query Proposals {
    proposals(first: 100, orderBy: proposedAt, orderDirection: desc) {
      id
      proposalId
      status
      proposedAt
      originator { id }
      borrower { id }
      note { id }
    }
  }
`;

type Row = {
  id: string;
  proposalId: string;
  status: "Proposed" | "Accepted" | "Approved" | "Minted" | "Rejected" | "Expired";
  proposedAt: string;
  originator: { id: string };
  borrower: { id: string };
  note: { id: string } | null;
};

export function ProposalList() {
  const { address } = useAccount();
  const me = address?.toLowerCase();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["proposals"],
    queryFn: () => query<{ proposals: Row[] }>(PROPOSALS),
  });

  if (isLoading) return <Skeleton rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const all = data?.proposals ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        title="No proposals yet"
        hint="A proposal appears here the moment one is made on-chain. Start one on /propose — you and the borrower both need to be verified first."
      />
    );
  }

  // "Waiting on you" is the only thing most people come here for, so it is
  // computed rather than left for the reader to scan for.
  const yours = me
    ? all.filter(
        (p) =>
          (p.status === "Proposed" && p.borrower.id.toLowerCase() === me) ||
          (p.status === "Approved" && p.originator.id.toLowerCase() === me),
      )
    : [];

  return (
    <div className="space-y-10">
      {yours.length > 0 ? (
        <section className="space-y-4">
          <SectionHead index="A" title="Waiting on you" />
          <Table rows={yours} me={me} />
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHead
          index={yours.length > 0 ? "B" : "A"}
          title="All proposals"
          aside={<StackBadge sponsor="graph" role="indexed history" muted />}
        />
        <Table rows={all} me={me} />
      </section>
    </div>
  );
}

function Table({ rows, me }: { rows: Row[]; me: string | undefined }) {
  const rowLink = useRowLink();
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">#</th>
            <th className="eyebrow p-3">Status</th>
            <th className="eyebrow p-3">Originator</th>
            <th className="eyebrow p-3">Borrower</th>
            <th className="eyebrow p-3">Proposed</th>
            <th className="eyebrow p-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              onClick={rowLink(`/proposal/${p.proposalId}`)}
              className="cursor-pointer border-b border-line last:border-0 hover:bg-panel"
            >
              <td className="p-3">
                <Link
                  href={`/proposal/${p.proposalId}`}
                  className="font-mono text-[13px] text-accent underline-offset-2 hover:underline"
                >
                  #{p.proposalId}
                </Link>
              </td>
              <td className="p-3">
                <StatusChip status={p.status} />
              </td>
              <td className="p-3">
                <Who address={p.originator.id} me={me} />
              </td>
              <td className="p-3">
                <Who address={p.borrower.id} me={me} />
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                {formatTimestamp(Number(p.proposedAt))}
              </td>
              <td className="p-3">
                {p.note ? (
                  <Link
                    href={`/note/${p.note.id}`}
                    className="font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                  >
                    {shortAddress(p.note.id)}
                  </Link>
                ) : (
                  <span className="font-mono text-[12px] text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Who({ address, me }: { address: string; me: string | undefined }) {
  const isMe = me !== undefined && address.toLowerCase() === me;
  return (
    <span className={`font-mono text-[12px] ${isMe ? "text-ink" : "text-muted"}`}>
      {shortAddress(address)}
      {isMe ? <Eyebrow className="mt-0.5">you</Eyebrow> : null}
    </span>
  );
}

function StatusChip({ status }: { status: Row["status"] }) {
  const tone =
    status === "Minted"
      ? "accent"
      : status === "Rejected" || status === "Expired"
        ? "danger"
        : status === "Proposed"
          ? "warn"
          : "neutral";
  return (
    <Chip tone={tone} dot>
      {status}
    </Chip>
  );
}
