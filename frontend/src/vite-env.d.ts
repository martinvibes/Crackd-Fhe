/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  /** EVM JSON-RPC endpoint (Sepolia). */
  readonly VITE_EVM_RPC_URL: string;
  /** EVM chain id, default 11155111 (Sepolia). */
  readonly VITE_EVM_CHAIN_ID?: string;
  readonly VITE_CRACKD_DUEL_ADDRESS: string;
  readonly VITE_CRACKD_VAULT_ADDRESS: string;
  readonly VITE_CRACKD_FHE_ADDRESS: string;
  readonly VITE_USDC_ADDRESS: string;
  readonly VITE_WETH_ADDRESS: string;
  /** Zama confidential relayer URL. */
  readonly VITE_RELAYER_URL?: string;
  /** Privy app id from https://dashboard.privy.io. Empty disables email login. */
  readonly VITE_PRIVY_APP_ID?: string;
  /** WalletConnect / Reown project id (https://cloud.reown.com). Empty hides the WalletConnect option. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import("ethers").Eip1193Provider & {
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}
