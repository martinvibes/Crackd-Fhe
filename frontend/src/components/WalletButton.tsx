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
      <span aria-label="email-wallet" title="Email login (Privy)" className="text-fg-secondary inline-flex">
        <MailGlyph />
      </span>
    ) : kind === "walletconnect" ? (
      <span aria-label="walletconnect" title="WalletConnect" className="text-fg-secondary inline-flex">
        <LinkGlyph />
      </span>
    ) : (
      <span aria-label="crypto-wallet" title="Crypto wallet" className="text-fg-secondary inline-flex">
        <WalletGlyph />
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
        {/* Header — kind label + ETH gas hero */}
        <div className="px-4 pt-4 pb-4 bg-gradient-to-b from-accent/10 to-transparent">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.22em] text-fg-muted">
              {kindLabel}
            </div>
            {balancesQ.isFetching && (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse"
                title="Refreshing balances"
              />
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <TokenLogo symbol="ETH" size={26} />
            <span className="text-[32px] leading-none font-semibold tabular-nums">
              {balancesQ.isLoading ? "…" : eth ? formatAmount(eth.amount) : "0"}
            </span>
            <span className="text-sm text-fg-muted">ETH</span>
          </div>

          {/* Gas-sponsored badge — players never buy Sepolia ETH */}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1">
            <SparkIcon />
            <span className="text-[10px] uppercase tracking-[0.14em] text-accent font-medium">
              Gas sponsored
            </span>
          </div>

          {/* Token balances — one clean row each, with logos */}
          <div className="mt-3.5 space-y-1.5">
            {otherAssets.map((a) => (
              <div
                key={a.asset}
                className="flex items-center justify-between rounded-lg bg-ink-elevated/70 border border-ink-border/60 px-2.5 py-2"
              >
                <span className="flex items-center gap-2">
                  <TokenLogo symbol={a.asset} size={24} />
                  <span className="text-sm text-fg-secondary">{a.asset}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg-primary">
                  {balancesQ.isLoading ? "…" : formatAmount(a.amount)}
                </span>
              </div>
            ))}
          </div>
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

function MailGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 7l8 5 8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 14a4 4 0 005.66 0l2.84-2.84a4 4 0 10-5.66-5.66L11.5 6.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 10a4 4 0 00-5.66 0L5.5 12.84a4 4 0 105.66 5.66L12.5 17.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h13a2 2 0 012 2v3a2 2 0 01-2 2H3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="12.5" r="1.2" fill="currentColor" />
    </svg>
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

function TokenLogo({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const s = symbol.toUpperCase();
  if (s === "ETH" || s === "WETH") {
    // Ethereum diamond (two-tone). WETH shares the mark.
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <g fill="#FFF" fillRule="nonzero">
          <path fillOpacity="0.6" d="M16.5 4v8.87l7.5 3.35z" />
          <path d="M16.5 4L9 16.22l7.5-3.35z" />
          <path fillOpacity="0.6" d="M16.5 21.97V28L24 17.62z" />
          <path d="M16.5 28v-6.03L9 17.62z" />
          <path fillOpacity="0.2" d="M16.5 20.57l7.5-4.35-7.5-3.35z" />
          <path fillOpacity="0.6" d="M9 16.22l7.5 4.35v-7.7z" />
        </g>
      </svg>
    );
  }
  if (s === "USDC") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#2775CA" />
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="#FFF"
          fontFamily="system-ui, sans-serif"
        >
          $
        </text>
      </svg>
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-ink-raised text-[10px] font-semibold text-fg-secondary"
      style={{ width: size, height: size }}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

function SparkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
      <path
        d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
        fill="currentColor"
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
