import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ArcAsset",
  description:
    "Autonomous agents that service tokenized private credit on Arc for verified-human issuers, and sell what they learn.",
};

/**
 * Applies a stored theme choice before first paint. Without this the page
 * renders in the OS theme and then snaps to the chosen one — the flash is
 * worst for exactly the person who set the preference.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
