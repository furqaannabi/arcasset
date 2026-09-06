import { verifyTypedData, hexToNumber, slice } from "viem";
import type { Account, Address, Hash, Hex, PublicClient, WalletClient } from "viem";
import { usdcAbi } from "@/chain/abis";
import { EIP3009_TYPES, domainFor } from "./x402";
import type { Authorization, PaymentPayload, PaymentRequirements, Rejection } from "./x402";

/**
 * The half of x402 that touches the chain: prove the signature is the payer's,
 * then actually move the money before anything is served.
 *
 * We self-facilitate. Outsourcing the step that decides whether we get paid to
 * a service we do not run is not a simplification worth having at this size,
 * and it would make every attack in the study somebody else's to prevent on
 * our behalf.
 */

export type Settler = {
  verifySignature(payload: PaymentPayload, req: PaymentRequirements): Promise<Rejection | null>;
  alreadyUsedOnChain(auth: Authorization): Promise<boolean>;
  settle(auth: Authorization, signature: Hex): Promise<Hash>;
};

export class ChainSettler implements Settler {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly wallet: WalletClient,
    private readonly asset: Address,
    private readonly chainId: number,
    private readonly maxGas: bigint,
  ) {}

  /**
   * The signature must recover to the address that is paying. Without this
   * check anyone could submit anyone else's authorization shape and have us
   * treat it as payment.
   */
  async verifySignature(
    payload: PaymentPayload,
    req: PaymentRequirements,
  ): Promise<Rejection | null> {
    const a = payload.payload.authorization;
    const valid = await verifyTypedData({
      address: a.from,
      domain: domainFor(this.asset, this.chainId, req.extra.name, req.extra.version),
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: a.from,
        to: a.to,
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce,
      },
      signature: payload.payload.signature,
    }).catch(() => false);

    return valid ? null : { code: "payment_invalid", message: "signature does not match the payer" };
  }

  /** The token's own view. Cheaper than discovering it by reverting. */
  async alreadyUsedOnChain(auth: Authorization): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.asset,
      abi: usdcAbi,
      functionName: "authorizationState",
      args: [auth.from, auth.nonce],
    });
  }

  async settle(auth: Authorization, signature: Hex): Promise<Hash> {
    const r = slice(signature, 0, 32);
    const s = slice(signature, 32, 64);
    let v = hexToNumber(slice(signature, 64, 65));
    // Some signers produce 0/1 rather than 27/28.
    if (v < 27) v += 27;

    const { request } = await this.publicClient.simulateContract({
      address: this.asset,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: [
        auth.from, auth.to, BigInt(auth.value),
        BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce,
        v, r, s,
      ],
      account: this.wallet.account as Account,
    });

    // Bound the cost, do not starve it. Forcing gas to the ceiling makes every
    // settlement revert out-of-gas with no reason string, which looks exactly
    // like a bad signature and is not. Estimate, then refuse anything above
    // budget — that is what defends against gas amplification while still
    // paying for legitimate work.
    const estimate = await this.publicClient.estimateContractGas({
      address: this.asset,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: [
        auth.from, auth.to, BigInt(auth.value),
        BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce,
        v, r, s,
      ],
      account: this.wallet.account as Account,
    });
    if (estimate > this.maxGas) {
      throw new Error(`settlement would cost ${estimate} gas, over the ${this.maxGas} ceiling`);
    }

    // A little headroom over the estimate; the ceiling above is the real bound.
    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") {
      throw new Error(`settlement reverted in ${hash}`);
    }
    return hash;
  }
}
