import Image from "next/image";
import Link from "next/link";
import { ConnectButton } from "./connect-button";
import { ThemeToggle } from "./theme-toggle";
import { CHAIN } from "@/lib/chain";

const LINKS = [
  { href: "/propose", label: "Propose" },
  { href: "/proposals", label: "Proposals" },
  { href: "/notes", label: "Notes" },
  { href: "/agent", label: "Agent" },
  { href: "/intel", label: "Intel" },
] as const;

export function Nav() {
  return (
    <header className="border-b border-line bg-canvas">
      <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          {/*
           * The mark carries its own dark tile, so it reads on both themes
           * without a second file — the wordmark alone is near-white and
           * would disappear on the light canvas.
           */}
          <Image
            src="/mark.png"
            alt=""
            width={22}
            height={22}
            className="rounded-[5px]"
            priority
          />
          <span className="font-mono text-sm tracking-tight">ArcAsset</span>
        </Link>

        <div className="flex gap-5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-mono text-xs tracking-wide text-muted transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className="eyebrow hidden sm:inline">{CHAIN.name}</span>
          <ThemeToggle />
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
