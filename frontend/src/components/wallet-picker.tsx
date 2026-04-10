"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";

function isPopularWallet(name: string) {
  const normalized = name.toLowerCase();
  return normalized.includes("metamask") || normalized.includes("coinbase");
}

export function WalletPicker() {
  const {
    showWalletPicker,
    closeWalletPicker,
    availableWallets,
    connectWallet,
    isConnecting,
    error
  } = useWallet();

  const sortedWallets = useMemo(() => {
    return [...availableWallets].sort((a, b) => a.info.name.localeCompare(b.info.name));
  }, [availableWallets]);

  if (!showWalletPicker) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={closeWalletPicker}
      role="dialog"
      aria-modal="true"
      aria-label="Wallet selection modal"
    >
      <div
        className="w-full max-w-[420px] rounded-2xl border border-white/15 bg-[#0f1116] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Connect Wallet</h2>
            <p className="mt-1 text-sm text-[#9CA3AF]">Choose a wallet to connect</p>
          </div>
          <button
            type="button"
            onClick={closeWalletPicker}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-[#9CA3AF] transition hover:border-white/25 hover:text-white"
            aria-label="Close wallet picker"
          >
            X
          </button>
        </div>

        {sortedWallets.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
            <p className="font-medium text-[#EAEAF0]">No wallets detected</p>
            <p>Install a wallet extension and refresh this page.</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="https://metamask.io"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#8FD9FF] hover:border-[#8FD9FF]/40"
              >
                Install MetaMask
              </Link>
              <Link
                href="https://www.coinbase.com/wallet"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#8FD9FF] hover:border-[#8FD9FF]/40"
              >
                Install Coinbase Wallet
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedWallets.map((wallet) => (
              <button
                key={wallet.info.uuid}
                type="button"
                disabled={isConnecting}
                onClick={() => void connectWallet(wallet)}
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-left transition hover:border-[#00FFC8]/50 hover:bg-[#141822] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-center gap-3">
                  {wallet.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wallet.info.icon} alt={wallet.info.name} className="h-8 w-8 rounded-lg" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-xs text-[#9CA3AF]">
                      W
                    </span>
                  )}
                  <span className="text-sm font-medium text-[#EAEAF0]">{wallet.info.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  {isPopularWallet(wallet.info.name) ? (
                    <span className="rounded-full border border-[#00FFC8]/30 bg-[#00FFC8]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#00FFC8]">
                      Popular
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}

        {isConnecting ? (
          <div className="mt-4 flex items-center gap-2 text-xs text-[#9CA3AF]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#00FFC8]/30 border-t-[#00FFC8]" />
            Connecting...
          </div>
        ) : null}

        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
      </div>
    </div>
  );
}
