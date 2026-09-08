/**
 * The shapes the subgraph returns for one note.
 *
 * They live here rather than beside the query because two components read
 * them — the detail view and the offering panel — and having either import
 * types from the other would tie the pair together for no reason.
 *
 * Every money field is a decimal string of base units, exactly as the index
 * stores it. Nothing here is a `number`: one USDC does not fit in a float at
 * 18 decimals, so these stay strings until a BigInt takes them.
 */

export type Period = {
  index: number;
  start: string;
  end: string;
  due: string;
  paid: string;
  status: "Pending" | "Settled" | "Missed" | "Cured";
  settledAt: string | null;
  latenessSeconds: string | null;
  distributed: string | null;
  servicingFee: string | null;
};

export type NoteDetail = {
  id: string;
  noteId: string;
  status: "Active" | "Delinquent" | "Matured" | "Defaulted";
  principal: string;
  couponBps: number;
  servicingFeeBps: number;
  periodCount: number;
  periodLength: string;
  gracePeriod: string;
  cureWindow: string;
  mintedAt: string;
  closedAt: string | null;
  documentHash: string;
  agent: string | null;
  listedAmount: string;
  soldAmount: string;
  originatorRetained: string;
  periodsSettled: number;
  periodsMissed: number;
  totalRepaid: string;
  totalDistributed: string;
  servicingFeesPaid: string;
  originator: {
    id: string;
    notesMinted: number;
    notesMatured: number;
    notesDefaulted: number;
    periodsSettled: number;
    periodsMissed: number;
  };
  borrower: {
    id: string;
    notesAccepted: number;
    periodsSettled: number;
    periodsMissed: number;
    periodsCured: number;
    totalDaysLate: string;
  };
  proposal: {
    proposalId: string;
    digest: string;
    documentURI: string;
    proposedAt: string;
    acceptedAt: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    proposedTx: string;
  } | null;
  periods: Period[];
  actions: {
    id: string;
    kind: "Settled" | "MarkedDelinquent" | "Defaulted";
    periodIndex: number | null;
    amount: string | null;
    timestamp: string;
    txHash: string;
  }[];
};

export type Listing = {
  amount: string;
  priceBps: number;
  open: boolean;
  listedTotal: string;
  delistedTotal: string;
  updatedAt: string;
} | null;

export type Position = {
  holder: string;
  balance: string;
  bought: string;
  paid: string;
  claimed: string;
};
