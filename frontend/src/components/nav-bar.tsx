"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { OPEN_TUTORIAL_EVENT } from "@/components/global-overlays";
import { RouteAnnouncer } from "@/components/route-announcer";
import { WrongNetworkBanner } from "@/components/wrong-network-banner";
import { expectedChainId, shortAddress } from "@/lib/contracts";
import { IconCheck } from "@/lib/icons";
import { getTheme, Theme, toggleTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet-context";

type NavItem = {
  href: string;
  label: string;
};

const NAV_LINKS: NavItem[] = [
  { href: "/", label: "Tasks" },
  { href: "/earn", label: "Earn" },
  { href: "/milestones", label: "Contracts" },
  { href: "/profile", label: "Profile" }
];

export function NavBar() {
  const pathname = usePathname();
  const { account, chainId, openWalletPicker, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  const isWrongNetwork = chainId !== null && chainId !== expectedChainId;

  useEffect(() => {
    setTheme(getTheme());
  }, []);

  return (
    <>
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="sticky top-0 z-50 h-14 border-b border-[var(--border)] backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)" }}
      >
        <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo-icon.svg" alt="Archon" className="h-8 w-auto" />
            <div>
              <div className="font-heading text-xs font-bold tracking-[0.15em] text-[var(--text-primary)]">ARCHON</div>
              <div className="mono text-[10px] text-[var(--text-muted)]">ARC TESTNET</div>
            </div>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              return (
                <Link key={link.href} href={link.href} className={`nav-link ${active ? "active" : ""}`}>
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/skill.md"
              className="badge badge-agent ml-2 transition-opacity hover:opacity-90"
              title="Agent API"
            >
              For Agents
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span className="badge badge-arc hidden sm:inline-flex">
              <span className="live-dot" /> ARC
            </span>

            <button
              type="button"
              onClick={() => setTheme(toggleTheme())}
              className="flex h-8 w-8 items-center justify-center transition-all duration-200"
              style={{
                background: theme === "light" ? "#E8EFF6" : "transparent",
                border: `1px solid ${theme === "light" ? "#CBD5E1" : "var(--border)"}`,
                color: theme === "light" ? "#334155" : "var(--text-secondary)",
                padding: "6px 8px",
                cursor: "pointer"
              }}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {account ? (
              <Link
                href={`/verify/${account}`}
                title="View your public credential page"
                className="btn-ghost inline-flex items-center px-2 py-1.5 text-xs"
                aria-label="View public verification page"
              >
                <IconCheck className="h-4 w-4" />
              </Link>
            ) : null}

            <button
              type="button"
              title="How to use Archon"
              aria-label="How to use Archon"
              onClick={() => window.dispatchEvent(new Event(OPEN_TUTORIAL_EVENT))}
              className="btn-ghost px-2 py-1.5 text-xs"
            >
              ?
            </button>

            {account ? (
              <button type="button" className="btn-ghost px-2 py-1.5 text-xs mono" onClick={disconnect}>
                {shortAddress(account)}
              </button>
            ) : (
              <button type="button" onClick={openWalletPicker} className="btn-primary px-3 py-1.5 text-xs">
                Connect
              </button>
            )}

            <button
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="btn-ghost px-2 py-1.5 text-xs md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? "X" : "Menu"}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileOpen ? (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="border-t border-[var(--border)] bg-[var(--surface)] p-3 md:hidden"
            >
              <div className="grid gap-1">
                {NAV_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="nav-link" onClick={() => setMobileOpen(false)}>
                    {link.label}
                  </Link>
                ))}
                <Link href="/skill.md" className="badge badge-agent mt-2 w-fit" onClick={() => setMobileOpen(false)}>
                  For Agents
                </Link>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.nav>
      <WrongNetworkBanner isWrongNetwork={isWrongNetwork} />
      <RouteAnnouncer />
    </>
  );
}
