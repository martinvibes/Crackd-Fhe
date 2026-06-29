/**
 * Wallet state. Kept separate from game state because they have
 * different lifecycles — wallet persists across games, game state
 * belongs to a single session.
 *
 * `kind` selects which underlying provider is active:
 *  - "injected" → EIP-1193 browser wallet (MetaMask et al.)
 *  - "privy"    → @privy-io/react-auth embedded EVM wallet
 *  - "none"     → not connected
 *
 * `address` is a 0x EVM address.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  connectInjectedWallet,
  getActiveProvider,
  type DiscoveredWallet,
} from "../lib/wallet";
import type { WalletKind } from "../lib/walletProvider";

interface WalletState {
  address: string | null;
  kind: WalletKind;
  connecting: boolean;
  /** Connect a chosen injected wallet. Privy callers use setWallet() directly. */
  connectInjected: (wallet: DiscoveredWallet) => Promise<void>;
  /** Connect via WalletConnect (QR / mobile wallets). */
  connectWalletConnect: () => Promise<void>;
  setWallet: (address: string, kind: Exclude<WalletKind, "none">) => void;
  disconnect: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      address: null,
      kind: "none",
      connecting: false,
      connectInjected: async (wallet) => {
        if (get().connecting) return;
        set({ connecting: true });
        try {
          const address = await connectInjectedWallet(wallet);
          set({ address, kind: "injected", connecting: false });
        } catch (err) {
          set({ connecting: false });
          throw err;
        }
      },
      connectWalletConnect: async () => {
        if (get().connecting) return;
        set({ connecting: true });
        try {
          const { connectWalletConnect } = await import("../lib/walletconnect");
          const address = await connectWalletConnect();
          set({ address, kind: "walletconnect", connecting: false });
        } catch (err) {
          set({ connecting: false });
          throw err;
        }
      },
      setWallet: (address, kind) => {
        set({ address, kind });
      },
      disconnect: async () => {
        try {
          const provider = await getActiveProvider();
          await provider.disconnect();
        } catch {
          // Best-effort — injected wallets have no disconnect, the Privy
          // session may already be cleared, or getActiveProvider may have
          // returned the wrong one if the store is mid-state-change.
        }
        set({ address: null, kind: "none" });
      },
      restore: async () => {
        const addr = get().address;
        const kind = get().kind;
        if (!addr || kind === "none") return;
        if (kind === "injected") {
          try {
            const provider = await getActiveProvider();
            const address = await provider.getAddress();
            if (address && address !== addr) set({ address });
          } catch {
            set({ address: null, kind: "none" });
          }
        }
        if (kind === "walletconnect") {
          try {
            const { restoreWalletConnect } = await import(
              "../lib/walletconnect"
            );
            const address = await restoreWalletConnect();
            if (address) set({ address });
            else set({ address: null, kind: "none" });
          } catch {
            set({ address: null, kind: "none" });
          }
        }
        // For "privy", PrivyWalletBridge populates the store on its own
        // when the SDK rehydrates the session — nothing to do here.
      },
    }),
    {
      name: "crackd-wallet",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ address: s.address, kind: s.kind }),
    },
  ),
);
