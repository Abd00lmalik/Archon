"use client";

import { ethers } from "ethers";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type WalletContextValue = {
  account: string | null;
  chainId: number | null;
  browserProvider: ethers.BrowserProvider | null;
  connect: () => Promise<ethers.BrowserProvider | null>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

async function buildWalletState(ethereum: NonNullable<Window["ethereum"]>) {
  const browserProvider = new ethers.BrowserProvider(ethereum);
  const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[] | undefined;
  const network = await browserProvider.getNetwork();

  return {
    browserProvider,
    account: accounts && accounts.length > 0 ? accounts[0] : null,
    chainId: Number(network.chainId)
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [browserProvider, setBrowserProvider] = useState<ethers.BrowserProvider | null>(null);

  const connect = async () => {
    if (!window.ethereum) {
      throw new Error("No wallet found. Install MetaMask or another injected wallet.");
    }

    await window.ethereum.request({ method: "eth_requestAccounts" });
    const walletState = await buildWalletState(window.ethereum);
    setBrowserProvider(walletState.browserProvider);
    setAccount(walletState.account);
    setChainId(walletState.chainId);
    return walletState.browserProvider;
  };

  const disconnect = () => {
    setAccount(null);
    setChainId(null);
    setBrowserProvider(null);
  };

  useEffect(() => {
    if (!window.ethereum) {
      return;
    }

    void buildWalletState(window.ethereum)
      .then((walletState) => {
        setBrowserProvider(walletState.browserProvider);
        setAccount(walletState.account);
        setChainId(walletState.chainId);
      })
      .catch(() => {
        setBrowserProvider(null);
        setAccount(null);
        setChainId(null);
      });

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0])
        ? args[0].filter((item): item is string => typeof item === "string")
        : [];
      setAccount(accounts.length > 0 ? accounts[0] : null);
    };

    const handleChainChanged = (...args: unknown[]) => {
      const chainHex = typeof args[0] === "string" ? args[0] : "";
      const parsed = Number.parseInt(chainHex, 16);
      setChainId(Number.isNaN(parsed) ? null : parsed);
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      chainId,
      browserProvider,
      connect,
      disconnect
    }),
    [account, chainId, browserProvider]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}
