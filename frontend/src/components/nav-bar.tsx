"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { expectedChainId, shortAddress } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";
import { RouteAnnouncer } from "@/components/route-announcer";
import { WrongNetworkBanner } from "@/components/wrong-network-banner";

const baseNavLinks = [
  { href: "/", label: "Home" },
  { href: "/earn", label: "Earn" },
  { href: "/tasks", label: "Tasks" },
  { href: "/profile", label: "Profile" }
];

export function NavBar() {
  const pathname = usePathname();
  const { account, chainId, connect, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const adminWallet = process.env.NEXT_PUBLIC_ADMIN_WALLET?.toLowerCase() ?? "";

  const isWrongNetwork = chainId !== null && chainId !== expectedChainId;
  const isAdmin = useMemo(
    () => Boolean(account && adminWallet && account.toLowerCase() === adminWallet),
    [account, adminWallet]
  );

  const navLinks = useMemo(
    () => (isAdmin ? [...baseNavLinks, { href: "/admin", label: "Admin" }] : baseNavLinks),
    [isAdmin]
  );

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

          <nav className={`${mobileOpen ? "flex" : "hidden"} flex-wrap items-center gap-2 md:flex`}>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                  pathname === link.href
                    ? "bg-[#6C5CE7]/25 text-[#EAEAF0]"
                    : "text-[#9CA3AF] hover:bg-white/5 hover:text-[#EAEAF0]"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
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
                onClick={() => void connect()}
                className="archon-button-primary px-3 py-2 text-sm transition-all duration-200"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>
      <WrongNetworkBanner isWrongNetwork={isWrongNetwork} />
      <RouteAnnouncer />
    </>
  );
}
