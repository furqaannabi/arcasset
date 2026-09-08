/**
 * Puts one real note on Arc testnet, with the history the demo needs: a period
 * paid and settled, a period missed and marked delinquent, and that same period
 * cured — by the originator rather than the borrower, which is the single most
 * interesting row the intel product sells.
 *
 * Everything here is a real transaction on the live deployment. There is no
 * time warp on a public chain, so periods are the contract minimum of 60
 * seconds and the script waits for them.
 *
 * Wallets are generated fresh each run. Verification is permanent per address,
 * so seeding must never reuse a wallet anyone cares about.
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import type { Account, Address, Hex, WalletClient } from "viem";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC = process.env["RPC_URL"] ?? "https://rpc.testnet.arc.network";
const API = process.env["API"] ?? "http://localhost:3099";
const FUNDER_KEY = process.env["FUNDER_KEY"] as Hex;

const d = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../contracts/deployments/5042002.json"), "utf8"),
) as Record<string, Address>;

const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const funder = privateKeyToAccount(FUNDER_KEY);
const funderWallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(RPC) });

const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const note_ = (s: string) => console.log(`  ${s}`);

const registryAbi = [
  { type: "function", name: "verify", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "isVerified", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;
const queueAbi = [
  { type: "function", name: "propose", stateMutability: "nonpayable",
    inputs: [{ type: "tuple", components: [
      { name: "borrower", type: "address" }, { name: "principal", type: "uint256" },
      { name: "couponBps", type: "uint16" }, { name: "servicingFeeBps", type: "uint16" },
      { name: "periodCount", type: "uint16" }, { name: "periodLength", type: "uint64" },
      { name: "gracePeriod", type: "uint64" }, { name: "cureWindow", type: "uint64" },
      { name: "acceptDeadline", type: "uint64" }, { name: "feeRecipient", type: "address" }] },
      { type: "bytes32" }, { type: "string" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "accept", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }] },
  { type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const factoryAbi = [
  { type: "function", name: "noteCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noteOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const noteAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "periodDue", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "periodBounds", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint64" }, { type: "uint64" }] },
  { type: "function", name: "periodStatus", stateMutability: "view", inputs: [{ type: "uint16" }], outputs: [{ type: "uint8" }] },
] as const;
const relayAbi = [
  { type: "function", name: "delegate", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
  { type: "function", name: "settlePeriod", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "markDelinquent", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
] as const;
const vaultAbi = [
  { type: "function", name: "repay", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "uint16" }], outputs: [] },
] as const;
const offeringAbi = [
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "costOf", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

function walletFor(key: Hex): { account: Account; client: WalletClient } {
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: arcTestnet, transport: http(RPC) }) };
}

async function send(w: { account: Account; client: WalletClient }, req: Record<string, unknown>) {
  const hash = await w.client.writeContract({ ...(req as never), chain: arcTestnet, account: w.account });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
}

async function fund(to: Address, amount: bigint) {
  const hash = await funderWallet.sendTransaction({ account: funder, chain: arcTestnet, to, value: amount });
  await pub.waitForTransactionReceipt({ hash });
}

/** Verification, via the bypass backend — World needs a phone. */
async function verifyParty(w: { account: Account; client: WalletClient }) {
  const n = await (await fetch(`${API}/documents/auth/nonce?address=${w.account.address}`)).json();
  const signature = await w.client.signMessage({ account: w.account, message: n.message });
  const s = await (await fetch(`${API}/documents/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: w.account.address, signature }),
  })).json();
  const att = await (await fetch(`${API}/identity/attest`, {
    method: "POST", headers: { Authorization: `Bearer ${s.token}`, "content-type": "application/json" }, body: "{}",
  })).json();
  if (!att.proof) throw new Error(`no attestation: ${JSON.stringify(att)}`);
  await send(w, { address: d["PartyRegistry"]!, abi: registryAbi, functionName: "verify", args: [w.account.address, att.proof] });
}

async function waitUntil(unix: number, why: string) {
  for (;;) {
    const now = Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
    const left = unix - now;
    if (left <= 0) return;
    note_(`waiting ${left}s — ${why}`);
    await new Promise((r) => setTimeout(r, Math.min(left, 15) * 1000 + 1000));
  }
}

// ---------------------------------------------------------------------------

const originator = walletFor(generatePrivateKey());
const borrower = walletFor(generatePrivateKey());
const buyer = walletFor(generatePrivateKey());
const agent = funder; // the running agent's key services this note

step("Fresh wallets (verification is permanent, so never reuse one)");
note_(`originator ${originator.account.address}`);
note_(`borrower   ${borrower.account.address}`);
note_(`buyer      ${buyer.account.address}`);

step("Funding");
await fund(originator.account.address, parseEther("2"));
await fund(borrower.account.address, parseEther("2"));
await fund(buyer.account.address, parseEther("11"));
note_("originator 2, borrower 2, buyer 11 USDC");

step("Verifying both write-side parties");
await verifyParty(originator);
await verifyParty(borrower);
note_(`originator verified: ${await pub.readContract({ address: d["PartyRegistry"]!, abi: registryAbi, functionName: "isVerified", args: [originator.account.address] })}`);
note_(`borrower   verified: ${await pub.readContract({ address: d["PartyRegistry"]!, abi: registryAbi, functionName: "isVerified", args: [borrower.account.address] })}`);

step("propose → accept → approve → mint");
const now = Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
const terms = {
  borrower: borrower.account.address,
  principal: parseEther("100"),
  couponBps: 100, servicingFeeBps: 50, periodCount: 3,
  periodLength: 60n, gracePeriod: 60n, cureWindow: 600n,
  acceptDeadline: BigInt(now + 3600),
  feeRecipient: originator.account.address,
};
await send(originator, { address: d["IssuanceQueue"]!, abi: queueAbi, functionName: "propose",
  args: [terms, "0x" + "ab".repeat(32) as Hex, "ipfs://seeded-agreement"] });
const proposalId = await pub.readContract({ address: d["IssuanceQueue"]!, abi: queueAbi, functionName: "proposalCount" });
note_(`proposal ${proposalId}`);
await send(borrower, { address: d["IssuanceQueue"]!, abi: queueAbi, functionName: "accept", args: [proposalId] });
note_("borrower accepted");
await send({ account: funder, client: funderWallet }, { address: d["IssuanceQueue"]!, abi: queueAbi, functionName: "approve", args: [proposalId] });
note_("admin approved");
await send(originator, { address: d["IssuanceQueue"]!, abi: queueAbi, functionName: "mint", args: [proposalId] });
const noteId = await pub.readContract({ address: d["NoteFactory"]!, abi: factoryAbi, functionName: "noteCount" });
const noteAddr = await pub.readContract({ address: d["NoteFactory"]!, abi: factoryAbi, functionName: "noteOf", args: [noteId] });
note_(`note ${noteId} at ${noteAddr}`);

step("Delegating servicing to the running agent");
await send(originator, { address: d["ServicingRelay"]!, abi: relayAbi, functionName: "delegate", args: [noteId, agent.address] });
note_(`agent ${agent.address}`);

step("Originator lists 10% at 97, a buyer takes it");
const slice = parseEther("10");
await send(originator, { address: noteAddr, abi: noteAbi, functionName: "approve", args: [d["Offering"]!, slice] });
await send(originator, { address: d["Offering"]!, abi: offeringAbi, functionName: "list", args: [noteId, slice, 9700] });
const cost = await pub.readContract({ address: d["Offering"]!, abi: offeringAbi, functionName: "costOf", args: [noteId, slice] });
await send(buyer, { address: d["Offering"]!, abi: offeringAbi, functionName: "buy", args: [noteId, slice], value: cost });
note_(`buyer paid ${formatEther(cost)} USDC for 10 tokens — originator keeps 90%`);

step("Period 0 — the borrower pays, on time");
const due0 = await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodDue", args: [0] });
await send(borrower, { address: d["RepaymentVault"]!, abi: vaultAbi, functionName: "repay", args: [noteId, 0], value: due0 });
note_(`repaid ${formatEther(due0)} USDC`);
const [, end0] = await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodBounds", args: [0] });
await waitUntil(Number(end0), "period 0 to end");
await send({ account: funder, client: funderWallet }, { address: d["ServicingRelay"]!, abi: relayAbi, functionName: "settlePeriod", args: [noteId, 0] });
note_(`period 0 status ${await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodStatus", args: [0] })} (1 = Settled)`);

step("Period 1 — nobody pays. The agent marks it.");
const [, end1] = await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodBounds", args: [1] });
await waitUntil(Number(end1) + 61, "period 1 grace to elapse");
await send({ account: funder, client: funderWallet }, { address: d["ServicingRelay"]!, abi: relayAbi, functionName: "markDelinquent", args: [noteId, 1] });
note_(`period 1 status ${await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodStatus", args: [1] })} (2 = Missed)`);

step("The ORIGINATOR covers it — the row the intel product sells");
const due1 = await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodDue", args: [1] });
await send(originator, { address: d["RepaymentVault"]!, abi: vaultAbi, functionName: "repay", args: [noteId, 1], value: due1 });
await send({ account: funder, client: funderWallet }, { address: d["ServicingRelay"]!, abi: relayAbi, functionName: "settlePeriod", args: [noteId, 1] });
note_(`period 1 status ${await pub.readContract({ address: noteAddr, abi: noteAbi, functionName: "periodStatus", args: [1] })} (3 = Cured)`);

console.log(`
\x1b[32mSEEDED\x1b[0m
  note        ${noteAddr}
  noteId      ${noteId}
  originator  ${originator.account.address}
  borrower    ${borrower.account.address}
  explorer    https://testnet.arcscan.app/address/${noteAddr}

  /intel/note/${noteAddr}/timeline   should show 5 events, one repaid byOriginator
  /intel/originator/${originator.account.address}   selfCureRate 1
`);
