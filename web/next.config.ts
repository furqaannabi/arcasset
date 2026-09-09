import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Contract addresses come from contracts/deployments/<chainId>.json — the same
 * file the backend and the subgraph manifest read (CLAUDE.md: one source of
 * truth, nothing hardcodes an address).
 *
 * Read here rather than imported from src/, because Turbopack does not resolve
 * modules outside the project root and widening `turbopack.root` to the repo
 * would pull contracts/lib and subgraph/node_modules into its watch scope.
 * Reading it in the config keeps the single source without that cost, and a
 * missing or malformed file fails the build loudly instead of shipping a
 * silent zero address.
 */
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN === "arc" ? 5042 : 5042002;

function loadDeployment(chainId: number): string {
  const path = resolve(here, "..", "contracts", "deployments", `${chainId}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no deployment for chain ${chainId} at ${path} — run contracts/script/deploy-testnet.sh first`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const required = [
    "PartyRegistry", "IssuanceQueue", "NoteFactory",
    "RepaymentVault", "ServicingRelay", "Offering",
    "RepaymentMandate",
  ];
  for (const key of required) {
    const v = parsed[key];
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
      throw new Error(`deployment ${path} is missing or malformed: ${key}`);
    }
  }
  if (parsed.chainId !== chainId) {
    throw new Error(`deployment ${path} says chain ${String(parsed.chainId)}, expected ${chainId}`);
  }
  return raw;
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_DEPLOYMENT: loadDeployment(CHAIN_ID),
  },
};

export default nextConfig;
