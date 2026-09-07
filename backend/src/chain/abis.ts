/**
 * Hand-written minimal ABIs. Only what the agent calls or reads — a narrow
 * surface is easier to audit than a generated one, and the agent should not be
 * able to reach a function nobody reviewed.
 */

export const noteFactoryAbi = [
  { type: "function", name: "noteCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noteOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

export const noteAbi = [
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "originator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "firstMissedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "periodsSettled", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "periodsMissed", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "periodStatus", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "periodPaid", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "periodDue", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "periodBounds", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint64" }, { type: "uint64" }] },
  {
    type: "function", name: "terms", stateMutability: "view", inputs: [],
    outputs: [{
      type: "tuple",
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
    }],
  },
] as const;

export const queueAbi = [
  { type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "statusOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  {
    type: "event", name: "Proposed",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "originator", type: "address", indexed: true },
      { name: "borrower", type: "address", indexed: true },
      { name: "digest", type: "bytes32", indexed: false },
      { name: "documentURI", type: "string", indexed: false },
    ],
  },
] as const;

export const relayAbi = [
  { type: "function", name: "agentOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "settlePeriod", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "markDelinquent", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "markDefaulted", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

export const vaultAbi = [
  {
    type: "event", name: "Repaid",
    inputs: [
      { name: "noteId", type: "uint256", indexed: true },
      { name: "periodIndex", type: "uint16", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
      { name: "onTime", type: "bool", indexed: false },
    ],
  },
  { type: "function", name: "paidOf", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/** Circle FiatToken. Only the EIP-3009 surface x402 settlement needs. */
export const usdcAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  {
    type: "function", name: "authorizationState", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;
