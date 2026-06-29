/**
 * Injected EVM wallet path with EIP-6963 multi-wallet discovery.
 *
 * Modern wallets announce themselves via the `eip6963:announceProvider` event,
 * so instead of blindly grabbing `window.ethereum` (which breaks when several
 * wallets are installed) we discover every injected provider and let the user
 * pick. The chosen provider is remembered (in memory + by rdns in localStorage)
 * so `getSigner()` keeps using the *same* wallet across the session and reloads.
 *
 * Exposes wallet discovery, a `connectInjectedWallet()` that connects a chosen
 * provider, `injectedProvider: WalletProvider`, and `getActiveProvider()` which
 * resolves the active provider off walletStore.kind.
 */
import { BrowserProvider, type Signer, type Eip1193Provider } from "ethers";
import type { WalletProvider } from "./walletProvider";

export const CHAIN_ID = Number(import.meta.env.VITE_EVM_CHAIN_ID ?? 11155111);
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16); // 0xaa36a7 for Sepolia
const RPC_URL = import.meta.env.VITE_EVM_RPC_URL as string;
const SELECTED_RDNS_KEY = "crackd-wallet-rdns";

// ----------------------------- EIP-6963 types -----------------------------

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string; // data: URI
  rdns: string;
}
export interface DiscoveredWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

/**
 * Curated set of popular wallets so the picker always shows real options —
 * even ones the user hasn't installed yet (those link to their download page).
 * Detected wallets (via EIP-6963 rdns match) take precedence and connect
 * directly. `brand` is the letter-tile colour used when no icon is available.
 */
export interface KnownWallet {
  rdns: string;
  name: string;
  downloadUrl: string;
  brand: string;
  /** Domain used to resolve a real brand logo from a favicon service. */
  domain: string;
}
export const KNOWN_WALLETS: KnownWallet[] = [
  { rdns: "io.metamask", name: "MetaMask", downloadUrl: "https://metamask.io/download/", brand: "#f6851b", domain: "metamask.io" },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", downloadUrl: "https://www.coinbase.com/wallet/downloads", brand: "#0052ff", domain: "coinbase.com" },
  { rdns: "io.rabby", name: "Rabby", downloadUrl: "https://rabby.io/", brand: "#7084ff", domain: "rabby.io" },
  { rdns: "com.trustwallet.app", name: "Trust Wallet", downloadUrl: "https://trustwallet.com/download", brand: "#3375bb", domain: "trustwallet.com" },
  { rdns: "com.okex.wallet", name: "OKX Wallet", downloadUrl: "https://www.okx.com/web3", brand: "#111111", domain: "okx.com" },
  { rdns: "me.rainbow", name: "Rainbow", downloadUrl: "https://rainbow.me/", brand: "#001e59", domain: "rainbow.me" },
  { rdns: "com.brave.wallet", name: "Brave Wallet", downloadUrl: "https://brave.com/wallet/", brand: "#fb542b", domain: "brave.com" },
  { rdns: "app.phantom", name: "Phantom", downloadUrl: "https://phantom.app/download", brand: "#ab9ff2", domain: "phantom.app" },
  { rdns: "io.zerion.wallet", name: "Zerion", downloadUrl: "https://zerion.io/", brand: "#2962ef", domain: "zerion.io" },
];

/** Real brand logo for a known wallet, via a no-auth favicon service. */
export function walletIconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

type Eip1193WithRequest = Eip1193Provider & {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

// rdns → detail. Persists for the page lifetime; wallets may announce more
// than once, so a map dedupes by rdns.
const discovered = new Map<string, DiscoveredWallet>();
let listening = false;

function startListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent<DiscoveredWallet>).detail;
    if (detail?.info?.rdns) discovered.set(detail.info.rdns, detail);
  });
}

/**
 * Discover injected wallets. Dispatches the EIP-6963 request, waits a tick for
 * wallets to answer, then returns them. Falls back to a synthetic entry for a
 * legacy `window.ethereum` if nothing announced.
 */
