/**
 * Sign-in modal.
 *  - Primary: Privy email/social (one button — Privy's own modal handles the
 *    method picker). Hidden if Privy isn't configured.
 *  - Divider.
 *  - Crypto wallets: every injected wallet discovered via EIP-6963, each its
 *    own option, with per-wallet connecting state and inline error feedback.
 *
 * Rendered via createPortal into document.body so `position: fixed` works even
 * when an ancestor has transform/filter/will-change (which create a new
 * containing block).
 *
 * Pure presentation; the host (WalletButton) controls open/close.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useWalletStore } from "../store/walletStore";
import {
  discoverWallets,
  describeWalletError,
  KNOWN_WALLETS,
  type DiscoveredWallet,
} from "../lib/wallet";
import { walletConnectEnabled } from "../lib/walletconnect";

type WalletOption =
  | { type: "injected"; key: string; name: string; icon: string; brand?: string; wallet: DiscoveredWallet }
  | { type: "install"; key: string; name: string; brand: string; downloadUrl: string }
  | { type: "walletconnect"; key: "walletconnect"; name: string };

export function ConnectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const privyEnabled = !!import.meta.env.VITE_PRIVY_APP_ID;
  const [error, setError] = useState<string | null>(null);

  // Reset transient error whenever the modal is reopened.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <ModalShell open={open} onClose={onClose}>
      {privyEnabled ? (
        <PrivySection onChosen={onClose} />
      ) : (
        <div className="rounded-xl border border-ink-border bg-ink-elevated px-4 py-3 text-xs text-fg-muted leading-relaxed">
          Email / Google / Apple sign-in isn’t configured here — connect a
          crypto wallet below.
        </div>
      )}

      <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.24em] text-fg-muted">
        <div className="h-px flex-1 bg-ink-border" />
        or connect a wallet
        <div className="h-px flex-1 bg-ink-border" />
      </div>

      <WalletList
        open={open}
        onChosen={onClose}
        onError={setError}
        clearError={() => setError(null)}
      />

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"
        >
          <AlertGlyph />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <div className="mt-4 text-[11px] text-fg-muted leading-relaxed">
        Your secret code is encrypted on-chain — even we can’t see it. Email
        sign-in creates a self-custodial wallet, exportable anytime.
      </div>
    </ModalShell>
  );
}

// ============================================================
// Shell
// ============================================================

function ModalShell({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] bg-ink/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-[101] flex items-center justify-center p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="panel-elevated w-full max-w-sm p-6 my-auto animate-slide-up relative overflow-hidden">
          {/* accent glow in the corner */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-accent/20 blur-3xl"
          />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-lg text-fg-muted hover:text-fg-primary hover:bg-ink-elevated transition-colors"
          >
            <CloseGlyph />
          </button>

          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent">
              Crackd Confidential
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">
              Sign in to play
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              Set a secret code, crack theirs. Live in ~30 seconds.
            </p>
            <div className="mt-5">{children}</div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ============================================================
// Privy (email / social)
// ============================================================

function PrivySection({ onChosen }: { onChosen: () => void }) {
  const { login, ready } = usePrivy();
  return (
    <button
      className="w-full px-4 py-3.5 rounded-xl border border-accent/40 bg-accent/10 hover:border-accent/70 hover:bg-accent/15 transition-colors text-left disabled:opacity-50 disabled:cursor-wait flex items-center gap-3 group"
      disabled={!ready}
      onClick={() => {
        login();
        onChosen();
      }}
    >
      <span
        aria-hidden
        className="grid place-items-center w-9 h-9 rounded-lg bg-accent/15 text-accent"
      >
        <PrivyGlyph />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-fg-primary">
          Continue with email or social
        </span>
        <span className="block text-xs text-fg-muted mt-0.5">
          Email · Google · Apple — no wallet install
        </span>
      </span>
      <Chevron />
    </button>
  );
}

// ============================================================
// Crypto wallets (EIP-6963 discovery)
// ============================================================

