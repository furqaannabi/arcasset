import type { Address } from "viem";
import { CHAIN } from "./chain";

/**
 * Contract addresses, injected at build time by next.config.ts from
 * contracts/deployments/<chainId>.json — the same file the backend and the
 * subgraph manifest read. Nothing here hardcodes an address; see CLAUDE.md
 * ("One source of truth").
 *
 * The config validates the file's shape and throws at build time if it is
 * missing or malformed, so by the time this runs the JSON is known-good. The
 * chain-id check below is kept anyway: it is the one thing that could still
 * disagree, if NEXT_PUBLIC_CHAIN changed between build and run.
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
};

function load(): Deployment {
  const raw = process.env.NEXT_PUBLIC_DEPLOYMENT;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_DEPLOYMENT is unset — next.config.ts injects it; this build did not go through it",
    );
  }
  const parsed = JSON.parse(raw) as Deployment;
  if (parsed.chainId !== CHAIN.id) {
    throw new Error(
      `deployment is for chain ${parsed.chainId} but the app is configured for ${CHAIN.id}`,
    );
  }
  return parsed;
}

export const DEPLOYMENT = load();

export const PARTY_REGISTRY = DEPLOYMENT.PartyRegistry;
export const ISSUANCE_QUEUE = DEPLOYMENT.IssuanceQueue;
export const NOTE_FACTORY = DEPLOYMENT.NoteFactory;
export const REPAYMENT_VAULT = DEPLOYMENT.RepaymentVault;
export const SERVICING_RELAY = DEPLOYMENT.ServicingRelay;
export const OFFERING = DEPLOYMENT.Offering;
