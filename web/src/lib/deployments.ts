import type { Address } from "viem";
import { CHAIN } from "./chain";
import testnet from "../../../contracts/deployments/5042002.json";

/**
 * Addresses come from contracts/deployments/<chainId>.json, written by the
 * deploy script — the same file the backend and the subgraph manifest read.
 * Nothing here hardcodes an address; see CLAUDE.md ("One source of truth").
 *
 * The import is static because a bundler cannot resolve a path chosen at
 * runtime, and only the testnet deployment exists today. Adding mainnet means
 * adding 5042.json and a branch here — deliberately a code change, so a
 * missing deployment is a build failure rather than a silent zero address.
 */
const BY_CHAIN: Record<number, Deployment> = {
  5042002: testnet as Deployment,
};

export type Deployment = {
  chainId: number;
  PartyRegistry: Address;
  IssuanceQueue: Address;
  NoteFactory: Address;
  RepaymentVault: Address;
  ServicingRelay: Address;
  Offering: Address;
  PersonhoodVerifier: Address;
};

function load(): Deployment {
  const found = BY_CHAIN[CHAIN.id];
  if (!found) {
    throw new Error(
      `no deployment for chain ${CHAIN.id} — add contracts/deployments/${CHAIN.id}.json and register it in lib/deployments.ts`,
    );
  }
  return found;
}

export const DEPLOYMENT = load();

export const PARTY_REGISTRY = DEPLOYMENT.PartyRegistry;
export const ISSUANCE_QUEUE = DEPLOYMENT.IssuanceQueue;
export const NOTE_FACTORY = DEPLOYMENT.NoteFactory;
export const REPAYMENT_VAULT = DEPLOYMENT.RepaymentVault;
export const SERVICING_RELAY = DEPLOYMENT.ServicingRelay;
export const OFFERING = DEPLOYMENT.Offering;
