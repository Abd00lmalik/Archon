"use client";

import { useMemo, useState } from "react";
import { expectedChainId } from "@/lib/contracts";

type AddChainParams = {
  chainId: string;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
};

function getChainConfig(chainId: number): AddChainParams {
  if (chainId === 5042002) {
    return {
      chainId: "0x4CEF52",
      chainName: "Arc Testnet",
      nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 18
      },
      rpcUrls: ["https://rpc.testnet.arc.network"],
      blockExplorerUrls: ["https://testnet.arcscan.app"]
    };
  }

  return {
    chainId: "0x7A69",
    chainName: "Hardhat Local",
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: ["http://127.0.0.1:8545"],
    blockExplorerUrls: []
  };
}

export function WrongNetworkBanner({ isWrongNetwork }: { isWrongNetwork: boolean }) {
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState("");

  const chainConfig = useMemo(() => getChainConfig(expectedChainId), []);

  if (!isWrongNetwork) {
    return null;
  }

  const handleSwitch = async () => {
    if (!window.ethereum) {
      setMessage("No injected wallet detected.");
      return;
    }

    setSwitching(true);
    setMessage("");

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainConfig.chainId }]
      });
      setMessage("Network switched.");
    } catch (error) {
      const walletError = error as { code?: number; message?: string };
      if (walletError.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [chainConfig]
        });
        setMessage("Network added.");
      } else {
        setMessage(walletError.message ?? "Unable to switch network.");
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="border-b border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#EAEAF0]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <span className="text-[#9CA3AF]">
          Wrong network detected. Switch to {chainConfig.chainName} (Chain {expectedChainId}).
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSwitch()}
            disabled={switching}
            className="archon-button-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {switching ? "Switching..." : "Switch Network"}
          </button>
          {message ? <span className="text-xs text-[#00D1B2]">{message}</span> : null}
        </div>
      </div>
    </div>
  );
}
