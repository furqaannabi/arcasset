import Link from "next/link";
import { ConnectButton } from "./connect-button";
import { CHAIN } from "@/lib/chain";

const LINKS = [
  { href: "/propose", label: "Propose" },
  { href: "/agent", label: "Agent" },
  { href: "/intel", label: "Intel" },
] as const;

export function Nav() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          ArcAsset
        </Link>
        <div className="flex gap-4 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="opacity-70 hover:opacity-100">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs opacity-50 sm:inline">{CHAIN.name}</span>
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
