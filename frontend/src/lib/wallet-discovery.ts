"use client";

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  providers?: WalletProvider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isOKExWallet?: boolean;
  isBraveWallet?: boolean;
  isPhantom?: boolean;
  icon?: string;
};

export interface DetectedWallet {
  info: WalletInfo;
  provider: WalletProvider;
}

type AnnounceDetail = {
  info?: Partial<WalletInfo>;
  provider?: WalletProvider;
};

const _detected = new Map<string, DetectedWallet>();
const _listeners: Array<(wallets: DetectedWallet[]) => void> = [];
let _initialized = false;
let _legacyTimer: ReturnType<typeof setTimeout> | null = null;

function _notify() {
  const list = Array.from(_detected.values());
  _listeners.forEach((listener) => listener(list));
}

function hasRequest(provider: unknown): provider is WalletProvider {
  return Boolean(provider) && typeof (provider as WalletProvider).request === "function";
}

function isLegacyUuid(uuid: string): boolean {
  return uuid.startsWith("legacy-");
}

function normalizedIdentity(info: WalletInfo): string {
  const rdns = (info.rdns ?? "").trim().toLowerCase();
  const name = (info.name ?? "").trim().toLowerCase();
  if (rdns && rdns !== "injected") return rdns;
  return name;
}

function sanitizeInfo(rawInfo: Partial<WalletInfo>): WalletInfo {
  const fallbackName = rawInfo.name?.trim() || "Injected Wallet";
  const sanitizedName = fallbackName.length > 0 ? fallbackName : "Injected Wallet";
  const sanitizedRdns = rawInfo.rdns?.trim() || "injected";
  const fallbackUuid = `${sanitizedRdns || "wallet"}-${sanitizedName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return {
    uuid: (rawInfo.uuid?.trim() || fallbackUuid || "wallet-unknown").toLowerCase(),
    name: sanitizedName,
    icon: typeof rawInfo.icon === "string" ? rawInfo.icon : "",
    rdns: sanitizedRdns
  };
}

function addDetectedWallet(input: DetectedWallet) {
  if (!hasRequest(input.provider)) return;

  const info = sanitizeInfo(input.info);
  const provider = input.provider;

  for (const [key, existing] of _detected.entries()) {
    if (existing.provider === provider) {
      const replaceLegacyWithEip = isLegacyUuid(existing.info.uuid) && !isLegacyUuid(info.uuid);
      const shouldUpdateIcon = !existing.info.icon && !!info.icon;
      const shouldUpdateRdns = (existing.info.rdns === "injected" || existing.info.rdns === "") && !!info.rdns;

      if (replaceLegacyWithEip || shouldUpdateIcon || shouldUpdateRdns) {
        _detected.set(key, { info: { ...existing.info, ...info }, provider });
        _notify();
      }
      return;
    }
  }

  const incomingIdentity = normalizedIdentity(info);
  if (incomingIdentity) {
    for (const [key, existing] of _detected.entries()) {
      const existingIdentity = normalizedIdentity(existing.info);
      if (existingIdentity !== incomingIdentity) continue;

      const replaceLegacyWithEip = isLegacyUuid(existing.info.uuid) && !isLegacyUuid(info.uuid);
      if (replaceLegacyWithEip) {
        _detected.delete(key);
        break;
      }

      const mergeIcon = !existing.info.icon && !!info.icon;
      if (mergeIcon) {
        _detected.set(key, { info: { ...existing.info, ...info }, provider: existing.provider });
        _notify();
      }
      return;
    }
  }

  if (_detected.has(info.uuid)) {
    const current = _detected.get(info.uuid);
    if (current && !current.info.icon && info.icon) {
      _detected.set(info.uuid, { info: { ...current.info, icon: info.icon }, provider: current.provider });
      _notify();
    }
    return;
  }

  _detected.set(info.uuid, { info, provider });
  _notify();
}

function getLegacyName(provider: WalletProvider): string {
  if (provider.isMetaMask && !provider.isRabby) return "MetaMask";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isRabby) return "Rabby";
  if (provider.isTrust || provider.isTrustWallet) return "Trust Wallet";
  if (provider.isOKExWallet) return "OKX Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isPhantom) return "Phantom";
  return "Injected Wallet";
}

function getLegacyRdns(provider: WalletProvider, name: string): string {
  if (provider.isMetaMask && !provider.isRabby) return "io.metamask";
  if (provider.isCoinbaseWallet) return "com.coinbase.wallet";
  if (provider.isRabby) return "io.rabby";
  if (provider.isTrust || provider.isTrustWallet) return "com.trustwallet";
  if (provider.isOKExWallet) return "com.okx.wallet";
  if (provider.isBraveWallet) return "com.brave.wallet";
  if (provider.isPhantom) return "app.phantom";
  return `legacy.${name.toLowerCase().replace(/\s+/g, "-")}`;
}

export function requestWallets() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function initWalletDiscovery() {
  if (typeof window === "undefined" || _initialized) return;
  _initialized = true;

  const announceHandler = (event: Event) => {
    const detail = (event as CustomEvent<AnnounceDetail>).detail;
    if (!detail?.provider) return;

    addDetectedWallet({
      info: {
        uuid: detail.info?.uuid || "",
        name: detail.info?.name || "Injected Wallet",
        icon: typeof detail.info?.icon === "string" ? detail.info.icon : "",
        rdns: detail.info?.rdns || ""
      },
      provider: detail.provider
    });
  };

  window.addEventListener("eip6963:announceProvider", announceHandler as EventListener);

  requestWallets();

  if (_legacyTimer) {
    clearTimeout(_legacyTimer);
  }

  _legacyTimer = setTimeout(() => {
    const ethereum = (window as unknown as { ethereum?: WalletProvider }).ethereum;
    if (!ethereum) return;

    const providers = Array.isArray(ethereum.providers) && ethereum.providers.length > 0 ? ethereum.providers : [ethereum];

    providers.forEach((provider, index) => {
      if (!hasRequest(provider)) return;

      const name = getLegacyName(provider);
      const rdns = getLegacyRdns(provider, name);
      const uuid = `legacy-${rdns.replace(/[^a-z0-9.\-]/gi, "-").toLowerCase()}-${index}`;

      addDetectedWallet({
        info: {
          uuid,
          name,
          icon: typeof provider.icon === "string" ? provider.icon : "",
          rdns
        },
        provider
      });
    });
  }, 150);
}

export function onWalletsChanged(fn: (wallets: DetectedWallet[]) => void): () => void {
  _listeners.push(fn);
  fn(Array.from(_detected.values()));
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

export function getDetectedWallets(): DetectedWallet[] {
  return Array.from(_detected.values());
}
