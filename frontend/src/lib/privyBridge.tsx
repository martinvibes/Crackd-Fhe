/**
 * Bridge between Privy's React state and the module-level singleton in
 * lib/privy.ts. Renders nothing.
 *
 * Responsibilities on every Privy state change:
 *   - If logged in but no embedded EVM wallet exists → create one.
 *   - Once an embedded wallet is present → mirror its address +
 *     getEthereumProvider into lib/privy.ts so non-React callers
 *     (Game.tsx → getActiveProvider → getSigner) reach it synchronously.
 *   - Set walletStore { kind: "privy", address }.
 *   - On logout: clear lib/privy.ts state and (if walletStore says we're
 *     the active kind) reset walletStore.
 */
import { useEffect, useRef } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { setPrivyState } from "./privy";
import { useWalletStore } from "../store/walletStore";

export function PrivyWalletBridge() {
  const { authenticated, ready, logout } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const setWallet = useWalletStore((s) => s.setWallet);
  const disconnect = useWalletStore((s) => s.disconnect);
  // Guard so we don't double-create wallets.
  const creatingRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    // Logged out → tear down.
    if (!authenticated) {
      setPrivyState(null);
      if (useWalletStore.getState().kind === "privy") {
        void disconnect();
      }
      creatingRef.current = false;
      return;
    }

    // Find the user's embedded EVM wallet, if any.
    const embedded = wallets.find((w) => w.walletClientType === "privy");

    if (!embedded) {
      // No embedded wallet yet — create one.
      if (creatingRef.current) return;
      creatingRef.current = true;
      void createWallet().catch((err) => {
        console.error("[privy] createWallet failed:", err);
        creatingRef.current = false;
      });
      return;
    }

    // Embedded wallet ready — wire it up.
    setPrivyState({
      address: embedded.address,
      getEthereumProvider: () => embedded.getEthereumProvider(),
      logout: async () => {
        await logout();
      },
    });
    setWallet(embedded.address, "privy");
  }, [ready, authenticated, wallets, createWallet, setWallet, disconnect, logout]);

  return null;
}
