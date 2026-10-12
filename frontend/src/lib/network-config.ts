export type AddChainParams = {
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

export function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

export function getChainConfig(chainId: number): AddChainParams {
  if (chainId === 5042) {
    return {
      chainId: toHexChainId(chainId),
      chainName: "Arc Mainnet",
      nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 18
      },
      rpcUrls: ["https://rpc.mainnet.arc.io"],
      blockExplorerUrls: ["https://explorer.arc.io"]
    };
  }

  if (chainId === 5042002) {
    return {
      chainId: toHexChainId(chainId),
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
    chainId: toHexChainId(31337),
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

