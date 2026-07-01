/**
 * Confidential vs-AI — the SAME game board as the normal game, but the Vault's
 * code is sealed on-chain as FHE ciphertext and every guess you make is scored
 * BY THE CONTRACT on the encrypted code (you sign a tx per guess). Same flow,
 * same UI as /play; the confidentiality just happens underneath.
 */
import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useWalletStore } from "../store/walletStore";
import { getActiveProvider } from "../lib/wallet";
import { fheConfigured, scoreGuessOnChain, FHE_EXPLORER } from "../lib/fheGame";
import WalletButton from "../components/WalletButton";
import { PlayBackground } from "../components/game/PlayBackground";
import { Board } from "../components/game/board/Board";
import type { SafeGameView } from "../lib/socket";

const MAX_GUESSES = 10;

interface Round {
  code: string;
  result: { pots: number; pans: number };
  timestamp: number;
}

export default function Confidential() {
  const address = useWalletStore((s) => s.address);
  if (!fheConfigured()) return <NotDeployed />;
  if (!address) return <SignedOut />;
  return <Game address={address} />;
}

function Game({ address }: { address: string }) {
  const [phase, setPhase] = useState<"start" | "active" | "finished">("start");
  const [gameId, setGameId] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"cracked" | "failed" | null>(null);

  const getSigner = useCallback(async () => {
    const provider = await getActiveProvider();
    return provider.getSigner();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    setStatus("Sealing the Vault's code on-chain…");
    try {
      const { gameId } = await api.confidentialNew(address);
      setGameId(gameId);
      setRounds([]);
      setResult(null);
      setPhase("active");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [address]);

  // The Board calls this on each guess. We score on-chain and append the round.
  const onGuess = useCallback(
    async (guess: string): Promise<{ ok: boolean; error?: string }> => {
      const code = guess.replace(/\D/g, "").slice(0, 4);
      if (code.length !== 4) return { ok: false, error: "Enter 4 digits" };
      try {
        const signer = await getSigner();
        try {
          await api.gas(await signer.getAddress());
        } catch {
          /* best-effort gas top-up */
        }
        const res = await scoreGuessOnChain(signer, gameId, code.split("").map(Number));
        setRounds((prev) => {
          const next = [
            ...prev,
            { code, result: { pots: res.pots, pans: res.pans }, timestamp: Date.now() },
          ];
          if (res.solved || res.pots === 4) {
            setResult("cracked");
            setPhase("finished");
          } else if (next.length >= MAX_GUESSES) {
            setResult("failed");
            setPhase("finished");
          }
          return next;
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: friendly(e) };
      }
    },
    [gameId, getSigner],
  );

  // Synthetic view so we can reuse the exact normal-game Board.
  const view: SafeGameView = useMemo(
    () => ({
      gameId,
      mode: "vs_ai_free",
      status: "active",
      you: "playerOne",
      youAre: address,
      opponent: "vault",
      yourCode: "sealed", // truthy → composer is in "guess" mode, not code-setting
      opponentCodeSet: true,
      yourGuesses: rounds,
      opponentGuesses: [],
      currentTurn: "playerOne", // always your move — you're the cracker
      winner: null,
      isDraw: false,
      stakeAmount: 0,
      stakeAsset: null,
      maxGuesses: MAX_GUESSES,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [gameId, address, rounds],
  );

  return (
    <div className="relative max-w-3xl mx-auto px-5 md:px-8 py-6">
      <PlayBackground intense={phase === "active"} />
      <div className="relative z-10">
        {/* slim confidential ribbon + gas */}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
            <LockIcon /> Confidential · Zama fhEVM
          </span>
          <GasChip address={address} />
        </div>

        {phase === "start" && (
          <StartScreen onStart={start} busy={busy} status={status} error={error} />
        )}

        {phase === "active" && (
          <div className="mt-4">
            <Board
              walletAddress={address}
              view={view}
              tauntLine={null}
              onSetCode={async () => ({ ok: true })}
              onGuess={onGuess}
            />
          </div>
        )}

        {phase === "finished" && result && (
          <FinishScreen result={result} attempts={rounds.length} onReset={start} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Start / Finish screens (kept minimal — the Board is the game)
// ============================================================

function StartScreen({
  onStart,
  busy,
  status,
  error,
}: {
  onStart: () => void;
  busy: boolean;
  status: string | null;
  error: string | null;
}) {
  return (
    <div className="mt-10 max-w-xl mx-auto text-center animate-fade-in">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
        Crack the Vault's <span className="text-accent">sealed code.</span>
      </h1>
      <p className="mt-3 text-fg-secondary">
        The Vault picks a secret 4-digit code and seals it on-chain as FHE
        ciphertext. You get {MAX_GUESSES} guesses — each one is scored{" "}
        <span className="text-fg-primary">by the contract, on the encrypted
        code</span>. The code is never revealed, not even to us.
      </p>

      <div className="mt-6 flex items-center justify-center gap-2">
        {["·", "·", "·", "·"].map((c, i) => (
          <span
            key={i}
            className="w-12 h-14 grid place-items-center rounded-xl text-2xl font-mono text-fg-muted"
            style={{
              background: "linear-gradient(160deg,#1E1329,#0D0816)",
              border: "1px solid rgba(255,0,168,0.16)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -3px 6px rgba(0,0,0,0.55)",
            }}
          >
            {c}
          </span>
        ))}
      </div>

      <button
        onClick={onStart}
        disabled={busy}
        className="btn-primary mt-7 cursor-pointer disabled:cursor-wait"
      >
        {busy ? status ?? "Sealing the Vault…" : "Seal the Vault & play"}
      </button>
      {error && <div className="mt-4 text-sm text-danger">{error}</div>}

      {FHE_EXPLORER && (
        <div className="mt-4">
          <a
            href={FHE_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-fg-muted hover:text-accent"
          >
            CrackdFHE contract ↗
          </a>
        </div>
      )}
    </div>
  );
}

function FinishScreen({
  result,
  attempts,
  onReset,
}: {
  result: "cracked" | "failed";
  attempts: number;
  onReset: () => void;
}) {
  const win = result === "cracked";
  return (
    <div className="mt-12 max-w-xl mx-auto text-center animate-slide-up">
      <div className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-accent/10 text-accent">
        {win ? <UnlockIcon /> : <ShieldIcon />}
      </div>
      <h1 className="mt-5 text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
        {win ? "You cracked the Vault." : "The Vault held."}
      </h1>
      <p className="mt-3 text-fg-secondary">
        {win
          ? `Cracked in ${attempts} guess${attempts === 1 ? "" : "es"} — every one scored on the encrypted code, which was never revealed on-chain.`
          : `Out of guesses. The Vault's code stayed sealed the whole game — the contract scored you without ever exposing it.`}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button onClick={onReset} className="btn-primary cursor-pointer">
          New game
        </button>
        <Link to="/play" className="btn-ghost cursor-pointer">
          Classic modes
        </Link>
      </div>
    </div>
  );
}

// ============================================================
// Bits
// ============================================================

function GasChip({ address }: { address: string }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  async function go() {
    if (state === "sending") return;
    setState("sending");
    try {
      await api.gas(address);
      qc.invalidateQueries({ queryKey: ["balances", address] });
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("idle");
    }
  }
  return (
    <button
      onClick={go}
      disabled={state === "sending"}
      className="text-xs font-medium text-accent hover:underline disabled:opacity-60 cursor-pointer whitespace-nowrap"
    >
      {state === "sending" ? "Topping up…" : state === "done" ? "Gas topped up" : "Get test ETH"}
    </button>
  );
}

function NotDeployed() {
  return (
    <Centered>
      <LockIcon large />
      <h1 className="mt-5 text-2xl font-semibold">Confidential mode isn’t live yet</h1>
      <p className="mt-3 text-fg-secondary max-w-md mx-auto">
        The CrackdFHE engine needs to be deployed to Sepolia. Deploy the
        contracts and set <span className="font-mono">VITE_CRACKD_FHE_ADDRESS</span>.
      </p>
      <Link to="/play" className="btn-primary mt-6 inline-flex cursor-pointer">
        Play the classic modes
      </Link>
    </Centered>
  );
}

function SignedOut() {
  return (
    <Centered>
      <LockIcon large />
      <h1 className="mt-5 text-2xl font-semibold">Sign in to play confidentially</h1>
      <p className="mt-3 text-fg-secondary max-w-md mx-auto">
        You’ll crack a code sealed on Sepolia, so you need a wallet connected.
      </p>
      <div className="mt-6 inline-flex">
        <WalletButton />
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto px-5 py-20 text-center">{children}</div>;
}

function LockIcon({ large }: { large?: boolean }) {
  const s = large ? 40 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={large ? "mx-auto text-accent" : "text-accent"}>
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V7a4 4 0 017.5-1.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
    </svg>
  );
}

function friendly(e: unknown): string {
  const code = (e as { code?: number | string })?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "Transaction rejected in your wallet.";
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as { message?: string })?.message;
  if (msg && /insufficient funds|coalesce/i.test(msg))
    return "Out of gas. Tap “Get test ETH”, then try again.";
  if (msg && msg.length < 160) return msg;
  return "Something went wrong. Check your wallet & network and try again.";
}
