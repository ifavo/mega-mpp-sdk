import { defineChain } from "viem";

export const MEGAETH_MAINNET_CHAIN_ID = 4326;
export const MEGAETH_TESTNET_CHAIN_ID = 6343;
export const MAX_SPLITS = 8;
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const DEFAULT_RPC_URLS = {
  [MEGAETH_MAINNET_CHAIN_ID]: "https://mainnet.megaeth.com/rpc",
  [MEGAETH_TESTNET_CHAIN_ID]: "https://carrot.megaeth.com/rpc",
} as const;
export const DEFAULT_WS_URLS = {
  [MEGAETH_MAINNET_CHAIN_ID]: "wss://mainnet.megaeth.com/ws",
  [MEGAETH_TESTNET_CHAIN_ID]: "wss://carrot.megaeth.com/ws",
} as const;

export const megaeth = defineChain({
  id: MEGAETH_MAINNET_CHAIN_ID,
  name: "MegaETH",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [DEFAULT_RPC_URLS[MEGAETH_MAINNET_CHAIN_ID]],
      webSocket: [DEFAULT_WS_URLS[MEGAETH_MAINNET_CHAIN_ID]],
    },
  },
  blockExplorers: {
    default: {
      name: "MegaETH Explorer",
      url: "https://mega.etherscan.io",
    },
  },
});

export const megaethTestnet = defineChain({
  id: MEGAETH_TESTNET_CHAIN_ID,
  name: "MegaETH Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [DEFAULT_RPC_URLS[MEGAETH_TESTNET_CHAIN_ID]],
      webSocket: [DEFAULT_WS_URLS[MEGAETH_TESTNET_CHAIN_ID]],
    },
  },
  blockExplorers: {
    default: {
      name: "MegaETH Testnet Explorer",
      url: "https://megaeth-testnet-v2.blockscout.com",
    },
  },
});

export const DEFAULT_CHAINS = {
  [MEGAETH_MAINNET_CHAIN_ID]: megaeth,
  [MEGAETH_TESTNET_CHAIN_ID]: megaethTestnet,
} as const;

export const DEFAULT_USDM = {
  address: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  decimals: 18,
  symbol: "USDm",
} as const;

export const TESTNET_USDC = {
  address: "0x75139a9559c9cd1ad69b7e239c216151d2c81e6f",
  decimals: 6,
  symbol: "USDC",
} as const;
