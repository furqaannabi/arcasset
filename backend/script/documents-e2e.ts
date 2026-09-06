/**
 * Document upload, sealing and access control, end to end against a running
 * backend. The admin has to be able to read the agreement, and nobody else
 * should be — that is the whole point of the step.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { manifestHash } from "../src/documents/manifest";
import type { Hex } from "viem";

const API = process.env["API"] ?? "http://localhost:3013";
let failures = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { console.log(`  \x1b[31m✗ ${label} ${detail}\x1b[0m`); failures++; }
};

const originator = privateKeyToAccount(generatePrivateKey());
const borrower = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const admin = privateKeyToAccount(process.env["ADMIN_KEY"] as Hex);

async function login(acct: typeof originator): Promise<string> {
  const n = await (await fetch(`${API}/documents/auth/nonce?address=${acct.address}`)).json();
  const signature = await acct.signMessage({ message: n.message });
  const s = await (await fetch(`${API}/documents/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: acct.address, signature }),
  })).json();
  return s.token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const pdf = (body: string) => new Uint8Array([...new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF`)]);
async function upload(token: string, draft: string, name: string, bytes: Uint8Array, claimedHash?: string) {
  const fd = new FormData();
  fd.append("file", new File([bytes as BlobPart], name, { type: "application/pdf" }));
  if (claimedHash) fd.append("contentHash", claimedHash);
  const r = await fetch(`${API}/documents/drafts/${draft}/files`, { method: "POST", headers: auth(token), body: fd });
  return { status: r.status, body: await r.json() };
}

console.log("\n\x1b[1m1. A wallet signs in\x1b[0m");
const oTok = await login(originator);
ok("originator got a session", Boolean(oTok));
const bTok = await login(borrower);
const sTok = await login(stranger);
const aTok = await login(admin);

console.log("\n\x1b[1m2. Nonces are single use\x1b[0m");
const n2 = await (await fetch(`${API}/documents/auth/nonce?address=${originator.address}`)).json();
const sig2 = await originator.signMessage({ message: n2.message });
await fetch(`${API}/documents/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: originator.address, signature: sig2 }) });
const replay = await fetch(`${API}/documents/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: originator.address, signature: sig2 }) });
ok("a used challenge cannot be redeemed twice", replay.status === 401, `got ${replay.status}`);

console.log("\n\x1b[1m3. Draft, and the self-dealing rule\x1b[0m");
const selfDeal = await fetch(`${API}/documents/drafts`, { method: "POST", headers: { ...auth(oTok), "content-type": "application/json" }, body: JSON.stringify({ borrower: originator.address }) });
ok("cannot name yourself as borrower", selfDeal.status === 400, `got ${selfDeal.status}`);

const created = await (await fetch(`${API}/documents/drafts`, {
  method: "POST", headers: { ...auth(oTok), "content-type": "application/json" },
  body: JSON.stringify({ borrower: borrower.address, terms: { principal: "100000" } }),
})).json();
ok("draft created", Boolean(created.id));
const draft = created.id as string;

console.log("\n\x1b[1m4. Uploads\x1b[0m");
const a = pdf("loan agreement"); const b = pdf("schedule");
const u1 = await upload(oTok, draft, "loan.pdf", a);
ok("a PDF is accepted", u1.status === 201, JSON.stringify(u1.body));
const u2 = await upload(oTok, draft, "schedule.pdf", b);
ok("a second PDF is accepted", u2.status === 201);

const notPdf = new TextEncoder().encode("<html>not a pdf at all</html>");
const u3 = await upload(oTok, draft, "evil.pdf", notPdf);
ok("a file that only claims to be a PDF is refused", u3.status === 400 && u3.body.error === "unsupported_type", JSON.stringify(u3.body));

const lying = await upload(oTok, draft, "third.pdf", pdf("third"), "0x" + "99".repeat(32));
ok("a client-supplied hash that disagrees is refused", lying.status === 422 && lying.body.error === "hash_mismatch", JSON.stringify(lying.body));

const dupe = await upload(oTok, draft, "again.pdf", a);
ok("the same bytes twice is one document", dupe.status === 201 && dupe.body.contentHash === u1.body.contentHash);

const notMine = await upload(sTok, draft, "x.pdf", pdf("x"));
ok("a stranger cannot upload to someone else's draft", notMine.status === 403, `got ${notMine.status}`);

console.log("\n\x1b[1m5. Sealing\x1b[0m");
const sealed = await (await fetch(`${API}/documents/drafts/${draft}/seal`, { method: "POST", headers: auth(oTok) })).json();
ok("seal returns a manifest hash", Boolean(sealed.manifestHash));
const expected = manifestHash([u1.body.contentHash, u2.body.contentHash]);
ok("the hash matches an independent computation", sealed.manifestHash === expected, `${sealed.manifestHash} vs ${expected}`);

const afterSeal = await upload(oTok, draft, "late.pdf", pdf("late"));
ok("sealing is final — no more uploads", afterSeal.status === 409, `got ${afterSeal.status}`);

console.log("\n\x1b[1m6. Who can read the agreement\x1b[0m");
for (const [who, tok, expect] of [["originator", oTok, true], ["borrower", bTok, true], ["admin", aTok, true], ["stranger", sTok, false]] as const) {
  const meta = await (await fetch(`${API}/documents/drafts/${draft}`, { headers: auth(tok) })).json();
  ok(`${who} ${expect ? "may" : "may not"} read contents`, meta.mayReadContents === expect);
  const file = await fetch(`${API}/documents/drafts/${draft}/files/${u1.body.id}`, { headers: auth(tok) });
  ok(`${who} file fetch ${expect ? "200" : "403"}`, expect ? file.ok : file.status === 403, `got ${file.status}`);
}

const anon = await (await fetch(`${API}/documents/drafts/${draft}`)).json();
ok("anyone can verify the hashes without reading the files", anon.documents.length === 2 && anon.mayReadContents === false);

console.log();
if (failures === 0) console.log("\x1b[32mDOCUMENT FLOW WORKS\x1b[0m");
else console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
process.exit(failures);
