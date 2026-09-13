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
           *
           * suppressHydrationWarning is for something we do not control. Dark
           * Reader and extensions like it rewrite images before React hydrates,
           * adding `filter: invert(...)` to the element's own style attribute —
           * so the DOM React finds is not the DOM it rendered, and it says so:
           *
           *   style={{color:"transparent"}}
           *   style={{color:"transparent",filter:"invert(0)"}}
           *
           * `invert` appears nowhere in this repo or its build. There is no
           * mismatch to fix in our markup, and nothing React can reconcile —
           * the visitor asked their browser to do that. This is the same reason
           * <html> carries the prop in layout.tsx, where the theme script
           * mutates the element before hydration.
           */}
          <Image
            src="/mark.png"
            alt=""
            width={22}
            height={22}
            className="rounded-[5px]"
            priority
            suppressHydrationWarning
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
