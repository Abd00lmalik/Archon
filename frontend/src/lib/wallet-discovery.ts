export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export interface EIP6963AnnounceProviderEvent extends CustomEvent {
  detail: EIP6963ProviderDetail;
}

export type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  providers?: EIP1193Provider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
};

export function requestWallets(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function onWalletAnnounced(callback: (detail: EIP6963ProviderDetail) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const announced = event as EIP6963AnnounceProviderEvent;
    if (!announced.detail?.provider) return;
    callback(announced.detail);
  };
  window.addEventListener("eip6963:announceProvider", handler);
  return () => window.removeEventListener("eip6963:announceProvider", handler);
}

export function getLegacyProvider(): EIP6963ProviderDetail | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) return null;

  return {
    info: {
      uuid: "legacy-injected",
      name: eth.isMetaMask
        ? "MetaMask"
        : eth.isCoinbaseWallet
          ? "Coinbase Wallet"
          : eth.isRabby
            ? "Rabby"
            : "Injected Wallet",
      icon: "",
      rdns: eth.isMetaMask ? "io.metamask" : eth.isCoinbaseWallet ? "com.coinbase.wallet" : "injected"
    },
    provider: eth
  };
}

export function getLegacyProviders(): EIP6963ProviderDetail[] {
  if (typeof window === "undefined") return [];
  const root = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!root) return [];

  const candidates = Array.isArray(root.providers) && root.providers.length > 0 ? root.providers : [root];
  const details: EIP6963ProviderDetail[] = [];

  for (let index = 0; index < candidates.length; index++) {
    const provider = candidates[index];
    const fallback = {
      info: {
        uuid: `legacy-${index}`,
        name: provider.isMetaMask
          ? "MetaMask"
          : provider.isCoinbaseWallet
            ? "Coinbase Wallet"
            : provider.isRabby
              ? "Rabby"
              : `Injected Wallet ${index + 1}`,
        icon: "",
        rdns: provider.isMetaMask
          ? "io.metamask"
          : provider.isCoinbaseWallet
            ? "com.coinbase.wallet"
            : "injected"
      },
      provider
    } satisfies EIP6963ProviderDetail;
    details.push(fallback);
  }

  return details;
}
