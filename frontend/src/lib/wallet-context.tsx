"use client";

import { BrowserProvider, JsonRpcSigner } from "ethers";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { expectedChainId } from "@/lib/contracts";
import { getChainConfig } from "@/lib/network-config";
import {
  EIP6963ProviderDetail,
  EIP1193Provider,
  getLegacyProvider,
  getLegacyProviders,
  onWalletAnnounced,
  requestWallets
} from "@/lib/wallet-discovery";

type WalletContextType = {
  address: string | null;
  account: string | null;
  provider: BrowserProvider | null;
  browserProvider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  availableWallets: EIP6963ProviderDetail[];
  showWalletPicker: boolean;
  openWalletPicker: () => void;
  closeWalletPicker: () => void;
  connectWallet: (walletDetail: EIP6963ProviderDetail) => Promise<BrowserProvider | null>;
  connect: () => Promise<BrowserProvider | null>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextType>({
  address: null,
  account: null,
  provider: null,
  browserProvider: null,
  signer: null,
  chainId: null,
  isConnecting: false,
  isConnected: false,
  error: null,
  availableWallets: [],
  showWalletPicker: false,
  openWalletPicker: () => undefined,
  closeWalletPicker: () => undefined,
  connectWallet: async () => null,
  connect: async () => null,
  disconnect: () => undefined
});

const LAST_WALLET_KEY = "archon.last_wallet_uuid";

function isMissingChainError(error: unknown) {
  const candidate = error as { code?: number; message?: string };
  return candidate?.code === 4902 || String(candidate?.message ?? "").toLowerCase().includes("unrecognized chain");
}

async function ensureExpectedNetwork(provider: EIP1193Provider) {
  const chainConfig = getChainConfig(expectedChainId);

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainId }]
    });
  } catch (error) {
    if (!isMissingChainError(error)) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [chainConfig]
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainId }]
    });
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [activeWallet, setActiveWallet] = useState<EIP6963ProviderDetail | null>(null);
  const walletsRef = useRef<EIP6963ProviderDetail[]>([]);

  const setWalletList = useCallback((list: EIP6963ProviderDetail[]) => {
    walletsRef.current = list;
    setAvailableWallets(list);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return () => undefined;

    const seen = new Set<string>();
    const discovered: EIP6963ProviderDetail[] = [];

    const addWallet = (detail: EIP6963ProviderDetail) => {
      const key = detail.info.uuid || detail.info.rdns || detail.info.name;
      if (!key || seen.has(key)) return;
      seen.add(key);
      discovered.push(detail);
      setWalletList([...discovered]);
    };

    const cleanup = onWalletAnnounced(addWallet);

    const legacyProviders = getLegacyProviders();
    for (const detail of legacyProviders) {
      addWallet(detail);
    }
    if (legacyProviders.length === 0) {
      const legacy = getLegacyProvider();
      if (legacy) addWallet(legacy);
    }

    requestWallets();

    return cleanup;
  }, [setWalletList]);

  const hydrateProviderState = useCallback(async (walletDetail: EIP6963ProviderDetail) => {
    const browserProvider = new BrowserProvider(walletDetail.provider as never);
    const nextSigner = await browserProvider.getSigner();
    const nextAddress = await nextSigner.getAddress();
    const network = await browserProvider.getNetwork();

    setProvider(browserProvider);
    setSigner(nextSigner);
    setAddress(nextAddress);
    setChainId(Number(network.chainId));
    setActiveWallet(walletDetail);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_WALLET_KEY, walletDetail.info.uuid);
    }

    return browserProvider;
  }, []);

  const connectWallet = useCallback(
    async (walletDetail: EIP6963ProviderDetail) => {
      setIsConnecting(true);
      setError(null);
      setShowWalletPicker(false);

      try {
        await walletDetail.provider.request({ method: "eth_requestAccounts" });
        await ensureExpectedNetwork(walletDetail.provider);
        return await hydrateProviderState(walletDetail);
      } catch (connectError) {
        const message = connectError instanceof Error ? connectError.message : "Connection failed";
        setError(message);
        return null;
      } finally {
        setIsConnecting(false);
      }
    },
    [hydrateProviderState]
  );

  const connect = useCallback(async () => {
    const wallets = walletsRef.current;
    if (wallets.length === 0) {
      requestWallets();
      setError("No EVM wallet detected. Install MetaMask, Coinbase Wallet, Rabby, Rainbow, Trust Wallet, or another EVM wallet.");
      setShowWalletPicker(true);
      return null;
    }

    let selected = wallets[0];
    if (typeof window !== "undefined") {
      const remembered = window.localStorage.getItem(LAST_WALLET_KEY);
      const matched = wallets.find((wallet) => wallet.info.uuid === remembered);
      if (matched) selected = matched;
    }

    return connectWallet(selected);
  }, [connectWallet]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setActiveWallet(null);
  }, []);

  useEffect(() => {
    let active = true;

    const restore = async () => {
      const wallets = walletsRef.current;
      if (wallets.length === 0) return;

      let selected: EIP6963ProviderDetail | undefined;
      if (typeof window !== "undefined") {
        const remembered = window.localStorage.getItem(LAST_WALLET_KEY);
        selected = wallets.find((wallet) => wallet.info.uuid === remembered);
      }
      selected = selected ?? wallets[0];

      try {
        const browserProvider = new BrowserProvider(selected.provider as never);
        const accounts = (await selected.provider.request({ method: "eth_accounts" })) as string[];
        if (!active || !accounts?.length) return;

        const nextSigner = await browserProvider.getSigner();
        const network = await browserProvider.getNetwork();

        if (!active) return;
        setProvider(browserProvider);
        setSigner(nextSigner);
        setAddress(accounts[0]);
        setChainId(Number(network.chainId));
        setActiveWallet(selected);
      } catch {
        if (!active) return;
        setProvider(null);
        setSigner(null);
        setAddress(null);
        setChainId(null);
        setActiveWallet(null);
      }
    };

    void restore();

    return () => {
      active = false;
    };
  }, [availableWallets]);

  useEffect(() => {
    const activeProvider = activeWallet?.provider;
    if (!activeProvider?.on || !activeProvider.removeListener) {
      return () => undefined;
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0])
        ? args[0].filter((value): value is string => typeof value === "string")
        : [];
      if (accounts.length === 0) {
        disconnect();
        return;
      }
      setAddress(accounts[0]);
    };

    const handleChainChanged = (...args: unknown[]) => {
      const hexChainId = typeof args[0] === "string" ? args[0] : "";
      const parsed = Number.parseInt(hexChainId, 16);
      setChainId(Number.isNaN(parsed) ? null : parsed);
    };

    activeProvider.on("accountsChanged", handleAccountsChanged);
    activeProvider.on("chainChanged", handleChainChanged);

    return () => {
      activeProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      activeProvider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [activeWallet, disconnect]);

  const openWalletPicker = useCallback(() => {
    requestWallets();
    setShowWalletPicker(true);
    setError(null);
  }, []);

  const closeWalletPicker = useCallback(() => {
    setShowWalletPicker(false);
  }, []);

  const value = useMemo<WalletContextType>(
    () => ({
      address,
      account: address,
      provider,
      browserProvider: provider,
      signer,
      chainId,
      isConnecting,
      isConnected: !!address,
      error,
      availableWallets,
      showWalletPicker,
      openWalletPicker,
      closeWalletPicker,
      connectWallet,
      connect,
      disconnect
    }),
    [
      address,
      provider,
      signer,
      chainId,
      isConnecting,
      error,
      availableWallets,
      showWalletPicker,
      openWalletPicker,
      closeWalletPicker,
      connectWallet,
      connect,
      disconnect
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}
