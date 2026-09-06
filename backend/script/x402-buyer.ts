/**
 * A buyer with no prior relationship to us: no account, no API key, no signup.
 * It asks, gets a price, signs, asks again, and is served.
 *
 * This is the client half of the pitch — if it does not work from a cold
 * wallet, "payment is the auth" is a slogan rather than a description.
 */
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EIP3009_TYPES, domainFor, encodeHeader, decodeHeader, newNonce } from "../src/intel/x402";
import type { PaymentPayload, PaymentRequirements } from "../src/intel/x402";
import type { Hex } from "viem";

const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";
const API = process.env["API"] ?? "http://localhost:3012";
const KEY = process.env["BUYER_KEY"] as Hex;
const TARGET = process.env["TARGET"] as string;
const CHAIN_ID = Number(process.env["CHAIN_ID"] ?? 5042002);
const USDC = (process.env["USDC_ERC20"] ?? "0x3600000000000000000000000000000000000000") as `0x${string}`;

let failures = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { console.log(`  \x1b[31m✗ ${label} ${detail}\x1b[0m`); failures++; }
};

const chain = defineChain({
  id: CHAIN_ID, name: "local", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const url = `${API}/intel/borrower/${TARGET}`;
const buyerUsdc = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`\nbuyer ${account.address}`);
console.log(`  code: ${(await pub.getCode({ address: account.address })) ?? "(none — a plain EOA)"}`);
console.log(`  usdc: ${buyerUsdc} (6dp)`);

console.log("\n\x1b[1m1. Ask without paying\x1b[0m");
const first = await fetch(url);
ok("402 Payment Required", first.status === 402, `got ${first.status}`);
const header = first.headers.get("PAYMENT-REQUIRED");
ok("PAYMENT-REQUIRED header present", Boolean(header));

const offer = decodeHeader<{ accepts: PaymentRequirements[] }>(header ?? "");
const req = offer.accepts[0]!;
console.log(`     price ${req.maxAmountRequired} (6dp) to ${req.payTo}, scheme ${req.scheme}`);
ok("priced in 6-decimal base units", req.maxAmountRequired === "500000", req.maxAmountRequired);

console.log("\n\x1b[1m2. Sign an EIP-3009 authorization — no transaction, no gas\x1b[0m");
// The chain's clock, not this machine's. The token compares validBefore
// against block.timestamp, so signing against wall time produces an
// authorization that is already expired wherever the two have drifted apart.
const now = Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
const authorization = {
  from: account.address,
  to: req.payTo,
  value: req.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + req.maxTimeoutSeconds),
  nonce: newNonce(),
};
const signature = await wallet.signTypedData({
  account,
  domain: domainFor(USDC, CHAIN_ID, req.extra.name, req.extra.version),
  types: EIP3009_TYPES,
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});
const payload: PaymentPayload = {
  x402Version: 1, scheme: "exact", network: req.network,
  payload: { signature, authorization },
};
ok("signature produced", signature.length === 132);

const before = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [req.payTo] });

console.log("\n\x1b[1m3. Ask again, with payment\x1b[0m");
const second = await fetch(url, { headers: { "PAYMENT-SIGNATURE": encodeHeader(payload) } });
const body = await second.json();
ok("200 OK", second.status === 200, `got ${second.status}: ${JSON.stringify(body).slice(0, 160)}`);
ok("PAYMENT-RESPONSE header present", Boolean(second.headers.get("PAYMENT-RESPONSE")));
if (second.status === 200) {
  ok("data is about the borrower asked for", String(body.borrower).toLowerCase() === TARGET.toLowerCase());
  ok("carries asOfBlock so the buyer can reproduce it", typeof body.asOfBlock === "number");
  console.log(`     notes ${body.notesAccepted}, settled ${body.periods?.settled}, missed ${body.periods?.missed}, onTimeRate ${body.punctuality?.onTimeRate}`);
}

console.log("\n\x1b[1m4. The money actually moved\x1b[0m");
const after = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [req.payTo] });
ok("seller received exactly the quoted amount", after - before === BigInt(req.maxAmountRequired), `moved ${after - before}`);

console.log("\n\x1b[1m5. The same authorization cannot buy twice\x1b[0m");
const replay = await fetch(url, { headers: { "PAYMENT-SIGNATURE": encodeHeader(payload) } });
const replayBody = await replay.json();
ok("409 payment_replayed", replay.status === 409 && replayBody.error === "payment_replayed", `got ${replay.status} ${replayBody.error}`);

console.log("\n\x1b[1m6. A tampered payload is refused\x1b[0m");
const tampered: PaymentPayload = {
  ...payload,
  payload: { ...payload.payload, authorization: { ...authorization, value: "100000", nonce: newNonce() } },
};
const bad = await fetch(url, { headers: { "PAYMENT-SIGNATURE": encodeHeader(tampered) } });
ok("underpayment rejected with 402", bad.status === 402, `got ${bad.status}`);

console.log();
if (failures === 0) console.log("\x1b[32mX402 PAYMENT FLOW WORKS FROM A COLD WALLET\x1b[0m");
else console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
process.exit(failures);
