/**
 * Asset registry — maps short symbols (WETH, USDC) to their on-chain ERC-20
 * token addresses (0x…). One source of truth for the backend; routes and the
 * Zama service both read from here.
 *
 * Adding a new asset = add an env var + add a row below + redeploy the
 * backend. Contract code doesn't change (already multi-asset).
 */
import type { AppConfig } from "../config.js";

export type AssetSymbol = string;

export interface Asset {
  symbol: AssetSymbol;
  address: string;      // ERC-20 token contract address (0x…)
  decimals: number;
  displayName: string;
  isNative: boolean;
}

export interface AssetRegistry {
  list(): Asset[];
  get(symbol: AssetSymbol): Asset;
  getByAddress(address: string): Asset | undefined;
  isSupported(symbol: AssetSymbol): boolean;
}

export function buildAssetRegistry(cfg: AppConfig): AssetRegistry {
  const supported = cfg.SUPPORTED_ASSETS.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const all: Record<string, Asset> = {
    WETH: {
      symbol: "WETH",
      address: cfg.WETH_ADDRESS,
      decimals: 18,
      displayName: "Wrapped Ether",
      isNative: true,
    },
    USDC: {
      symbol: "USDC",
      address: cfg.USDC_ADDRESS,
      decimals: 6,
      displayName: "USD Coin",
      isNative: false,
    },
  };

  const enabled: Asset[] = [];
  for (const sym of supported) {
    const a = all[sym];
    if (!a) throw new Error(`SUPPORTED_ASSETS references unknown symbol: ${sym}`);
    enabled.push(a);
  }
  const bySymbol = new Map(enabled.map((a) => [a.symbol, a]));
  // Index addresses lowercased so lookups are case-insensitive.
  const byAddress = new Map(
    enabled.map((a) => [a.address.toLowerCase(), a]),
  );

  return {
    list: () => enabled.slice(),
    get(symbol) {
      const a = bySymbol.get(symbol.toUpperCase());
      if (!a) throw new Error(`Unsupported asset: ${symbol}`);
      return a;
    },
    getByAddress: (address) => byAddress.get(address.toLowerCase()),
    isSupported: (symbol) => bySymbol.has(symbol.toUpperCase()),
  };
}