function WalletList({
  open,
  onChosen,
  onError,
  clearError,
}: {
  open: boolean;
  onChosen: () => void;
  onError: (msg: string) => void;
  clearError: () => void;
}) {
  const connectInjected = useWalletStore((s) => s.connectInjected);
  const connectWalletConnect = useWalletStore((s) => s.connectWalletConnect);
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setWallets(null);
    setBusyKey(null);
    discoverWallets().then((w) => {
      if (alive) setWallets(w);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Merge curated wallets with what's actually installed (EIP-6963).
  const { installed, walletConnect, notInstalled } = useMemo(() => {
    const installed: WalletOption[] = [];
    const notInstalled: WalletOption[] = [];
    if (!wallets) return { installed, walletConnect: null as WalletOption | null, notInstalled };

    const byRdns = new Map(wallets.map((w) => [w.info.rdns, w]));
    const seen = new Set<string>();

    for (const k of KNOWN_WALLETS) {
      const found = byRdns.get(k.rdns);
      if (found) {
        installed.push({ type: "injected", key: k.rdns, name: k.name, icon: found.info.icon, brand: k.brand, wallet: found });
        seen.add(k.rdns);
      } else {
        notInstalled.push({ type: "install", key: k.rdns, name: k.name, brand: k.brand, downloadUrl: k.downloadUrl });
      }
    }
    // Installed wallets we don't have in the curated list (incl. legacy fallback).
    for (const w of wallets) {
      if (seen.has(w.info.rdns)) continue;
      const name = w.info.rdns === "legacy.injected" ? "Browser wallet" : w.info.name;
      installed.push({ type: "injected", key: w.info.rdns, name, icon: w.info.icon, wallet: w });
    }

    const walletConnect: WalletOption | null = walletConnectEnabled
      ? { type: "walletconnect", key: "walletconnect", name: "WalletConnect" }
      : null;

    return { installed, walletConnect, notInstalled };
  }, [wallets]);

  const handleInjected = useCallback(
    async (opt: Extract<WalletOption, { type: "injected" }>) => {
      clearError();
      setBusyKey(opt.key);
      try {
        await connectInjected(opt.wallet);
        onChosen();
      } catch (err) {
        onError(describeWalletError(err));
      } finally {
        setBusyKey(null);
      }
    },
    [connectInjected, onChosen, onError, clearError],
  );

  const handleWalletConnect = useCallback(async () => {
    clearError();
    setBusyKey("walletconnect");
    try {
      await connectWalletConnect();
      onChosen();
    } catch (err) {
      onError(describeWalletError(err));
    } finally {
      setBusyKey(null);
    }
  }, [connectWalletConnect, onChosen, onError, clearError]);

  if (wallets === null) {
    return (
      <div className="space-y-2">
        <WalletSkeleton />
        <WalletSkeleton />
      </div>
    );
  }

  const anyBusy = busyKey !== null;

  return (
    <div className="space-y-2">
      {/* Installed wallets — connect directly */}
      {installed.map((opt) =>
        opt.type === "injected" ? (
          <WalletRow
            key={opt.key}
            name={opt.name}
            sublabel={busyKey === opt.key ? "Check your wallet…" : "Connect to Sepolia"}
            icon={opt.icon}
            busy={busyKey === opt.key}
            disabled={anyBusy}
            onClick={() => handleInjected(opt)}
          />
        ) : null,
      )}

      {/* WalletConnect — QR / mobile wallets */}
      {walletConnect && (
        <WalletRow
          name="WalletConnect"
          sublabel={busyKey === "walletconnect" ? "Opening…" : "Scan with a mobile wallet"}
          glyph={<WalletConnectGlyph />}
          accent
          busy={busyKey === "walletconnect"}
          disabled={anyBusy}
          onClick={handleWalletConnect}
        />
      )}

      {/* Not installed — link to install */}
      {notInstalled.length > 0 && (
        <>
          <div className="pt-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            Don’t have one yet
          </div>
          {notInstalled.map((opt) =>
            opt.type === "install" ? (
              <a
                key={opt.key}
                href={opt.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full px-4 py-2.5 rounded-xl border border-ink-border/60 bg-ink-elevated/50 hover:bg-ink-elevated hover:border-ink-border transition-colors text-left flex items-center gap-3 group"
              >
                <LetterTile name={opt.name} brand={opt.brand} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-fg-secondary group-hover:text-fg-primary truncate">
                    {opt.name}
                  </span>
                </span>
                <span className="text-[11px] text-fg-muted group-hover:text-fg-secondary">
                  Install ↗
                </span>
              </a>
            ) : null,
          )}
        </>
      )}
    </div>
  );
}

function WalletRow({
  name,
  sublabel,
  icon,
  glyph,
  accent,
  busy,
  disabled,
  onClick,
}: {
  name: string;
  sublabel: string;
  icon?: string;
  glyph?: React.ReactNode;
  accent?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full px-4 py-3 rounded-xl border bg-ink-elevated transition-colors text-left flex items-center gap-3 disabled:opacity-60 disabled:cursor-wait ${
        accent
          ? "border-accent/30 hover:border-accent/60"
          : "border-ink-border hover:border-accent/40"
      }`}
    >
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-ink-raised overflow-hidden text-fg-secondary shrink-0">
        {icon ? (
          <img src={icon} alt="" className="h-6 w-6 object-contain" />
        ) : glyph ? (
          glyph
        ) : (
          <WalletGlyph />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{name}</span>
        <span className="block text-xs text-fg-muted mt-0.5">{sublabel}</span>
      </span>
      {busy ? <Spinner /> : <Chevron />}
    </button>
  );
}

function LetterTile({ name, brand }: { name: string; brand: string }) {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-9 h-9 rounded-lg shrink-0 text-xs font-semibold text-white/90"
      style={{ background: `${brand}` }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

function WalletSkeleton() {
  return (
    <div className="w-full px-4 py-3 rounded-xl border border-ink-border bg-ink-elevated flex items-center gap-3">
      <span className="h-9 w-9 rounded-lg bg-ink-raised animate-pulse" />
      <span className="flex-1 space-y-1.5">
        <span className="block h-3 w-24 rounded bg-ink-raised animate-pulse" />
        <span className="block h-2.5 w-32 rounded bg-ink-raised animate-pulse" />
      </span>
    </div>
  );
}

// ============================================================
// Glyphs
// ============================================================

function PrivyGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7l8 5 8-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function WalletGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 9h13a2 2 0 012 2v3a2 2 0 01-2 2H3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="16" cy="12.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function WalletConnectGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-[#3b99fc]">
      <path
        d="M6.5 9.2c3-2.9 8-2.9 11 0l.4.3c.15.15.15.38 0 .53l-1.25 1.2a.2.2 0 01-.28 0l-.5-.49c-2.1-2-5.48-2-7.58 0l-.54.52a.2.2 0 01-.28 0L6.4 10.06a.37.37 0 010-.53l.1-.33z"
        fill="currentColor"
      />
      <path
        d="M9.1 11.8c1.6-1.55 4.2-1.55 5.8 0l.06.06c.15.15.15.38 0 .53l-2 1.92a.1.1 0 01-.14 0l-.82-.79a.5.5 0 00-.7 0l-.82.8a.1.1 0 01-.14 0l-2-1.93a.37.37 0 010-.53l.12-.06z"
        fill="currentColor"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-fg-muted shrink-0"
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-accent shrink-0 animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="mt-0.5 shrink-0"
    >
      <path
        d="M12 8v5M12 16.5v.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
