import type { Address } from "viem";
import { privateKeyFrom } from "./agent/executor";
import type { Hex } from "viem";

/**
 * Configuration is read once, here, and validated loudly. A backend that starts
 * with a half-configured agent is worse than one that refuses to start.
 */
export type Config = {
  port: number;
  chainId: number;
  rpcUrl: string;
  agentKey: Hex | null;
  tickIntervalMs: number;
  maxActionsPerTick: number;
  maxLagBlocks: number;
  minGasBalance: bigint;
  defaultDryRun: boolean;
  intelPayTo: Address | null;
  usdcErc20: Address;
  attestorKey: Hex | null;
  worldAppId: string | null;
  worldAction: string | null;
  /** Registered relying party, rp_… — /api/v4/verify is addressed by it. */
  worldRpId: string | null;
  /** Signs proof requests. Without it World answers invalid_rp_signature. */
  worldSigningKey: string | null;
  /**
   * Environments whose proofs we accept. A sandbox proof is a real proof from
   * a different world, and the sandbox World App is how Selfie Check is tested
   * before it is enabled in production — so this is a list, defaulting to
   * production only, rather than a boolean nobody can widen safely.
   */
  worldEnvironments: string[];
  dangerousAttestWithoutWorld: boolean;
  corsOrigins: string[];
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${raw}`);
  return n;
}

function address(name: string, fallback: string | null): Address | null {
  const raw = process.env[name] ?? fallback;
  if (!raw) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`${name} is not an address: ${raw}`);
  return raw as Address;
}

export function loadConfig(): Config {
  const usdc = address("USDC_ERC20", "0x3600000000000000000000000000000000000000");
  if (!usdc) throw new Error("USDC_ERC20 is required");
  return {
    port: num("PORT", 3001),
    chainId: num("CHAIN_ID", 5042002),
    rpcUrl: process.env["RPC_URL"] ?? "https://rpc.testnet.arc.network",
    agentKey: privateKeyFrom(process.env["AGENT_PRIVATE_KEY"]),
    tickIntervalMs: num("TICK_INTERVAL_MS", 60_000),
    maxActionsPerTick: num("MAX_ACTIONS_PER_TICK", 25),
    maxLagBlocks: num("MAX_LAG_BLOCKS", 200),
    // 18-decimal native units: this is a gas float, not a price.
    minGasBalance: BigInt(process.env["MIN_GAS_BALANCE"] ?? "10000000000000000"),
    // Opt in, never out. An unset variable must not enable the one
    // irreversible action this system can take.
    defaultDryRun: process.env["DEFAULT_DRY_RUN"] !== "false",
    intelPayTo: address("INTEL_PAY_TO", null),
    usdcErc20: usdc,
    attestorKey: privateKeyFrom(process.env["ATTESTOR_PRIVATE_KEY"]),
    worldAppId: process.env["WORLD_APP_ID"] || null,
    worldAction: process.env["WORLD_ACTION"] || null,
    worldRpId: process.env["WORLD_RP_ID"] || null,
    worldSigningKey: process.env["WORLD_RP_SIGNING_KEY"] || null,
    worldEnvironments: (process.env["WORLD_ENVIRONMENTS"] || "production")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
    // Opt in, explicitly, and never by an unset variable.
    dangerousAttestWithoutWorld: process.env["DANGEROUS_ATTEST_WITHOUT_WORLD"] === "true",
    // An allowlist, never "*". Every authenticated route here takes a bearer
    // session token, and a wildcard origin next to credentials is how another
    // site reads a signed-in user's documents.
    corsOrigins: (process.env["CORS_ORIGINS"] || "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
