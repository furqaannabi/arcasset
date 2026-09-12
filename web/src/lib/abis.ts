/**
 * Hand-written minimal ABIs — only what the UI actually calls. Mirrors the
 * approach in backend/src/chain/abis.ts: a narrow surface is easier to audit
 * than a generated one, and the app should not be able to reach a function
 * nobody reviewed.
 */

export const partyRegistryAbi = [
  {
    type: "function",
    name: "isVerified",
    stateMutability: "view",
    inputs: [{ name: "party", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "verifiedAt",
    stateMutability: "view",
    inputs: [{ name: "party", type: "address" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "nullifierOf",
    stateMutability: "view",
    inputs: [{ name: "party", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    // The reverse of nullifierOf. Lets the UI find out that a human is already
    // verified as some other address before it offers a transaction that would
    // revert NullifierUsed.
    type: "function",
    name: "partyOf",
    stateMutability: "view",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "revoked",
    stateMutability: "view",
    inputs: [{ name: "party", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    // Deliberately callable by anyone, not just `party` — the proof is bound to
    // `party` by the verifier, so a relayer can pay the gas without being able
    // to bind a nullifier to an address they control.
    type: "function",
    name: "verify",
    stateMutability: "nonpayable",
    inputs: [
      { name: "party", type: "address" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },

  // Custom errors. Without them viem cannot decode a revert and every failure
  // shows as a bare selector — which also silently defeats any code matching
  // on the error name.
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "AlreadyVerified", inputs: [] },
  { type: "error", name: "NullifierUsed", inputs: [] },
  { type: "error", name: "InvalidNullifier", inputs: [] },
  { type: "error", name: "NotVerified", inputs: [] },
  { type: "error", name: "AlreadyRevoked", inputs: [] },
  { type: "error", name: "AttestationExpired", inputs: [] },
  { type: "error", name: "WrongAttestor", inputs: [] },
  { type: "error", name: "ZeroNullifier", inputs: [] },
] as const;

/**
 * Terms as the contract lays them out. The order is the ABI's, not ours —
 * a struct is encoded positionally, so a field out of place silently produces
 * a different note rather than a type error.
 */
const termsTuple = {
  type: "tuple",
  name: "terms",
  components: [
    { name: "borrower", type: "address" },
    { name: "principal", type: "uint256" },
    { name: "couponBps", type: "uint16" },
    { name: "servicingFeeBps", type: "uint16" },
    { name: "periodCount", type: "uint16" },
    { name: "periodLength", type: "uint64" },
    { name: "gracePeriod", type: "uint64" },
    { name: "cureWindow", type: "uint64" },
    { name: "acceptDeadline", type: "uint64" },
    { name: "feeRecipient", type: "address" },
  ],
} as const;

export const issuanceQueueAbi = [
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      termsTuple,
      { name: "documentHash", type: "bytes32" },
      { name: "documentURI", type: "string" },
    ],
    outputs: [{ name: "proposalId", type: "uint256" }],
  },
  {
    // The queue never re-emits terms, so the proposal page reads them here.
    // See docs/03-subgraph.md on why they are not indexed.
    type: "function",
    name: "proposalOf",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "originator", type: "address" },
          termsTuple,
          { name: "documentHash", type: "bytes32" },
          { name: "documentURI", type: "string" },
          { name: "status", type: "uint8" },
          { name: "proposedAt", type: "uint64" },
          { name: "acceptedAt", type: "uint64" },
          { name: "approvedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isAdmin",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "MINT_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "accept",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "noteId", type: "uint256" },
      { name: "note", type: "address" },
    ],
  },
  {
    type: "event",
    name: "Proposed",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "originator", type: "address", indexed: true },
      { name: "borrower", type: "address", indexed: true },
      { name: "digest", type: "bytes32", indexed: false },
      { name: "documentURI", type: "string", indexed: false },
    ],
  },

  // Custom errors — see the note on partyRegistryAbi.
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "OriginatorNotVerified", inputs: [] },
  { type: "error", name: "BorrowerNotVerified", inputs: [] },
  { type: "error", name: "SelfDealing", inputs: [] },
  { type: "error", name: "NoDocument", inputs: [] },
  { type: "error", name: "BadDeadline", inputs: [] },
  { type: "error", name: "BadTerms", inputs: [] },
  { type: "error", name: "NotBorrower", inputs: [] },
  { type: "error", name: "NotAdmin", inputs: [] },
  { type: "error", name: "NotOriginator", inputs: [] },
  { type: "error", name: "WrongStatus", inputs: [{ name: "have", type: "uint8" }, { name: "want", type: "uint8" }] },
  { type: "error", name: "DigestChanged", inputs: [] },
  { type: "error", name: "AcceptWindowClosed", inputs: [] },
  { type: "error", name: "MintWindowClosed", inputs: [] },
  { type: "error", name: "NotExpirable", inputs: [] },
  { type: "error", name: "UnknownProposal", inputs: [] },
] as const;

/**
 * The note itself. `claimable`/`claim` are the holder's side of every
 * repayment; `approve` exists only because listing pulls the tokens into
 * escrow with `transferFrom`, so a sale is two transactions and the UI has to
 * say so rather than let the second one revert.
 */
export const rwaNoteAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * The primary offering. `buy` is exact-payment — the contract reverts on a
 * penny either way rather than refunding change — so the quote the UI shows
 * and the value it sends must be the same integer expression the contract
 * uses: (amount * priceBps) / 10000, truncating.
 */
export const offeringAbi = [
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "priceBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "delist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    // Reprice in place. Without it the only way to change a price is to delist
    // and list again, which returns the tokens to the originator and back to
    // escrow for nothing.
    type: "function",
    name: "relist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "priceBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    // Escrowed tokens keep earning while they sit unsold, and the Offering is
    // the holder of record. Permissionless, because the destination is the
    // note's own originator — there is nothing for a caller to redirect.
    type: "function",
    name: "sweepEscrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "noteId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Repayment. Anyone may pay — a third party curing a borrower's miss is
 * legitimate and is measured rather than prevented (docs/06-identity.md), so
 * the UI does not gate this on being the borrower.
 */
export const repaymentVaultAbi = [
  {
    type: "function",
    name: "repay",
    stateMutability: "payable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "periodIndex", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

/**
 * Servicing delegation. The originator chooses who services the note — they
 * arranged the loan and they are selling exposure to it — and every entry
 * point on the relay is gated on this: settlePeriod, markDelinquent and
 * markDefaulted all revert NotDelegated for anyone else. A note nobody
 * delegated is never touched by the agent.
 */
export const servicingRelayAbi = [
  {
    type: "function",
    name: "delegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "agent", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "noteId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "agentOf",
    stateMutability: "view",
    inputs: [{ name: "noteId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

/**
 * RepaymentMandate. Only `mandateNonce` is here: the UI reads the nonce from
 * the contract rather than taking one from the API, because the nonce is the
 * half of a mandate that decides *which* note and period the signature can pay,
 * and a signature over someone else's nonce is a signature over someone else's
 * debt.
 */
export const repaymentMandateAbi = [
  {
    /**
     * One EIP-2612 permit standing in for every per-period signature. The
     * allowance is a ceiling; when and how much of it moves is decided by the
     * note's schedule on-chain, not here and not by whoever relays this.
     */
    type: "function",
    name: "authorize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    /** What a standing authorisation still has to cover, in 6-decimal units. */
    type: "function",
    name: "outstanding",
    stateMutability: "view",
    inputs: [{ name: "noteId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "collected",
    stateMutability: "view",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "periodIndex", type: "uint16" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mandateNonce",
    stateMutability: "view",
    inputs: [
      { name: "noteId", type: "uint256" },
      { name: "periodIndex", type: "uint16" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/**
 * The token's EIP-2612 surface. `nonces` is the one field a permit signature
 * cannot be built without, and it increments on every permit — so it is read
 * at signing time rather than cached.
 */
export const usdcPermitAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
