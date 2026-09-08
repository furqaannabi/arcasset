/** Session → attestation → on-chain verify, against the live deployment. */
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import type { Hex } from "viem";

const API = process.env["API"]!;
const REG = process.env["REG"] as `0x${string}`;
const RPC = process.env["RPC"]!;
const FUNDER = process.env["FUNDER_KEY"] as Hex;

let failures = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) console.log(`  \x1b[32m✓\x1b[0m ${l}`);
  else { console.log(`  \x1b[31m✗ ${l} ${d}\x1b[0m`); failures++; }
};

const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const registryAbi = [
  { type: "function", name: "verify", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "isVerified", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "nullifierOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
] as const;

const person = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: person, chain: arcTestnet, transport: http(RPC) });
console.log(`  wallet ${person.address}`);

// Gas, from the funder. Verification is a transaction the person pays for.
const funder = createWalletClient({ account: privateKeyToAccount(FUNDER), chain: arcTestnet, transport: http(RPC) });
const fundTx = await funder.sendTransaction({
  account: privateKeyToAccount(FUNDER), chain: arcTestnet,
  // 0.01 USDC. The verify transaction costs roughly a quarter of that at
  // current Arc gas; the rest is headroom so a price move does not fail the run.
  to: person.address, value: 10_000_000_000_000_000n,
});
await pub.waitForTransactionReceipt({ hash: fundTx });
ok("funded for gas", (await pub.getBalance({ address: person.address })) > 0n);

// 1. sign in
const n = await (await fetch(`${API}/documents/auth/nonce?address=${person.address}`)).json();
const signature = await person.signMessage({ message: n.message });
const session = await (await fetch(`${API}/documents/auth/session`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: person.address, signature }),
})).json();
ok("wallet signed in", Boolean(session.token));

// 2. attestation
const res = await fetch(`${API}/identity/attest`, {
  method: "POST", headers: { Authorization: `Bearer ${session.token}`, "content-type": "application/json" },
  body: "{}",
});
const att = await res.json();
ok("attestation issued for this address", att.party?.toLowerCase() === person.address.toLowerCase(), JSON.stringify(att).slice(0, 140));
ok("it is marked as unverified-by-World", Boolean(att.WARNING));
if (!att.proof) {
  // Without a proof there is nothing left to test, and pressing on produces an
  // unreadable viem error about undefined bytes instead of the real cause.
  console.log(`\n  \x1b[31mno attestation returned — stopping here\x1b[0m`);
  process.exit(failures || 1);
}

// 3. on-chain, from the person's own wallet
ok("not verified before submitting", (await pub.readContract({ address: REG, abi: registryAbi, functionName: "isVerified", args: [person.address] })) === false);
const hash = await wallet.writeContract({
  address: REG, abi: registryAbi, functionName: "verify",
  args: [person.address, att.proof as Hex], chain: arcTestnet, account: person,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
ok("verify transaction succeeded", receipt.status === "success", receipt.status);
ok("verified on-chain", (await pub.readContract({ address: REG, abi: registryAbi, functionName: "isVerified", args: [person.address] })) === true);
console.log(`     tx https://testnet.arcscan.app/tx/${hash}`);

// 4. the nullifier is bound and cannot move
const nullifier = await pub.readContract({ address: REG, abi: registryAbi, functionName: "nullifierOf", args: [person.address] });
ok("a nullifier was recorded", nullifier !== `0x${"0".repeat(64)}`);
const other = privateKeyToAccount(generatePrivateKey());
try {
  await pub.simulateContract({ address: REG, abi: registryAbi, functionName: "verify", args: [other.address, att.proof as Hex], account: other.address });
  ok("this attestation cannot verify another address", false, "it was accepted");
} catch { ok("this attestation cannot verify another address", true); }

console.log();
console.log(failures === 0 ? "\x1b[32mEVERYTHING BUT THE WORLD HANDSHAKE WORKS ON TESTNET\x1b[0m" : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
process.exit(failures);
