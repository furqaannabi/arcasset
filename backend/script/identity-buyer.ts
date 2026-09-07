/** A wallet signs in, gets an attestation, and submits it itself. */
import { createWalletClient, createPublicClient, http, defineChain, isAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

const API = process.env["API"]!, RPC = process.env["RPC"]!, REG = process.env["REG"] as `0x${string}`;
let failures = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) console.log(`  \x1b[32m✓\x1b[0m ${l}`); else { console.log(`  \x1b[31m✗ ${l} ${d}\x1b[0m`); failures++; } };

const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const registryAbi = [
  { type: "function", name: "verify", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "isVerified", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: alice, chain, transport: http(RPC) });
await fetch(`${RPC}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [alice.address, "0xde0b6b3a7640000"] }) });

// no session at all
const anon = await fetch(`${API}/identity/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
ok("attesting without a session is refused", anon.status === 401, `got ${anon.status}`);

async function login(acct: typeof alice) {
  const n = await (await fetch(`${API}/documents/auth/nonce?address=${acct.address}`)).json();
  const signature = await acct.signMessage({ message: n.message });
  const s = await (await fetch(`${API}/documents/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: acct.address, signature }) })).json();
  return s.token as string;
}

const tok = await login(alice);
const att = await (await fetch(`${API}/identity/attest`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: "{}" })).json();
ok("attestation issued for the signed-in address", att.party?.toLowerCase() === alice.address.toLowerCase(), JSON.stringify(att).slice(0, 120));
ok("it carries the warning while unverified", Boolean(att.WARNING));
ok("proof is abi-encoded bytes", typeof att.proof === "string" && att.proof.length > 200);

ok("not verified before submitting", (await pub.readContract({ address: REG, abi: registryAbi, functionName: "isVerified", args: [alice.address] })) === false);
const hash = await wallet.writeContract({ address: REG, abi: registryAbi, functionName: "verify", args: [alice.address, att.proof as Hex], chain, account: alice });
await pub.waitForTransactionReceipt({ hash });
ok("verified on-chain after submitting", (await pub.readContract({ address: REG, abi: registryAbi, functionName: "isVerified", args: [alice.address] })) === true);

// the attestation is bound to alice
try {
  await pub.simulateContract({ address: REG, abi: registryAbi, functionName: "verify", args: [bob.address, att.proof as Hex], account: bob.address });
  ok("alice's attestation cannot verify bob", false, "it was accepted");
} catch { ok("alice's attestation cannot verify bob", true); }

// alice cannot verify twice
try {
  await pub.simulateContract({ address: REG, abi: registryAbi, functionName: "verify", args: [alice.address, att.proof as Hex], account: alice.address });
  ok("alice cannot verify a second time", false, "it was accepted");
} catch { ok("alice cannot verify a second time", true); }

process.exit(failures);
