"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OPEN_TUTORIAL_EVENT } from "@/components/global-overlays";
import { RouteAnnouncer } from "@/components/route-announcer";
import { WrongNetworkBanner } from "@/components/wrong-network-banner";
import { expectedChainId, fetchSourceOperatorStatuses, shortAddress } from "@/lib/contracts";
import { IconCheck } from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

const ROLE_TYPES = ["task", "community", "agent_task", "dao_governance"] as const;

type NavLink = {
  href: string;
  label: string;
  tooltip?: string;
  showPendingDot?: boolean;
};

function LinkItem({
  pathname,
  link,
  onClick
}: {
  pathname: string;
  link: NavLink;
  onClick?: () => void;
}) {
  const active = pathname === link.href;
  return (
    <Link
      href={link.href}
      onClick={onClick}
      title={link.tooltip}
      className={`relative rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
        active ? "bg-[#6C5CE7]/25 text-[#EAEAF0]" : "text-[#9CA3AF] hover:bg-white/5 hover:text-[#EAEAF0]"
      }`}
    >
      {link.label}
      {link.showPendingDot ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" /> : null}
    </Link>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { account, chainId, openWalletPicker, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasPendingRoles, setHasPendingRoles] = useState(false);

  const isWrongNetwork = chainId !== null && chainId !== expectedChainId;

  useEffect(() => {
    let active = true;

    const loadRolePending = async () => {
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

    void loadRolePending();

    return () => {
      active = false;
    };
  }, [account]);

  const desktopLinks = useMemo<NavLink[]>(() => {
    const links: NavLink[] = [
      { href: "/", label: "Tasks" },
      { href: "/earn", label: "Earn" },
      { href: "/tasks", label: "Agentic Tasks" },
      { href: "/my-work", label: "My Work" },
      {
        href: "/milestones",
        label: "Contracts",
        tooltip: "Milestone-based smart contracts with USDC escrow and dispute arbitration"
      }
    ];

    if (account) {
      links.push({ href: "/apply", label: "Apply", showPendingDot: hasPendingRoles });
    }
    links.push({ href: "/profile", label: "Profile" });

    return links;
  }, [account, hasPendingRoles]);

  return (
    <>
      <header className="border-b border-white/10 bg-[#0a0a0b]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/logo-icon.svg" alt="Archon logo" width={30} height={30} />
              <span className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Archon</span>
            </Link>
            <button
              type="button"
              aria-label={mobileOpen ? "Close mobile menu" : "Open mobile menu"}
              onClick={() => setMobileOpen((previous) => !previous)}
              className="archon-button-secondary px-3 py-2 text-sm md:hidden"
            >
              {mobileOpen ? "Close" : "Menu"}
            </button>
          </div>

          <nav className="hidden flex-wrap items-center gap-2 md:flex">
            {desktopLinks.map((link) => (
              <LinkItem key={link.href} pathname={pathname} link={link} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {account ? (
              <Link
                href={`/verify/${account}`}
                title="View your public credential page"
                className="archon-button-secondary inline-flex items-center px-2.5 py-2 text-sm"
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
              className="archon-button-secondary px-2.5 py-2 text-sm"
            >
              ?
            </button>

            {account ? (
              <>
                <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                  {shortAddress(account)} {isWrongNetwork ? `(Switch to ${expectedChainId})` : ""}
                </div>
                <button
                  type="button"
                  aria-label="Disconnect wallet"
                  onClick={disconnect}
                  className="archon-button-secondary px-3 py-2 text-sm"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={openWalletPicker}
                className="archon-button-primary px-3 py-2 text-sm transition-all duration-200"
              >
                Connect Wallet
              </button>
            )}
          </div>

          {mobileOpen ? (
            <nav className="grid gap-2 rounded-xl border border-white/10 bg-[#111214] p-3 md:hidden">
              {desktopLinks.map((link) => (
                <LinkItem
                  key={link.href}
                  pathname={pathname}
                  link={link}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
              {account ? (
                <Link
                  href={`/verify/${account}`}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    pathname.startsWith("/verify/") ? "bg-[#6C5CE7]/25 text-[#EAEAF0]" : "text-[#9CA3AF]"
                  }`}
                >
                  Verify
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </header>
      <WrongNetworkBanner isWrongNetwork={isWrongNetwork} />
      <RouteAnnouncer />
    </>
  );
}
