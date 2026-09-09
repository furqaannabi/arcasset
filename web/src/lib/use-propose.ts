"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { useSession } from "./use-session";
import { issuanceQueueAbi } from "./abis";
import { ISSUANCE_QUEUE } from "./deployments";
import type { Terms } from "./terms";

/**
 * Seal, then propose — in that order, and never merged.
 *
 * The manifest hash has to exist before the transaction is built, because it
 * is an argument to it. Sealing also freezes the files: after it, the bytes
 * the borrower and the admin are asked to vouch for cannot change. An
 * optimistic flow that signed first and uploaded after would be signing over
 * documents nobody had yet.
 */
export type ProposeStep =
  | "idle"
  | "signing-in"
  | "creating-draft"
  | "uploading"
  | "sealing"
  | "awaiting-wallet"
  | "confirming"
  | "done";

export const STEP_LABEL: Record<Exclude<ProposeStep, "idle" | "done">, string> = {
  "signing-in": "Sign in to upload the agreement…",
  "creating-draft": "Creating the draft…",
  uploading: "Uploading the agreement…",
  sealing: "Sealing — freezing the documents and hashing them…",
  "awaiting-wallet": "Confirm the proposal in your wallet…",
  confirming: "Waiting for the transaction…",
};

export type ProposeResult = {
  manifestHash: Hex;
  documentURI: string;
  txHash: Hex;
};

export function usePropose() {
  const { address } = useAccount();
  const { ensureSession, authed } = useSession();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [step, setStep] = useState<ProposeStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProposeResult | null>(null);

  const propose = useCallback(
    async (terms: Terms, files: File[]) => {
      if (!address) return;
      setError(null);
      setResult(null);

      try {
        setStep("signing-in");
        const token = await ensureSession();
        if (!token) throw new Error("Sign in with this wallet to upload the agreement.");

        setStep("creating-draft");
        const draft = await authed<{ id: string }>("/documents/drafts", {
          method: "POST",
          body: JSON.stringify({
            borrower: terms.borrower,
            // Stored beside the files so a reviewer sees what was proposed,
            // not just the paperwork. bigint has no JSON form, so principal
            // goes as a decimal string and is never re-parsed as a number.
            terms: { ...terms, principal: terms.principal.toString() },
          }),
        });

        setStep("uploading");
        // Sequential, not parallel. The server enforces a file count and this
        // keeps the failure legible: whichever upload failed is the last one
        // attempted, rather than one of several in flight.
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          await authed(`/documents/drafts/${draft.id}/files`, {
            method: "POST",
            body: form,
          });
        }

        setStep("sealing");
        const sealed = await authed<{ manifestHash: Hex; manifestKey: string }>(
          `/documents/drafts/${draft.id}/seal`,
          { method: "POST" },
        );

        setStep("awaiting-wallet");
        const txHash = await writeContractAsync({
          address: ISSUANCE_QUEUE,
          abi: issuanceQueueAbi,
          functionName: "propose",
          args: [
            {
              borrower: terms.borrower as Address,
              principal: terms.principal,
              couponBps: terms.couponBps,
              servicingFeeBps: terms.servicingFeeBps,
              periodCount: terms.periodCount,
              periodLength: BigInt(terms.periodLength),
              gracePeriod: BigInt(terms.gracePeriod),
              cureWindow: BigInt(terms.cureWindow),
              acceptDeadline: BigInt(terms.acceptDeadline),
              // The contract only requires this to be non-zero. Defaulting it
              // to the originator keeps servicing fees with the party who
              // arranged the loan and can pay an agent out of them, without
              // adding a field almost nobody would change.
              feeRecipient: address,
            },
            sealed.manifestHash,
            sealed.manifestKey,
          ],
        });

        setStep("confirming");
        await publicClient?.waitForTransactionReceipt({ hash: txHash });

        setStep("done");
        setResult({
          manifestHash: sealed.manifestHash,
          documentURI: sealed.manifestKey,
          txHash,
        });
      } catch (e) {
        // Wallet rejections are a choice, not a fault, and should not read
        // like the app broke.
        const raw = e instanceof Error ? e.message : "could not propose";
        setError(/user rejected|denied transaction/i.test(raw) ? "Transaction rejected." : raw);
        setStep("idle");
      }
    },
    [address, ensureSession, authed, writeContractAsync, publicClient],
  );

  return { propose, step, error, result };
}
