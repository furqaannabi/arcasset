import type { Context, MiddlewareHandler } from "hono";
import type { Address } from "viem";
import { prisma } from "@/db";
import { checkPayload, decodeHeader, encodeHeader, SCHEME } from "./x402";
import type { PaymentPayload, PaymentRequirements } from "./x402";
import type { Settler } from "./settle";

export type PaywallOptions = {
  /**
   * The chain's clock.
   *
   * Every validity window here is compared against block.timestamp by the
   * token, so checking against this machine's clock means judging by a
   * different clock than the one that will settle. They drift, and where they
   * drift a perfectly good authorization is refused — or worse, a stale one is
   * submitted and burns gas reverting.
   */
  now: () => Promise<number>;
  payTo: Address;
  asset: Address;
  network: string;
  settler: Settler;
  /** 6-decimal base units, keyed by route. */
  price: (c: Context) => string;
  description: string;
  maxTimeoutSeconds?: number;
};

/**
 * Charge for a route, x402 style.
 *
 * The order is the whole security argument and it is deliberately rigid:
 * check the payload against what we asked for, prove the signature is the
 * payer's, settle on-chain, record the nonce as spent, and only then run the
 * handler. Serving before settlement confirms is the "free shopping" attack,
 * and it is the easy mistake because it makes the endpoint feel faster.
 */
export function paywall(opts: PaywallOptions): MiddlewareHandler {
  return async (c, next) => {
    const requirements: PaymentRequirements = {
      scheme: SCHEME,
      network: opts.network,
      maxAmountRequired: opts.price(c),
      resource: c.req.path,
      description: opts.description,
      payTo: opts.payTo,
      asset: opts.asset,
      maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
      extra: { name: "USDC", version: "2" },
    };

    const header = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
    if (!header) return require402(c, requirements, "payment_required", "payment required");

    let payload: PaymentPayload;
    try {
      payload = decodeHeader<PaymentPayload>(header);
    } catch {
      return require402(c, requirements, "payment_invalid", "PAYMENT-SIGNATURE is not valid base64 JSON");
    }

    const now = await opts.now();
    const bad = checkPayload(payload, requirements, now);
    if (bad) return require402(c, requirements, bad.code, bad.message);

    const auth = payload.payload.authorization;

    // Idempotency, ours and the token's. One authorization buys one response,
    // forever — lose this and every past payment becomes replayable.
    const spent = await prisma.spentAuthorization.findUnique({ where: { nonce: auth.nonce } });
    if (spent) {
      return c.json({ error: "payment_replayed", message: "this authorization has already been used" }, 409);
    }

    const sigBad = await opts.settler.verifySignature(payload, requirements);
    if (sigBad) return require402(c, requirements, sigBad.code, sigBad.message);

    if (await opts.settler.alreadyUsedOnChain(auth)) {
      return c.json({ error: "payment_replayed", message: "the token has already consumed this nonce" }, 409);
    }

    let txHash: string;
    try {
      txHash = await opts.settler.settle(auth, payload.payload.signature);
    } catch (err) {
      // Nothing is served and the nonce is not marked spent — the payer can
      // retry with the same authorization.
      const raw = err instanceof Error ? err.message : String(err);
      // viem's message is a multi-line report; the reason is the useful line.
      const reason = raw.match(/reverted with the following reason:\s*\n?(.+)/)?.[1]?.trim() ?? raw.split("\n")[0];
      return c.json({ error: "settlement_failed", message: reason }, 502);
    }

    try {
      await prisma.spentAuthorization.create({
        data: {
          nonce: auth.nonce,
          payer: auth.from.toLowerCase(),
          payTo: auth.to.toLowerCase(),
          amount: auth.value,
          resource: requirements.resource,
          txHash,
        },
      });
    } catch (err) {
      // We have settled and failed to record it. Serving anyway would leave a
      // replayable nonce; refusing leaves a paid buyer who can retry, and the
      // token itself will reject the second settlement. The second is the
      // recoverable failure.
      return c.json(
        {
          error: "settlement_failed",
          message: "payment settled but could not be recorded; retry is safe",
          txHash,
        },
        500,
      );
    }

    c.header("PAYMENT-RESPONSE", encodeHeader({ success: true, transaction: txHash, network: opts.network, payer: auth.from }));
    await next();
  };
}

function require402(c: Context, requirements: PaymentRequirements, code: string, message: string) {
  c.header("PAYMENT-REQUIRED", encodeHeader({ x402Version: 1, accepts: [requirements], error: code }));
  return c.json({ error: code, message, accepts: [requirements] }, 402);
}
