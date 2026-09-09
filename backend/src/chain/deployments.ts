import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";

/**
 * Addresses come from contracts/deployments/<chainId>.json, written by the
 * deploy script. Nothing here hardcodes an address — one source, and a missing
 * file is a loud failure rather than a silent zero address.
 */
export type Deployment = {
  chainId: number;
  PartyRegistry: Address;
  IssuanceQueue: Address;
  NoteFactory: Address;
  RepaymentVault: Address;
  ServicingRelay: Address;
  Offering: Address;
  PersonhoodVerifier: Address;
  RepaymentMandate: Address;
};

const REQUIRED = [
  "PartyRegistry", "IssuanceQueue", "NoteFactory",
  "RepaymentVault", "ServicingRelay", "Offering", "PersonhoodVerifier",
  "RepaymentMandate",
] as const;

export function loadDeployment(chainId: number, root?: string): Deployment {
  const base = root ?? resolve(import.meta.dir, "../../../contracts/deployments");
  const path = resolve(base, `${chainId}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no deployment for chain ${chainId} at ${path} — run contracts/script/deploy-testnet.sh first`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  for (const key of REQUIRED) {
    const v = parsed[key];
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
      throw new Error(`deployment ${path} is missing or malformed: ${key}`);
    }
  }
  if (parsed["chainId"] !== chainId) {
    throw new Error(`deployment ${path} says chain ${parsed["chainId"]}, expected ${chainId}`);
  }
  return parsed as unknown as Deployment;
}
