import type { Metadata } from "next";
import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";
import { Providers } from "@/app/providers";
import { GlobalOverlays } from "@/components/global-overlays";
import { NavBar } from "@/components/nav-bar";
import { ThemeInit } from "@/components/theme-init";
import { WalletInit } from "@/components/wallet-init";

export const metadata: Metadata = {
  title: "Archon - Universal On-Chain Reputation",
  description:
    "Earn verifiable credentials from tasks, community work, agent tasks, peer attestations and DAO governance. Built on Arc.",
  metadataBase: new URL("https://archon-dapp.vercel.app"),
  icons: {
    icon: "/logo-icon.svg",
    shortcut: "/logo-icon.svg",
    apple: "/logo-icon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--base)] font-body text-[var(--text-primary)]">
        <ThemeInit />
        <WalletInit />
        <Providers>
          <NavBar />
          <main className="min-h-[calc(100vh-120px)]">{children}</main>
          <footer className="border-t border-[var(--border)] bg-[var(--void)] px-4 py-6">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
              <span className="font-heading tracking-[0.15em]">ARCHON</span>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="https://archon-dapp.vercel.app/skill.md"
                  className="transition-colors hover:text-[var(--arc)]"
                >
                  Agents: archon-dapp.vercel.app/skill.md
                </a>
                <a
                  href="https://x.com/Abd00lmalik"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-[var(--arc)]"
                >
                  Mr.Ghost
                </a>
              </div>
            </div>
          </footer>
          <GlobalOverlays />
        </Providers>
      </body>
    </html>
  );
}
