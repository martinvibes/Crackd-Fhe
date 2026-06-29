import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";
import { useWalletStore } from "./store/walletStore";
import { PrivyWalletBridge } from "./lib/privyBridge";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

function Root() {
  const restore = useWalletStore((s) => s.restore);
  useEffect(() => {
    restore();
  }, [restore]);
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

// Ethereum Sepolia, defined inline so we don't pull in viem/chains.
const CHAIN_ID = Number(import.meta.env.VITE_EVM_CHAIN_ID ?? 11155111);
const RPC_URL = import.meta.env.VITE_EVM_RPC_URL as string;
const sepolia = {
  id: CHAIN_ID,
  name: "Ethereum Sepolia",
  network: "sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
} as const;

function WrappedRoot() {
  // If Privy isn't configured (e.g. dev without an app id), skip the
  // provider so the injected wallet path still works. Privy buttons will
  // be hidden by ConnectModal when usePrivy isn't available.
  if (!PRIVY_APP_ID) {
    console.warn(
      "[crackd] VITE_PRIVY_APP_ID not set — Privy login disabled. Injected wallet path still works.",
    );
    return <Root />;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "apple"],
        // Embedded EVM wallets, auto-created for users who log in.
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: sepolia,
        supportedChains: [sepolia],
        appearance: {
          theme: "dark",
          accentColor: "#FF00A8",
          // Privy renders the logo inside its modal at ~40px tall.
          // Same PNG we point the dashboard at, so there's only one
          // file to swap if branding changes. Served from /public.
          logo: `${window.location.origin}/crackd-logo.png`,
        },
      }}
    >
      <PrivyWalletBridge />
      <Root />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WrappedRoot />
  </StrictMode>,
);
