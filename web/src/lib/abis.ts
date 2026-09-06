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
