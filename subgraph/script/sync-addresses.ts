/**
 * Rewrites subgraph.yaml from contracts/deployments/<chainId>.json.
 *
 * The manifest hardcodes addresses and a start block, and a contract redeploy
 * silently orphans it: the subgraph stays healthy, indexes nothing that matters,
 * and every consumer reads an empty world. That happened once — the verifier
 * swap redeployed all seven contracts and the manifest kept pointing at the
 * dead set for hours.
 *
 * So the deployment file is the source of truth here too, and this makes the
 * manifest follow it rather than asking anyone to remember.
 *
 *   bun run script/sync-addresses.ts [--chain 5042002] [--check]
 *
 * `--check` exits non-zero on drift without writing, for use before a deploy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const chainId = args.includes("--chain") ? args[args.indexOf("--chain") + 1] : "5042002";

const root = resolve(import.meta.dir, "../..");
const deployment = JSON.parse(
  readFileSync(resolve(root, `contracts/deployments/${chainId}.json`), "utf8"),
) as Record<string, string | number>;

const manifestPath = resolve(import.meta.dir, "../subgraph.yaml");
const original = readFileSync(manifestPath, "utf8");

/** The block the current set was deployed at — the earliest thing worth indexing. */
function deployBlock(): number {
  const broadcast = JSON.parse(
    readFileSync(resolve(root, `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`), "utf8"),
  ) as { receipts?: Array<{ blockNumber: string | number }> };
  const blocks = (broadcast.receipts ?? []).map((r) =>
    typeof r.blockNumber === "string" ? parseInt(r.blockNumber, 16) : r.blockNumber,
  );
  if (blocks.length === 0) throw new Error("no receipts in the broadcast file");
  return Math.min(...blocks);
}

const startBlock = deployBlock();
let updated = original;
const changes: string[] = [];

// Each data source names a contract; rewrite the address that follows it.
for (const [name, address] of Object.entries(deployment)) {
  if (typeof address !== "string" || !address.startsWith("0x")) continue;
  const block = new RegExp(
    `(name:\\s*${name}\\s*\\n\\s*network:[^\\n]*\\n\\s*source:\\s*\\n\\s*address:\\s*")([^"]+)(")`,
    "g",
  );
  updated = updated.replace(block, (_m, pre: string, old: string, post: string) => {
    if (old.toLowerCase() !== address.toLowerCase()) {
      changes.push(`${name}: ${old} -> ${address}`);
    }
    return `${pre}${address}${post}`;
  });
}

updated = updated.replace(/startBlock:\s*\d+/g, (m) => {
  const old = Number(m.split(":")[1]);
  if (old !== startBlock) changes.push(`startBlock: ${old} -> ${startBlock}`);
  return `startBlock: ${startBlock}`;
});

if (changes.length === 0) {
  console.log(`subgraph.yaml already matches deployments/${chainId}.json`);
  process.exit(0);
}

for (const c of changes) console.log(`  ${c}`);

if (check) {
  console.error(
    `\nsubgraph.yaml is stale against deployments/${chainId}.json — run without --check to fix`,
  );
  process.exit(1);
}

writeFileSync(manifestPath, updated);
console.log(`\nsubgraph.yaml updated. Rebuild and redeploy, or it keeps indexing the old set.`);
