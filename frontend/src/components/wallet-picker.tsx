"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import type { DetectedWallet } from "@/lib/wallet-discovery";

function WalletIcon({ wallet }: { wallet: DetectedWallet }) {
  const [iconFailed, setIconFailed] = useState(false);

  if (wallet.info.icon && !iconFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={wallet.info.icon}
        alt={wallet.info.name}
        width={40}
        height={40}
        className="h-10 w-10 rounded-xl object-contain"
        onError={() => setIconFailed(true)}
      />
    );
  }

  const initials = wallet.info.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const colors: Record<string, string> = {
    "MetaMask": "#F6851B",
    "Coinbase Wallet": "#0052FF",
    "Rabby Wallet": "#7B68EE",
    "Rabby": "#7B68EE",
    "OKX Wallet": "#000000",
    "Trust Wallet": "#3375BB",
    "Brave Wallet": "#FB542B"
  };

  const bgColor = colors[wallet.info.name] ?? "#145B7D";

  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
      style={{ backgroundColor: bgColor }}
    >
      {initials || "W"}
    </div>
  );
}

function WalletRow({
  wallet,
  isConnecting,
  onConnect
}: {
  wallet: DetectedWallet;
  isConnecting: boolean;
  onConnect: () => void;
}) {
  const isPopular =
    wallet.info.rdns === "io.metamask" ||
    wallet.info.rdns === "com.coinbase.wallet" ||
    wallet.info.name === "MetaMask" ||
    wallet.info.name === "Coinbase Wallet";

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={isConnecting}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-left transition hover:border-[#00FFC8]/50 hover:bg-[#141822] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <WalletIcon wallet={wallet} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[#EAEAF0]">{wallet.info.name}</span>
          {isPopular ? (
            <span className="rounded-full border border-[#00FFC8]/30 bg-[#00FFC8]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#00FFC8]">
              Popular
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[#9CA3AF]">{wallet.info.rdns || "EVM Wallet"}</div>
      </div>

      <span className="text-[#6B7280] transition group-hover:translate-x-0.5 group-hover:text-[#00FFC8]">→</span>
    </button>
  );
}

export function WalletPicker() {
  const { showWalletPicker, closeWalletPicker, availableWallets, connectWallet, isConnecting, error } = useWallet();
  const modalRef = useRef<HTMLDivElement>(null);
  const [clickedWallet, setClickedWallet] = useState<string | null>(null);

  const sortedWallets = useMemo(() => {
    return [...availableWallets].sort((a, b) => a.info.name.localeCompare(b.info.name));
  }, [availableWallets]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWalletPicker();
    };

    if (showWalletPicker) {
      window.addEventListener("keydown", handleEscape);
      setClickedWallet(null);
    }

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeWalletPicker, showWalletPicker]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
      closeWalletPicker();
    }
  };

  if (!showWalletPicker) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Wallet selection modal"
    >
      <div
        ref={modalRef}
        className="w-full max-w-[420px] rounded-2xl border border-white/15 bg-[#0f1116] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
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

        {error ? <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

        {isConnecting && clickedWallet ? (
          <div className="mb-4 flex items-center gap-2 text-xs text-[#9CA3AF]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#00FFC8]/30 border-t-[#00FFC8]" />
            Connecting to {availableWallets.find((wallet) => wallet.info.uuid === clickedWallet)?.info.name ?? "wallet"}...
          </div>
        ) : null}

        {sortedWallets.length > 0 ? (
          <div className="space-y-2">
            {sortedWallets.map((wallet) => (
              <WalletRow
                key={wallet.info.uuid}
                wallet={wallet}
                isConnecting={isConnecting}
                onConnect={() => {
                  setClickedWallet(wallet.info.uuid);
                  void connectWallet(wallet);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
            <p className="font-medium text-[#EAEAF0]">No wallets detected</p>
            <p>Install a wallet extension and refresh this page.</p>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#8FD9FF] hover:border-[#8FD9FF]/40"
              >
                Install MetaMask
              </a>
              <a
                href="https://www.coinbase.com/wallet/downloads"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#8FD9FF] hover:border-[#8FD9FF]/40"
              >
                Install Coinbase Wallet
              </a>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-center text-[11px] leading-relaxed text-[#9CA3AF]">
            By connecting you agree to the platform terms. Your wallet address becomes your on-chain identity.
          </p>
        </div>
      </div>
    </div>
  );
}
