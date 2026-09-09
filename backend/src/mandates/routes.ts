import { Hono } from "hono";
import { isAddress, verifyTypedData } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { prisma } from "@/db";
import { addressForToken } from "@/auth/session";
import { mandateAbi, noteAbi, noteFactoryAbi } from "@/chain/abis";

/**
 * Where a signed repayment waits until the agent spends it.
 *
 * The borrower signs an EIP-3009 authorization per period — one note, one
 * period, one amount, one window — and it sits here until the period comes
 * short and the agent presents it. We never hold permission to take anything:
 * the signature is the permission, it is single-use, and the token itself
 * refuses the second attempt. What this service holds is a piece of paper.
 *
 * See docs/09-mandate.md for why each check below is server-side.
 */

/** The ERC-20 face is 6 decimals, native is 18. RepaymentMandate scales by this. */
const SCALE = 1_000_000_000_000n;

export type MandateOptions = {
  publicClient: PublicClient;
  factory: Address;
  mandate: Address;
  usdc: Address;
  chainId: number;
};

type Body = {
  noteId?: unknown;
  periodIndex?: unknown;
  value?: unknown;
  validAfter?: unknown;
  validBefore?: unknown;
  signature?: unknown;
};

export function mandateRoutes(opts: MandateOptions): Hono {
  const app = new Hono();

  /**
   * Lodge a mandate. Authenticated as the borrower — anyone may *collect* one,
   * because the signature is the authority and a relayer adds only gas, but
   * only the borrower may put one here or this table becomes a place to store
   * other people's garbage.
   */
  app.post("/", async (c) => {
    const me = await addressForToken(c.req.header("Authorization")?.replace(/^Bearer /i, ""));
    if (!me || !isAddress(me)) {
      return c.json({ error: "unauthorized", message: "sign in with the borrower's wallet" }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as Body | null;
    const parsed = parseBody(body);
    if ("error" in parsed) return c.json({ error: "bad_request", message: parsed.error }, 400);
    const { noteId, periodIndex, value, validAfter, validBefore, signature } = parsed;

    const note = await opts.publicClient
      .readContract({
        address: opts.factory,
        abi: noteFactoryAbi,
        functionName: "noteOf",
        args: [noteId],
      })
      .catch(() => null);
    if (!note || note === "0x0000000000000000000000000000000000000000") {
      return c.json({ error: "not_found", message: `no note ${noteId}` }, 404);
    }

    const [borrower, due] = await Promise.all([
      opts.publicClient.readContract({ address: note, abi: noteAbi, functionName: "borrower" }),
      opts.publicClient.readContract({
        address: note,
        abi: noteAbi,
        functionName: "periodDue",
        args: [periodIndex],
      }),
    ]);

    if (borrower.toLowerCase() !== me.toLowerCase()) {
      return c.json(
        { error: "forbidden", message: "only the borrower on this note can sign for it" },
        403,
      );
    }

    // A short mandate reverts ShortCollection at pull time, after the agent has
    // spent the gas. Refuse it here, where there is a person to tell.
    if (value * SCALE < due) {
      return c.json(
        {
          error: "short_mandate",
          message: `period ${periodIndex} needs ${due} native (${due / SCALE} token units); this mandate moves ${value}`,
        },
        400,
      );
    }

    /**
     * The nonce is derived, never taken from the caller. A signature over some
     * other nonce is perfectly valid to the token and useless to `collect`,
     * which recomputes this one — so accepting a client's nonce stores a
     * mandate that fails at the only moment it matters.
     */
    const nonce = await opts.publicClient.readContract({
      address: opts.mandate,
      abi: mandateAbi,
      functionName: "mandateNonce",
      args: [noteId, periodIndex],
    });

    const ok = await verifyTypedData({
      address: borrower,
      domain: {
        name: "USDC",
        version: "2",
        chainId: opts.chainId,
        verifyingContract: opts.usdc,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      // `to` is the mandate contract, which pulls the token and pays the vault
      // natively in the same call. Signing to the vault would authorise a
      // transfer nothing knows how to spend.
      message: { from: borrower, to: opts.mandate, value, validAfter, validBefore, nonce },
      signature,
    }).catch(() => false);

    if (!ok) {
      return c.json(
        { error: "bad_signature", message: "signature does not match this borrower and mandate" },
        400,
      );
    }

    const row = await prisma.mandate.upsert({
      where: { noteId_periodIndex: { noteId: noteId.toString(), periodIndex } },
      // Re-signing an unspent period replaces it. Re-signing a spent one is
      // pointless — the nonce is burned — so the old row is kept and said so.
      update: { value: value.toString(), validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce, signature },
      create: {
        noteId: noteId.toString(),
        periodIndex,
        borrower: borrower.toLowerCase(),
        value: value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        signature,
      },
    });

    return c.json({ noteId: row.noteId, periodIndex: row.periodIndex, nonce: row.nonce });
  });

  /**
   * What is covered, and what has been spent. Signatures are deliberately not
   * returned: nobody but the agent needs one, and a bearer copy of a signed
   * instrument is not a thing to hand out because it is convenient.
   */
  app.get("/:noteId", async (c) => {
    const noteId = c.req.param("noteId");
    if (!/^\d+$/.test(noteId)) return c.json({ error: "bad_request", message: "noteId is decimal" }, 400);

    const rows = await prisma.mandate.findMany({
      where: { noteId },
      orderBy: { periodIndex: "asc" },
      select: {
        periodIndex: true,
        value: true,
        validAfter: true,
        validBefore: true,
        collectedTx: true,
        createdAt: true,
      },
    });
    return c.json({ noteId, mandates: rows });
  });

  return app;
}

type Parsed = {
  noteId: bigint;
  periodIndex: number;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  signature: Hex;
};

/** Every number arrives as a string. uint256 does not survive a JSON number. */
function parseBody(body: Body | null): Parsed | { error: string } {
  if (!body) return { error: "expected a JSON body" };
  const noteId = asBigInt(body.noteId);
  if (noteId === null || noteId < 0n) return { error: "noteId must be a decimal string" };

  const periodIndex = Number(body.periodIndex);
  if (!Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex > 65_535) {
    return { error: "periodIndex must be a uint16" };
  }

  const value = asBigInt(body.value);
  if (value === null || value <= 0n) return { error: "value must be a positive decimal string" };

  const validAfter = asBigInt(body.validAfter);
  const validBefore = asBigInt(body.validBefore);
  if (validAfter === null || validBefore === null) return { error: "validity window must be decimal strings" };
  if (validBefore <= validAfter) return { error: "validBefore must be after validAfter" };

  const signature = body.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { error: "signature must be a 65-byte hex string" };
  }

  return { noteId, periodIndex, value, validAfter, validBefore, signature: signature as Hex };
}

function asBigInt(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
}
