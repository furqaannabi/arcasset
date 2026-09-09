"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";
import { API_URL, api } from "@/lib/api";
import { CHAIN, txUrl } from "@/lib/chain";
import { formatBaseUnits, shortAddress } from "@/lib/format";
import {
  EIP3009_TYPES,
  authorizationFor,
  decodeReceipt,
  domainFor,
  encodePayment,
} from "@/lib/x402";
import type { PaymentReceipt, PaymentRequirements, Quote } from "@/lib/x402";
import { Button, Chip, Eyebrow, Field, Input, Panel, SectionHead, Select, Stat } from "./ui";
import { EmptyState, ErrorState, Skeleton } from "./states";
import { StackBadge } from "./stack";

/**
 * The storefront: what the agent learned, and what it costs.
 *
 * The point of this screen is that a stranger pays and gets a verifiable
 * answer, so the exchange is shown rather than hidden. The 402 is displayed
 * before it is paid — what is being asked for, by whom, in what asset — and the
 * settlement transaction is shown after, next to the block the answer was read
 * at. Both halves are checkable by someone who does not trust us.
 *
 * Money on this page is 6-decimal, the ERC-20 face of Arc USDC, because that is
 * what EIP-3009 signs. It never goes through formatUsdc, which is 18-decimal
 * native and would read a trillion times larger.
 */

type Pricing = {
  network: string;
  asset: Address;
  decimals: number;
  scheme: string;
  payTo: Address;
  endpoints: { path: string; price: string; description: string }[];
  available: boolean;
};

/** Which parameter each endpoint takes, since the path alone does not say. */
const SHAPES: Record<string, { label: string; hint: string; build: (a: string) => string }> = {
  "/intel/borrower/:address": {
    label: "Borrower address",
    hint: "Does this counterparty pay on time.",
    build: (a) => `/intel/borrower/${a}`,
  },
  "/intel/originator/:address": {
    label: "Originator address",
    hint: "Do the loans this party writes actually perform.",
    build: (a) => `/intel/originator/${a}`,
  },
  "/intel/note/:address/timeline": {
    label: "Note contract address",
    hint: "Every repayment and servicing action on one note, in order.",
    build: (a) => `/intel/note/${a}/timeline`,
  },
};

type Phase =
  | { at: "idle" }
  | { at: "asking" }
  | { at: "quoted"; path: string; req: PaymentRequirements }
  | { at: "paying" }
  | { at: "answered"; body: unknown; receipt: PaymentReceipt | null }
  | { at: "failed"; message: string };

