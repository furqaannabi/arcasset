import Link from "next/link";
import { Button, Eyebrow } from "@/components/ui";
import { StackStrip, StackBadge } from "@/components/stack";
import { Lifecycle } from "@/components/lifecycle";
import { AgentLog } from "@/components/agent-log";
import { ScheduleRibbon } from "@/components/schedule-ribbon";
import { IntelPreview } from "@/components/intel-preview";
import { ProtocolRecord } from "@/components/protocol-record";
import { CHAIN } from "@/lib/chain";

const CONSUMERS = [
  {
    who: "The agent",
    what: "reasons over it to decide what is due and who is late, then acts.",
  },
  {
    who: "This app",
    what: "renders every figure on every screen from it. No shadow database.",
  },
  {
    who: "/intel/*",
    what: "sells it per query. The byproduct of servicing is the asset.",
  },
];

/**
 * Boundaries, on the landing page rather than buried in a doc. An honest limit
 * is more persuasive than an overclaim someone can puncture in one question,
 * and every one of these is a real decision from docs/00-overview.md.
 */
const NOT = [
  ["Not KYC.", "Verification proves a live human. No name, no country, no document."],
  ["Not a credit score.", "Being verified says nothing about whether a loan gets repaid."],
  ["Not a court.", "A note is a claim on a contract. Acceptance is recorded, not enforced."],
  ["Not a market.", "Notes transfer, but there is no order book and no trading venue."],
];

