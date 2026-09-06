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

export const relayAbi = [
  { type: "function", name: "agentOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "settlePeriod", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "markDelinquent", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "markDefaulted", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

export const vaultAbi = [
  { type: "function", name: "paidOf", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
