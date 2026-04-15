"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { OPEN_TUTORIAL_EVENT } from "@/components/global-overlays";
import { RouteAnnouncer } from "@/components/route-announcer";
import { WrongNetworkBanner } from "@/components/wrong-network-banner";
import { expectedChainId, fetchSourceOperatorStatuses, shortAddress } from "@/lib/contracts";
import { IconCheck } from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

const ROLE_TYPES = ["community", "dao_governance"] as const;

type NavItem = {
  href: string;
  label: string;
};

const BASE_LINKS: NavItem[] = [
  { href: "/", label: "Tasks" },
  { href: "/earn", label: "Earn" },
  { href: "/tasks", label: "Agentic" },
  { href: "/milestones", label: "Contracts" },
  { href: "/profile", label: "Profile" }
];

export function NavBar() {
  const pathname = usePathname();
  const { account, chainId, openWalletPicker, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasPendingRoles, setHasPendingRoles] = useState(false);

  const isWrongNetwork = chainId !== null && chainId !== expectedChainId;

  useEffect(() => {
    let active = true;
    const loadPending = async () => {
      if (!account) {
        setHasPendingRoles(false);
        return;
      }
      try {
        const statuses = await fetchSourceOperatorStatuses(account, [...ROLE_TYPES]);
        if (!active) return;
        setHasPendingRoles(Object.values(statuses).some((status) => status.pending));
      } catch {
        if (!active) return;
        setHasPendingRoles(false);
      }
    };
    void loadPending();
    return () => {
      active = false;
    };
  }, [account]);

  const links = useMemo(() => {
    const out: NavItem[] = [...BASE_LINKS];
    if (account) {
      out.splice(4, 0, { href: "/apply", label: "Apply" });
    }
    return out;
  }, [account]);

  return (
    <>
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="sticky top-0 z-50 h-14 border-b border-[var(--border)] bg-[rgba(6,13,20,0.95)] backdrop-blur-md"
      >
        <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="h-4 w-4 rotate-45 border border-[var(--arc)] bg-[rgba(0,229,255,0.12)]" />
              <div>
                <div className="font-heading text-xs font-bold tracking-[0.15em] text-[var(--text-primary)]">ARCHON</div>
                <div className="mono text-[10px] text-[var(--text-muted)]">ARC TESTNET</div>
              </div>
            </Link>
          </div>

          <div className="hidden items-center gap-1 md:flex">
            {links.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              const showDot = link.href === "/apply" && hasPendingRoles;
              return (
                <Link key={link.href} href={link.href} className={`nav-link ${active ? "active" : ""} relative`}>
                  {link.label}
                  {showDot ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--warn)]" /> : null}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="badge badge-arc hidden sm:inline-flex">
              <span className="live-dot" /> ARC
            </span>

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
              <>
                <button type="button" className="btn-ghost px-2 py-1.5 text-xs mono" onClick={disconnect}>
                  {shortAddress(account)}
                </button>
              </>
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
                {links.map((link) => (
                  <Link key={link.href} href={link.href} className="nav-link" onClick={() => setMobileOpen(false)}>
                    {link.label}
                  </Link>
                ))}
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
