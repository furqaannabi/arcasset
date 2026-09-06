import { Hono } from "hono";
import type { Address, PublicClient, WalletClient } from "viem";
import { isAddress } from "viem";
import { paywall } from "./paywall";
import { ChainSettler } from "./settle";
import { IntelReader } from "./reader";
import type { Config } from "@/config";

/** 6-decimal base units — the ERC-20 view, which is what EIP-3009 signs. */
export const PRICES = {
  "/intel/borrower": "500000", // $0.50
} as const;

function networkName(chainId: number): string {
  return chainId === 5042002 ? "arc-testnet" : chainId === 5042 ? "arc" : `chain-${chainId}`;
}

export function intelRoutes(
  config: Config,
  publicClient: PublicClient,
  wallet: WalletClient | null,
  factory: Address,
): Hono {
  const app = new Hono();
  const reader = new IntelReader(publicClient, factory);

  /** Free, so an agent can discover the cost before committing to anything. */
  app.get("/pricing", (c) =>
    c.json({
      network: networkName(config.chainId),
      asset: config.usdcErc20,
      decimals: 6,
      scheme: "exact",
      payTo: config.intelPayTo,
      endpoints: [
        {
          path: "/intel/borrower/:address",
          price: PRICES["/intel/borrower"],
          description: "Repayment behaviour for one borrower — does this counterparty pay on time",
        },
      ],
      // Saying so beats a buyer discovering it by getting a 500.
      available: Boolean(config.intelPayTo && wallet),
    }),
  );

  if (config.intelPayTo && wallet) {
    const settler = new ChainSettler(
      publicClient,
      wallet,
      config.usdcErc20,
      config.chainId,
      BigInt(process.env["MAX_SETTLE_GAS"] ?? "500000"),
    );

    app.use(
      "/borrower/:address",
      paywall({
        now: async () => Number((await publicClient.getBlock({ blockTag: "latest" })).timestamp),
        payTo: config.intelPayTo,
        asset: config.usdcErc20,
        network: networkName(config.chainId),
        settler,
        price: () => PRICES["/intel/borrower"],
        description: "Borrower punctuality",
      }),
    );
  }

  app.get("/borrower/:address", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address)) return c.json({ error: "not_found", message: "not an address" }, 404);
    if (!config.intelPayTo || !wallet) {
      return c.json(
        { error: "unavailable", message: "INTEL_PAY_TO or AGENT_PRIVATE_KEY unset — the paid API is not configured" },
        503,
      );
    }
    return c.json(await reader.borrower(address));
  });

  return app;
}
