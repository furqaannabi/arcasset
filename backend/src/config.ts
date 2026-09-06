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
  };
}