export async function discoverWallets(): Promise<DiscoveredWallet[]> {
  startListening();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  await new Promise((r) => setTimeout(r, 250));

  const list = Array.from(discovered.values());
  if (list.length === 0 && typeof window !== "undefined" && window.ethereum) {
    list.push({
      info: {
        uuid: "legacy-injected",
        name: "Browser Wallet",
        icon: "",
        rdns: "legacy.injected",
      },
      provider: window.ethereum as Eip1193Provider,
    });
  }
  return list;
}

// ----------------------------- selected provider -----------------------------

let selectedProvider: Eip1193Provider | null = null;

/** Resolve the provider for the wallet the user connected with. */
async function getSelectedProvider(): Promise<Eip1193WithRequest> {
  if (selectedProvider) return selectedProvider as Eip1193WithRequest;
  // After a reload the in-memory ref is gone — re-discover by saved rdns.
  const savedRdns =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(SELECTED_RDNS_KEY)
      : null;
  if (savedRdns) {
    const wallets = await discoverWallets();
    const match = wallets.find((w) => w.info.rdns === savedRdns);
    if (match) {
      selectedProvider = match.provider;
      return selectedProvider as Eip1193WithRequest;
    }
  }
  if (typeof window !== "undefined" && window.ethereum) {
    selectedProvider = window.ethereum as Eip1193Provider;
    return selectedProvider as Eip1193WithRequest;
  }
  throw new Error("No EVM wallet found. Install MetaMask or use email sign-in.");
}

// ----------------------------- chain handling -----------------------------

/** Ask the wallet to switch to Sepolia, adding it if unknown. */
async function ensureSepolia(eth: Eip1193WithRequest): Promise<void> {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Ethereum Sepolia",
            nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

// ----------------------------- connect -----------------------------

/** Normalize wallet errors into friendly messages. */
export function describeWalletError(err: unknown): string {
  const code = (err as { code?: number })?.code;
  if (code === 4001 || code === 5000) return "Request rejected in your wallet.";
  if (code === -32002)
    return "A wallet request is already pending — open your wallet to continue.";
  const msg = (err as { message?: string })?.message;
  return msg && msg.length < 140 ? msg : "Could not connect. Please try again.";
}

/**
 * Connect a chosen wallet provider: request accounts, ensure Sepolia, remember
 * it, and return the selected 0x address.
 */
export async function connectInjectedWallet(
  wallet: DiscoveredWallet,
): Promise<string> {
  const eth = wallet.provider as Eip1193WithRequest;
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  await ensureSepolia(eth);

  selectedProvider = wallet.provider;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SELECTED_RDNS_KEY, wallet.info.rdns);
  }

  const address =
    accounts?.[0] ??
    (await new BrowserProvider(wallet.provider).getSigner()).address;
  return address;
}

export const injectedProvider: WalletProvider = {
  kind: "injected",
  async getAddress() {
    const eth = await getSelectedProvider();
    const provider = new BrowserProvider(eth);
    const signer = await provider.getSigner();
    return signer.getAddress();
  },
  async getSigner(): Promise<Signer> {
    const eth = await getSelectedProvider();
    await ensureSepolia(eth);
    const provider = new BrowserProvider(eth);
    return provider.getSigner();
  },
  async disconnect() {
    // Injected wallets have no programmatic disconnect; clearing app state
    // (done by walletStore) is the convention.
    selectedProvider = null;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SELECTED_RDNS_KEY);
    }
  },
};

/**
 * Resolve the currently-active provider from walletStore. Imports are
 * lazy to avoid the circular dep — walletStore imports lib/wallet, so this
 * module can't statically import the store.
 */
export async function getActiveProvider(): Promise<WalletProvider> {
  const { useWalletStore } = await import("../store/walletStore");
  const kind = useWalletStore.getState().kind;
  if (kind === "privy") {
    const mod = (await import("./privy")) as { privyProvider: WalletProvider };
    return mod.privyProvider;
  }
  if (kind === "walletconnect") {
    const mod = (await import("./walletconnect")) as {
      walletConnectProvider: WalletProvider;
    };
    return mod.walletConnectProvider;
  }
  return injectedProvider;
}
