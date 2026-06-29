/**
 * Live wallet balance — native ETH + configured ERC20 assets (WETH, USDC) —
 * read over the EVM JSON-RPC via ethers.
 *
 * React-Query owns the cache + polling cadence. We refetch every 30s while
 * the user is on a wallet-aware page and on focus, so the pill always
 * reflects reality after a stake/payout.
 */
import { useQuery } from "@tanstack/react-query";
import { Contract, JsonRpcProvider, formatEther, formatUnits } from "ethers";

const RPC_URL = import.meta.env.VITE_EVM_RPC_URL as string;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

interface AssetSpec {
  symbol: string;
  address: string;
}

const ASSETS: AssetSpec[] = [
  { symbol: "WETH", address: import.meta.env.VITE_WETH_ADDRESS as string },
  { symbol: "USDC", address: import.meta.env.VITE_USDC_ADDRESS as string },
];

export interface WalletBalance {
  asset: string;
  amount: number;
  isNative: boolean;
}

let provider: JsonRpcProvider | null = null;
function rpc(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(RPC_URL);
  return provider;
}

async function fetchBalances(address: string): Promise<WalletBalance[]> {
  const out: WalletBalance[] = [];

  // Native ETH.
  try {
    const wei = await rpc().getBalance(address);
    out.push({ asset: "ETH", amount: Number(formatEther(wei)), isNative: true });
  } catch {
    out.push({ asset: "ETH", amount: 0, isNative: true });
  }

  // ERC20 assets.
  for (const a of ASSETS) {
    if (!a.address) continue;
    try {
      const erc20 = new Contract(a.address, ERC20_ABI, rpc());
      const [raw, decimals] = await Promise.all([
        erc20.balanceOf(address) as Promise<bigint>,
        erc20.decimals() as Promise<bigint>,
      ]);
      out.push({
        asset: a.symbol,
        amount: Number(formatUnits(raw, decimals)),
        isNative: false,
      });
    } catch {
      out.push({ asset: a.symbol, amount: 0, isNative: false });
    }
  }

  return out;
}

export function useBalances(address: string | null) {
  return useQuery<WalletBalance[]>({
    queryKey: ["balances", address],
    queryFn: () => fetchBalances(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
