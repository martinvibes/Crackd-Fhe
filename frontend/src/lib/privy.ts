/**
 * Privy embedded EVM wallet adapter.
 *
 * Privy supports Ethereum embedded wallets natively. The embedded wallet
 * exposes a standard EIP-1193 provider via `wallet.getEthereumProvider()`
 * (from useWallets). We wrap that in an ethers BrowserProvider so the rest
 * of the app gets the same Signer interface as the injected path.
 *
 * Module-level state populated by <PrivyWalletBridge /> (rendered inside
 * <PrivyProvider> in main.tsx). The bridge reads React hook state and writes
 * here so non-React callers (Game.tsx → getActiveProvider() → getSigner)
 * can reach the active wallet synchronously.
 */
import { BrowserProvider, type Signer } from "ethers";
import type { WalletProvider } from "./walletProvider";
import type { Eip1193Provider } from "ethers";

interface PrivyState {
  address: string;
  /** Resolve the embedded wallet's EIP-1193 provider. */
  getEthereumProvider: () => Promise<Eip1193Provider>;
  logout: () => Promise<void>;
}

let state: PrivyState | null = null;

/** Called by <PrivyWalletBridge /> when the embedded EVM wallet is
 *  available, and again with null on logout. */
export function setPrivyState(next: PrivyState | null): void {
  state = next;
}

export const privyProvider: WalletProvider = {
  kind: "privy",

  async getAddress() {
    if (!state) throw new Error("Privy wallet not ready");
    return state.address;
  },

  async getSigner(): Promise<Signer> {
    if (!state) throw new Error("Privy wallet not ready");
    const eip1193 = await state.getEthereumProvider();
    const provider = new BrowserProvider(eip1193);
    return provider.getSigner();
  },

  async disconnect() {
    const logout = state?.logout;
    state = null;
    if (logout) await logout();
  },
};