export function IntelStorefront() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const pricing = useQuery({
    queryKey: ["intel", "pricing"],
    queryFn: () => api<Pricing>("/intel/pricing"),
  });

  const [path, setPath] = useState("/intel/borrower/:address");
  const [target, setTarget] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "idle" });

  const shape = SHAPES[path];

  /**
   * Ask without paying. A 402 is the expected answer, not an error — it is how
   * the price for this exact resource is quoted, and it is quoted per request
   * rather than read off the price list, because the price list is advertising
   * and the 402 is the offer.
   */
  async function ask() {
    if (!shape) return;
    if (!isAddress(target)) {
      setPhase({ at: "failed", message: "That is not an address." });
      return;
    }
    const resource = shape.build(target);
    setPhase({ at: "asking" });
    try {
      const res = await fetch(`${API_URL}${resource}`);
      if (res.status === 402) {
        const quote = (await res.json()) as Quote;
        const req = quote.accepts?.[0];
        if (!req) {
          setPhase({ at: "failed", message: "The server asked for payment but quoted no terms." });
          return;
        }
        setPhase({ at: "quoted", path: resource, req });
        return;
      }
      // 200 without paying means the paywall is not configured — worth saying
      // plainly rather than quietly serving the data as if it were free.
      const body: unknown = await res.json();
      if (res.ok) {
        setPhase({ at: "answered", body, receipt: null });
        return;
      }
      setPhase({ at: "failed", message: messageOf(body, res.status) });
    } catch (e) {
      setPhase({ at: "failed", message: describe(e) });
    }
  }

  /** Sign the authorization and repeat the same request carrying it. */
  async function pay(quoted: Extract<Phase, { at: "quoted" }>) {
    if (!address) {
      setPhase({ at: "failed", message: "Connect a wallet to pay." });
      return;
    }
    setPhase({ at: "paying" });
    try {
      const authorization = authorizationFor(quoted.req, address);
      const signature = await signTypedDataAsync({
        domain: domainFor(quoted.req, CHAIN.id),
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: authorization.from,
          to: authorization.to,
          value: BigInt(authorization.value),
          validAfter: BigInt(authorization.validAfter),
          validBefore: BigInt(authorization.validBefore),
          nonce: authorization.nonce,
        },
      });

      const res = await fetch(`${API_URL}${quoted.path}`, {
        headers: { "X-PAYMENT": encodePayment(quoted.req.network, signature, authorization) },
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setPhase({ at: "failed", message: messageOf(body, res.status) });
        return;
      }
      setPhase({
        at: "answered",
        body,
        receipt: decodeReceipt(res.headers.get("PAYMENT-RESPONSE")),
      });
    } catch (e) {
      setPhase({ at: "failed", message: describe(e) });
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <SectionHead
          index="A"
          title="What is for sale"
          aside={<StackBadge sponsor="arc" role="USDC settled before it is served" muted />}
        />
        {pricing.isLoading ? (
          <Skeleton rows={3} />
        ) : pricing.error ? (
          <ErrorState error={pricing.error} onRetry={() => void pricing.refetch()} />
        ) : (
          <Catalogue pricing={pricing.data} onPick={setPath} picked={path} />
        )}
      </section>

      <section className="space-y-4">
        <SectionHead index="B" title="Buy an answer" />
        <Panel className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpoint" hint={shape?.hint ?? ""}>
              <Select
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setPhase({ at: "idle" });
                }}
              >
                {Object.keys(SHAPES).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={shape?.label ?? "Address"} hint="No account is involved. The signature is the whole relationship.">
              <Input
                value={target}
                spellCheck={false}
                placeholder="0x…"
                onChange={(e) => {
                  setTarget(e.target.value);
                  setPhase({ at: "idle" });
                }}
              />
            </Field>
          </div>

          <Button
            tone="primary"
            disabled={phase.at === "asking" || phase.at === "paying"}
            onClick={ask}
          >
            {phase.at === "asking" ? "Asking…" : "Ask"}
          </Button>

          <Exchange phase={phase} onPay={pay} connected={Boolean(address)} />
        </Panel>
      </section>
    </div>
  );
}

