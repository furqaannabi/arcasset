import { Hono } from "hono";
import { isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { prisma } from "@/db";
import { addressForToken } from "@/auth/session";
import { mandateAbi, noteAbi, noteFactoryAbi } from "@/chain/abis";
import { signatureAuthorises, windowProblem, coversPeriod, USDC_SCALE } from "./verify";

export type MandateOptions = {
  publicClient: PublicClient;
  factory: Address;
  /** RepaymentMandate — the `to` every mandate signature must name. */
  collector: Address;
  /** Circle's FiatToken precompile, whose domain the signature is made under. */
  usdc: Address;
  chainId: number;
  /** Reads signatures out. The agent, and nobody else. */
  agentAddress: Address | null;
};

/**
 * Lodging a repayment mandate.
 *
 * A mandate is a signature and nothing more until the agent spends it. Anyone
 * may *collect* one — the signature is the authority, which is why
 * `RepaymentMandate.collect` is permissionless — but only the borrower may
 * lodge one, or this table becomes a place to keep other people's garbage.
 *
 * Every check below is server-side on purpose. The client chose none of it.
 */
export function mandateRoutes(opts: MandateOptions): Hono {
  const app = new Hono();

  const caller = async (c: { req: { header: (k: string) => string | undefined } }) =>
    addressForToken(c.req.header("Authorization")?.replace(/^Bearer /i, ""));

  app.post("/mandates", async (c) => {
    const who = await caller(c);
    if (!who) return c.json({ error: "unauthorized", message: "sign in first" }, 401);

    const body = await c.req.json().catch(() => null);
    const noteIdRaw = body?.noteId;
    const periodIndex = Number(body?.periodIndex);
    if (
      noteIdRaw === undefined ||
      !Number.isInteger(periodIndex) ||
      periodIndex < 0 ||
      periodIndex > 65_535 ||
      typeof body?.signature !== "string" ||
      !isHex(body.signature)
    ) {
      return c.json({ error: "bad_request", message: "noteId, periodIndex and signature are required" }, 400);
    }

    let noteId: bigint;
    let value: bigint;
    let validAfter: bigint;
    let validBefore: bigint;
    try {
      noteId = BigInt(noteIdRaw);
      value = BigInt(body.value);
      validAfter = BigInt(body.validAfter);
      validBefore = BigInt(body.validBefore);
    } catch {
      return c.json({ error: "bad_request", message: "amounts must be integer strings" }, 400);
    }
    if (value <= 0n) return c.json({ error: "bad_request", message: "value must be positive" }, 400);

    const signature = body.signature as Hex;

    // -- the note, and who is allowed to speak for it ----------------------
    const noteAddress = (await opts.publicClient.readContract({
      address: opts.factory,
      abi: noteFactoryAbi,
      functionName: "noteOf",
      args: [noteId],
    })) as Address;
    if (!isAddress(noteAddress) || /^0x0+$/.test(noteAddress)) {
      return c.json({ error: "unknown_note" }, 404);
    }

    const [borrower, periodDue, block] = await Promise.all([
      opts.publicClient.readContract({
        address: noteAddress, abi: noteAbi, functionName: "borrower",
      }) as Promise<Address>,
      opts.publicClient.readContract({
        address: noteAddress, abi: noteAbi, functionName: "periodDue", args: [periodIndex],
      }) as Promise<bigint>,
      opts.publicClient.getBlock(),
    ]);

    if (borrower.toLowerCase() !== who.toLowerCase()) {
      return c.json(
        { error: "not_borrower", message: "only the borrower on this note may lodge a mandate for it" },
        403,
      );
    }

    // -- the window, judged on chain time ----------------------------------
    const problem = windowProblem(validAfter, validBefore, block.timestamp);
    if (problem) {
      return c.json({ error: "bad_window", message: `validBefore is ${problem}` }, 400);
    }

    // -- enough to actually settle the period ------------------------------
    if (!coversPeriod(value, periodDue)) {
      return c.json(
        {
          error: "short_mandate",
          message: `period ${periodIndex} needs ${periodDue / USDC_SCALE} but the mandate authorises ${value}`,
        },
        400,
      );
    }

    // -- the nonce, from the contract and never from the client -------------
    // A signature over a nonce the contract does not derive is valid to the
    // token and useless to collect: it would fail at pull time, having already
    // spent the gas, with nothing to point at.
    const nonce = (await opts.publicClient.readContract({
      address: opts.collector,
      abi: mandateAbi,
      functionName: "mandateNonce",
      args: [noteId, periodIndex],
    })) as Hex;

    const ok = await signatureAuthorises(
      opts.usdc,
      opts.chainId,
      { borrower, collector: opts.collector, value, validAfter, validBefore, nonce },
      signature,
    );
    if (!ok) {
      return c.json(
        { error: "bad_signature", message: "the signature does not authorise these terms from this address" },
        400,
      );
    }

    const key = { noteId: noteId.toString(), periodIndex };
    const existing = await prisma.mandate.findUnique({ where: { noteId_periodIndex: key } });
    if (existing?.collectedTx) {
      return c.json({ error: "already_collected", tx: existing.collectedTx }, 409);
    }

    const row = {
      ...key,
      borrower: borrower.toLowerCase(),
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      signature,
    };
    // Re-signing replaces: the nonce is the same either way, and the token will
    // honour exactly one of them regardless of how many we hold.
    await prisma.mandate.upsert({
      where: { noteId_periodIndex: key },
      create: row,
      update: row,
    });

    return c.json({ noteId: key.noteId, periodIndex, value: row.value, validBefore: row.validBefore }, 201);
  });

  /**
   * What is covered, and what has been spent. The UI renders the schedule from
   * this; signatures are withheld from everyone but the agent, because a
   * mandate in someone else's hands is a repayment they can trigger early.
   */
  app.get("/mandates/:noteId", async (c) => {
    const raw = c.req.param("noteId");
    let noteId: bigint;
    try {
      noteId = BigInt(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }

    const who = await caller(c);
    const isAgent = Boolean(
      opts.agentAddress && who && who.toLowerCase() === opts.agentAddress.toLowerCase(),
    );

    const rows = await prisma.mandate.findMany({
      where: { noteId: noteId.toString() },
      orderBy: { periodIndex: "asc" },
    });

    return c.json({
      noteId: noteId.toString(),
      mandates: rows.map((m) => ({
        periodIndex: m.periodIndex,
        value: m.value,
        validAfter: m.validAfter,
        validBefore: m.validBefore,
        collected: Boolean(m.collectedTx),
        collectedTx: m.collectedTx,
        ...(isAgent ? { nonce: m.nonce, signature: m.signature } : {}),
      })),
    });
  });

  return app;
}
