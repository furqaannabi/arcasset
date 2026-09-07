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
] as const;