export default function Home() {
  return (
    <div className="space-y-24">
      {/*
        Hero.
        
        The ribbon behind it is the loans themselves — one strand per note, one
        rung per period, coloured by what happened. It is the only image on
        this page, it is not decoration, and nobody else could draw it because
        nobody else has the data.

        Full-bleed on a page whose content is otherwise held to max-w-6xl, so
        the margins are negative rather than the layout being rebuilt around
        one section.
      */}
      <section className="relative -mx-6 -mt-12 overflow-hidden px-6 pt-12">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <ScheduleRibbon />
          {/* The headline has to win. This keeps the lattice off the text
              without dimming the whole figure. */}
          <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/92 via-45% to-canvas/25" />
        </div>

        <div className="mx-auto max-w-6xl">
          {/*
            Clamped rather than a bare vh: on a tall or portrait window 68vh is
            most of a metre of empty canvas, and the fold stops doing its job
            of promising there is something below it.
          */}
          <div className="flex min-h-[clamp(520px,68vh,760px)] max-w-3xl flex-col justify-center py-16">
            <Eyebrow>Tokenized private credit · {CHAIN.name}</Eyebrow>

            <h1 className="mt-6 text-[clamp(42px,7vw,86px)] leading-[0.95] font-medium tracking-[-0.04em] text-balance">
              Servicing runs itself.
              <br />
              <span className="text-muted">The record it leaves</span>
              <br />
              <span className="text-muted">is the product.</span>
            </h1>

            <p className="mt-8 max-w-lg text-[15px] leading-relaxed text-muted">
              An originator tokenizes a loan they already made. An agent
              collects, distributes and marks delinquency on its own — and
              every period it settles becomes repayment history somebody will
              pay to read.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/propose">
                <Button tone="primary">Propose a note</Button>
              </Link>
              <Link href="/intel">
                <Button tone="secondary">See what it sells</Button>
              </Link>
            </div>

            {/*
              Said once, quietly, at the bottom of the fold — the page spends
              the rest of its length proving it rather than repeating it.
            */}
            <p className="mt-16 max-w-md text-[12px] leading-relaxed text-faint">
              Every figure on this page is live: the lattice above, the log
              below, the record after it and the prices at the end are read
              from Arc and from the index. There are no mockups here.
            </p>
          </div>
        </div>
      </section>

      {/* The agent, working, directly under the fold. */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
          <div className="max-w-xl space-y-2">
            <Eyebrow>00 / Right now</Eyebrow>
            <h2 className="text-[26px] leading-tight font-medium tracking-tight text-balance">
              Nobody is touching this.
            </h2>
          </div>
          <StackBadge sponsor="arc" role="settles in native USDC" />
        </div>

        <AgentLog />
      </section>

      {/*
        Evidence before argument. A reader who goes no further than this
        section has seen the claim tested: an agent settled these periods,
        flagged these two, and carried these notes to maturity with nobody
        watching.
      */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
          <div className="max-w-xl space-y-2">
            <Eyebrow>01 / The record</Eyebrow>
            <h2 className="text-[26px] leading-tight font-medium tracking-tight text-balance">
              This already happened, without anyone watching.
            </h2>
          </div>
          <StackBadge sponsor="graph" role="every figure, read live" />
        </div>

        <ProtocolRecord />
      </section>

      {/* The three-signature gate */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
          <div className="max-w-xl space-y-2">
            <Eyebrow>02 / Issuance</Eyebrow>
            <h2 className="text-[26px] leading-tight font-medium tracking-tight text-balance">
              Nothing mints until three people say yes.
            </h2>
          </div>
          <StackBadge sponsor="world" role="gates the write side" />
        </div>

        <Lifecycle current="propose" />

        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          The originator and the borrower are different people, and that is the
          point. If whoever sells the exposure were also whoever repays it, they
          could mint against an address they control, pay themselves on time,
          and manufacture the spotless record we are selling. One nullifier per
          address makes two verified addresses two humans — and an admin reads
          the agreement before anything exists on-chain.
        </p>
      </section>

      {/* One index, three consumers */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
          <div className="max-w-xl space-y-2">
            <Eyebrow>03 / Read path</Eyebrow>
            <h2 className="text-[26px] leading-tight font-medium tracking-tight text-balance">
              One index, three consumers.
            </h2>
          </div>
          <StackBadge sponsor="graph" role="the only read path" />
        </div>

        <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
          {CONSUMERS.map((c) => (
            <div key={c.who} className="bg-canvas px-5 py-5">
              <p className="font-mono text-[13px] text-ink">{c.who}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{c.what}</p>
            </div>
          ))}
        </div>

        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          The agent keeps no database of its own. If it dies, state is intact
          on-chain and a replacement with the same delegation picks up from the
          same index.
        </p>
      </section>

      {/* The data product, shown rather than described */}
      <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <div className="space-y-5">
          <Eyebrow>04 / The asset</Eyebrow>
          <h2 className="text-[26px] leading-tight font-medium tracking-tight text-balance">
            Repayment history, priced per query.
          </h2>
          <p className="max-w-xl text-[13px] leading-relaxed text-muted">
            Two products, because a three-party structure asks two questions.
            Does this counterparty pay on time — and do the loans this
            originator writes actually perform? The second is the one a capital
            allocator pays real money for.
          </p>
          <p className="max-w-xl text-[13px] leading-relaxed text-muted">
            A stranger with a wallet and no account gets a 402, pays, and
            receives an answer computed from indexed history.
          </p>
          <div className="pt-1">
            <StackBadge sponsor="arc" role="USDC settles per query" />
          </div>
        </div>

        <div className="space-y-2">
          <IntelPreview />
          <p className="text-[11px] text-faint">
            Prices are live from the API. Figures belong to whichever address is
            asked about — <Link href="/intel" className="underline underline-offset-2 hover:text-muted">buy one</Link>.
          </p>
        </div>
      </section>

      {/* Honest boundaries */}
      <section className="space-y-6">
        <div className="border-b border-line pb-3">
          <Eyebrow>05 / Boundaries</Eyebrow>
          <h2 className="mt-2 text-[26px] leading-tight font-medium tracking-tight">
            What this is not.
          </h2>
        </div>
        <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {NOT.map(([title, body]) => (
            <div key={title} className="flex gap-3">
              <span className="mt-2 h-px w-5 shrink-0 bg-line-strong" />
              <div>
                <dt className="text-[13px] font-medium text-ink">{title}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-muted">{body}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <StackStrip />
    </div>
  );
}
