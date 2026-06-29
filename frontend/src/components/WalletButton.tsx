/**
 * Wallet pill in the top-right.
 *  - Disconnected → opens ConnectModal (Privy + injected wallet)
 *  - Connected → pill shows kind badge + truncated address; click expands
 *    a richer dropdown with the live ETH balance, full address with
 *    copy-to-clipboard (✓ feedback), an explorer link, and Disconnect.
 */
import { useEffect, useRef, useState } from "react";
import { useWalletStore } from "../store/walletStore";
import { shortAddress } from "../lib/evm";
import { useBalances } from "../lib/balance";
import { ConnectModal } from "./ConnectModal";
import type { WalletKind } from "../lib/walletProvider";

const EXPLORER_BASE = "https://sepolia.etherscan.io/address";

export default function WalletButton() {
  const { address, kind, connecting, disconnect } = useWalletStore();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  if (!address) {
    return (
      <>
        <button
          className="btn-primary group"
          disabled={connecting}
          onClick={() => setModalOpen(true)}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-ink inline-block" />
          {connecting ? "Signing in…" : "Sign in"}
        </button>
        <ConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  const kindBadge =
    kind === "privy" ? (
      <span aria-label="email-wallet" title="Email login (Privy)" className="text-xs">
        ✉
      </span>
    ) : kind === "walletconnect" ? (
      <span aria-label="walletconnect" title="WalletConnect" className="text-xs">
        🔗
      </span>
    ) : (
      <span aria-label="crypto-wallet" title="Crypto wallet" className="text-xs">
        ⌬
      </span>
    );

  return (
    <div className="relative">
      <button
        className="chip hover:border-ink-border-strong transition-colors flex items-center gap-2 pr-1 pl-3 py-1.5"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
        {kindBadge}
        <span className="font-mono text-fg-primary">{shortAddress(address, 5)}</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest text-fg-muted bg-ink-raised">
          testnet
        </span>
      </button>

      {open && (
        <WalletMenu
          address={address}
          kind={kind}
          onClose={() => setOpen(false)}
          onDisconnect={async () => {
            await disconnect();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Dropdown menu — balance, address with copy, explorer, disconnect
// ============================================================

function WalletMenu({
  address,
  kind,
  onClose,
  onDisconnect,
}: {
  address: string;
  kind: WalletKind;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const kindLabel =
    kind === "privy"
      ? "Email · Privy"
      : kind === "walletconnect"
        ? "WalletConnect"
        : "Crypto wallet";
  const balancesQ = useBalances(address);
  const eth = balancesQ.data?.find((b) => b.asset === "ETH");
  const otherAssets = balancesQ.data?.filter((b) => b.asset !== "ETH") ?? [];

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute right-0 mt-2 w-80 panel-elevated z-50 p-0 animate-slide-up overflow-hidden">
        {/* Header — kind label + balance hero */}
        <div className="px-4 pt-4 pb-3 bg-gradient-to-b from-accent/5 to-transparent">
          <div className="text-[10px] uppercase tracking-[0.22em] text-fg-muted">
            {kindLabel}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">
              {balancesQ.isLoading
                ? "…"
                : eth
                  ? formatAmount(eth.amount)
                  : "0"}
            </span>
            <span className="text-xs text-fg-muted">ETH</span>
            {balancesQ.isFetching && !balancesQ.isLoading && (
              <span
                aria-hidden
                className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse"
                title="Refreshing balance"
              />
            )}
          </div>
          {otherAssets.length > 0 && (
            <div className="mt-1 text-xs text-fg-muted tabular-nums">
              {otherAssets
                .map((a) => `${formatAmount(a.amount)} ${a.asset}`)
                .join(" · ")}
            </div>
          )}
        </div>

        <div className="divider" />

        {/* Address with copy button */}
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-fg-muted mb-1.5">
            Wallet address
          </div>
          <AddressRow address={address} />
        </div>

        <div className="divider" />

        {/* Actions */}
        <div className="p-1.5">
          <a
            href={`${EXPLORER_BASE}/${address}`}
            target="_blank"
            rel="noreferrer"
            className="block px-3 py-2 rounded-lg text-sm hover:bg-ink-elevated text-fg-secondary hover:text-fg-primary transition-colors"
          >
            View on Etherscan ↗
          </a>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-ink-elevated text-danger"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </div>
      </div>
    </>
  );
}

function AddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API not available — fall back to manual select. Rare.
    }
  }

  return (
    <button
      onClick={copy}
      className="w-full group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-ink-elevated border border-ink-border hover:border-accent/40 transition-colors text-left"
      title="Click to copy"
    >
      <span className="font-mono text-xs text-fg-secondary group-hover:text-fg-primary truncate flex-1">
        {address}
      </span>
      <span
        aria-hidden
        className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
          copied ? "text-accent" : "text-fg-muted group-hover:text-fg-secondary"
        }`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 15V6a2 2 0 012-2h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatAmount(n: number): string {
  // Big numbers get short form; small numbers keep precision.
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
