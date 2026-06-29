/**
 * One contract, two implementations:
 *  - injectedProvider → EIP-1193 browser wallet (MetaMask et al.) via
 *                       ethers.BrowserProvider(window.ethereum)
 *  - privyProvider    → @privy-io/react-auth embedded EVM wallet, whose
 *                       EIP-1193 provider is wrapped in a BrowserProvider
 *
 * walletStore.kind picks which one is active. Components call
 * getActiveProvider() in lib/wallet.ts and use the returned WalletProvider.
 * No call site imports either implementation directly — that's how Game.tsx
 * stays provider-agnostic.
 *
 * Players self-submit transactions on EVM: instead of returning a signed
 * envelope for the backend to broadcast, a provider hands back an
 * ethers.Signer the caller uses to send the tx directly to the chain.
 */
import type { Signer } from "ethers";

export type WalletKind = "none" | "injected" | "privy" | "walletconnect";

export interface WalletProvider {
  readonly kind: Exclude<WalletKind, "none">;
  /** The connected 0x EVM address. */
  getAddress(): Promise<string>;
  /** An ethers Signer bound to the active wallet, on Sepolia. */
  getSigner(): Promise<Signer>;
  disconnect(): Promise<void>;
}
