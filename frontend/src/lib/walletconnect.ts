/**
 * WalletConnect path — opens a QR / deep-link modal so users can connect
 * hundreds of mobile and desktop wallets (Trust, Rainbow, MetaMask mobile,
 * Ledger Live, etc.) that aren't installed as a browser extension.
 *
 * Gated on VITE_WALLETCONNECT_PROJECT_ID (a free id from
 * https://cloud.reown.com — formerly WalletConnect Cloud). When it's unset the
 * option is simply hidden; everything else still works.
 *
 * The @walletconnect/ethereum-provider package is lazy-imported so it never
 * bloats the initial bundle.
 */
import { BrowserProvider, type Signer, type Eip1193Provider } from "ethers";
import type { WalletProvider } from "./walletProvider";

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
export const walletConnectEnabled = !!WC_PROJECT_ID;

const CHAIN_ID = Number(import.meta.env.VITE_EVM_CHAIN_ID ?? 11155111);
const RPC_URL = import.meta.env.VITE_EVM_RPC_URL as string;

type WcProvider = Eip1193Provider & {
  enable: () => Promise<string[]>;
  disconnect: () => Promise<void>;
  accounts: string[];
};

let wc: WcProvider | null = null;

async function initProvider(): Promise<WcProvider> {
  if (wc) return wc;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wc = (await EthereumProvider.init({
    projectId: WC_PROJECT_ID as string,
    chains: [CHAIN_ID],
    optionalChains: [CHAIN_ID],
    showQrModal: true,
    rpcMap: { [CHAIN_ID]: RPC_URL },
    metadata: {
      name: "Crackd Confidential",
      description: "Confidential code-breaking on Zama fhEVM",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons:
        typeof window !== "undefined"
          ? [`${window.location.origin}/crackd-logo.png`]
          : [],
    },
  })) as unknown as WcProvider;
  return wc;
}

/** Open the WalletConnect modal and connect. Returns the 0x address. */
export async function connectWalletConnect(): Promise<string> {
  const p = await initProvider();
  await p.enable(); // shows the QR / wallet-picker modal
  const addr = p.accounts?.[0];
  if (!addr) throw new Error("WalletConnect: no account returned.");
  return addr;
}

/** Re-attach to a persisted WalletConnect session after a reload, if any. */
export async function restoreWalletConnect(): Promise<string | null> {
  if (!walletConnectEnabled) return null;
  const p = await initProvider();
  return p.accounts?.[0] ?? null;
}

export const walletConnectProvider: WalletProvider = {
  kind: "walletconnect",
  async getAddress() {
    const p = await initProvider();
    const addr = p.accounts?.[0];
    if (!addr) throw new Error("WalletConnect not connected.");
    return addr;
  },
  async getSigner(): Promise<Signer> {
    const p = await initProvider();
    return new BrowserProvider(p as Eip1193Provider).getSigner();
  },
  async disconnect() {
    if (wc) {
      try {
        await wc.disconnect();
      } catch {
        // session may already be gone
      }
    }
    wc = null;
  },
};