function Catalogue({
  pricing,
  picked,
  onPick,
}: {
  pricing: Pricing | undefined;
  picked: string;
  onPick: (p: string) => void;
}) {
  if (!pricing) return null;
  return (
    <div className="space-y-4">
      {!pricing.available ? (
        <EmptyState
          title="The paid API is not configured"
          hint="INTEL_PAY_TO or the agent key is unset on the backend, so these endpoints answer 503 rather than quoting a price. The catalogue below is still what they cost."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {pricing.endpoints.map((e) => (
          <button
            key={e.path}
            onClick={() => onPick(e.path)}
            className={`rounded-card border p-4 text-left transition-colors ${
              picked === e.path ? "border-accent bg-accent-faint" : "border-line bg-panel hover:border-line-strong"
            }`}
          >
            <p className="font-mono text-[11.5px] break-all text-ink">{e.path}</p>
            <p className="mt-2 font-mono text-sm text-accent tnum">
              ${formatBaseUnits(BigInt(e.price), pricing.decimals)}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">{e.description}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 font-mono text-[11.5px] text-muted">
        <span>network {pricing.network}</span>
        <span>asset {shortAddress(pricing.asset)} · {pricing.decimals} decimals</span>
        <span>pays {shortAddress(pricing.payTo)}</span>
      </div>
    </div>
  );
}

/** The 402 and what came back, both shown rather than summarised. */
function Exchange({
  phase,
  onPay,
  connected,
}: {
  phase: Phase;
  onPay: (q: Extract<Phase, { at: "quoted" }>) => void;
  connected: boolean;
}) {
  if (phase.at === "idle") return null;

  if (phase.at === "asking" || phase.at === "paying") {
    return (
      <p className="font-mono text-[12px] text-muted">
        {phase.at === "asking" ? "402 pending…" : "settling before serving…"}
      </p>
    );
  }

  if (phase.at === "failed") {
    return (
      <div className="rounded-card border border-danger/40 bg-danger-faint px-3.5 py-3">
        <Eyebrow className="text-danger">Refused</Eyebrow>
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed break-words text-ink/80">
          {phase.message}
        </p>
      </div>
    );
  }

  if (phase.at === "quoted") {
    const req = phase.req;
    return (
      <div className="space-y-4 rounded-card border border-warn/40 bg-warn-faint px-3.5 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow className="text-warn">402 Payment Required</Eyebrow>
          <Chip tone="warn">{req.scheme} · {req.network}</Chip>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Price" value={`$${formatBaseUnits(BigInt(req.maxAmountRequired), 6)}`} tone="accent" />
          <Stat label="Pays" value={shortAddress(req.payTo)} />
          <Stat label="Asset" value={shortAddress(req.asset)} />
          <Stat label="For" value={req.description} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink/80">
          Signing authorises this one transfer: a fixed amount, to that address,
          with a single-use nonce. It is not an allowance and it cannot be
          reused — the token refuses the second attempt.
        </p>
        <Button tone="primary" disabled={!connected} onClick={() => onPay(phase)}>
          {connected ? `Pay $${formatBaseUnits(BigInt(req.maxAmountRequired), 6)} and retry` : "Connect a wallet to pay"}
        </Button>
      </div>
    );
  }

  return <Answer body={phase.body} receipt={phase.receipt} />;
}

function Answer({ body, receipt }: { body: unknown; receipt: PaymentReceipt | null }) {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const asOfBlock = typeof record["asOfBlock"] === "number" ? record["asOfBlock"] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-accent/40 bg-accent-faint px-3.5 py-3">
        <Eyebrow className="text-accent">Paid, then served</Eyebrow>
        {receipt ? (
          <a
            className="font-mono text-[11.5px] text-accent underline-offset-2 hover:underline"
            href={txUrl(receipt.transaction)}
            target="_blank"
            rel="noreferrer"
          >
            settlement {shortAddress(receipt.transaction)}
          </a>
        ) : (
          <span className="font-mono text-[11.5px] text-muted">
            no settlement — the paywall is not configured, so this was free
          </span>
        )}
        {asOfBlock !== null ? (
          <span className="font-mono text-[11.5px] text-muted tnum">
            read at block {asOfBlock.toLocaleString()}
          </span>
        ) : null}
      </div>

      {/*
        The response verbatim. A summary here would be this page asserting what
        the API said; the buyer came for the API's own answer, and the shapes
        are documented in backend/README.md.
      */}
      <pre className="max-h-[28rem] overflow-auto rounded-card border border-line bg-panel p-4 font-mono text-[11.5px] leading-relaxed text-ink">
        {JSON.stringify(body, null, 2)}
      </pre>
    </div>
  );
}

function messageOf(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const r = body as { message?: unknown; error?: unknown };
    if (typeof r.message === "string") return r.message;
    if (typeof r.error === "string") return r.error;
  }
  return `HTTP ${status}`;
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    if (/User rejected|denied/i.test(e.message)) return "Signature declined — nothing was paid.";
    return e.message;
  }
  return "request failed";
}
