/**
 * Confidential Challenge — the FHE showcase.
 *
 * You seal a secret 4-digit code → it's encrypted client-side and committed
 * to CrackdFHE on-chain as ciphertext. Then The Vault tries to crack it: each
 * guess is scored BY THE CONTRACT on the encrypted secret, and only you can
 * decrypt the resulting pegs. Your digits never appear on-chain.
 *
 * This is the page judges should see — it makes the FHE property tangible:
 * real Sepolia transactions, real ciphertext, real on-chain scoring, zero
 * leakage.
 */
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useWalletStore } from "../store/walletStore";
import { getActiveProvider } from "../lib/wallet";
import {
  fheConfigured,
  scoreGuessOnChain,
  txExplorer,
  FHE_EXPLORER,
} from "../lib/fheGame";
import { isValidCode } from "../lib/solver";
import WalletButton from "../components/WalletButton";
import { PlayBackground } from "../components/game/PlayBackground";
import { Peg } from "../components/game/board/GuessBubble";

const MAX_ROUNDS = 10;

interface Round {
  guess: string;
  pots: number;
  pans: number;
  solved: boolean;
  txHash: string;
}

type Phase = "start" | "playing" | "done";

export default function Confidential() {
  const address = useWalletStore((s) => s.address);

  if (!fheConfigured()) return <NotDeployed />;
  if (!address) return <SignedOut />;

  return <Challenge />;
}

// ============================================================
// Confidential vs-AI — YOU crack the Vault's on-chain sealed code
// ============================================================

function Challenge() {
  const address = useWalletStore((s) => s.address);
  const [phase, setPhase] = useState<Phase>("start");
  const [gameId, setGameId] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"cracked" | "failed" | null>(null);

  const getSigner = useCallback(async () => {
    const provider = await getActiveProvider();
    return provider.getSigner();
  }, []);

  const start = useCallback(async () => {
    if (!address) return;
    setError(null);
    setBusy(true);
    setStatus("Sealing the Vault's code on-chain…");
    try {
      const { gameId } = await api.confidentialNew(address);
      setGameId(gameId);
      setRounds([]);
      setResult(null);
      setDraft("");
      setPhase("playing");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [address]);

  const crack = useCallback(async () => {
    setError(null);
    const code = draft.replace(/\D/g, "").slice(0, 4);
    if (!isValidCode(code)) {
      setError("Enter 4 different digits (e.g. 5831).");
      return;
    }
    setBusy(true);
    try {
      const signer = await getSigner();
      try {
        await api.gas(await signer.getAddress());
      } catch {
        /* best-effort gas top-up */
      }
      setStatus("Scoring on the encrypted code — confirm in your wallet…");
      const res = await scoreGuessOnChain(signer, gameId, code.split("").map(Number));
      const round: Round = {
        guess: code,
        pots: res.pots,
        pans: res.pans,
        solved: res.solved,
        txHash: res.txHash,
      };
      const next = [...rounds, round];
      setRounds(next);
      setDraft("");

      if (res.solved || res.pots === 4) {
        setResult("cracked");
        setPhase("done");
      } else if (next.length >= MAX_ROUNDS) {
        setResult("failed");
        setPhase("done");
      }
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [draft, gameId, rounds, getSigner]);

  return (
    <div className="relative max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-12">
      <PlayBackground intense={phase === "playing"} />
      <div className="relative z-10">
        <Header />

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
          {/* Left: the game */}
          <div className="space-y-5">
            <GasFaucet />

            {phase === "start" && <StartCard onStart={start} busy={busy} status={status} />}

            {phase !== "start" && (
              <VaultBanner gameId={gameId} attempts={rounds.length} />
            )}

            {phase === "playing" && (
              <CrackCard
                value={draft}
                onChange={setDraft}
                onCrack={crack}
                attempt={rounds.length + 1}
                busy={busy}
                status={status}
              />
            )}

            {phase === "done" && result && (
              <ResultCard result={result} attempts={rounds.length} onReset={start} />
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                {error}
              </div>
            )}

            {rounds.length > 0 && <RoundLog rounds={rounds} />}
          </div>

          {/* Right: the why */}
          <Explainer />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Pieces
// ============================================================

/** Gas-only faucet — Confidential runs on-chain, so players need Sepolia ETH. */
function GasFaucet() {
  const address = useWalletStore((s) => s.address);
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!address || state === "sending") return;
    setErr(null);
    setState("sending");
    try {
      await api.gas(address);
      qc.invalidateQueries({ queryKey: ["balances", address] });
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setErr((e as Error).message?.slice(0, 120) ?? "Couldn't top up gas");
      setState("idle");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-border bg-ink-elevated px-3 py-2">
        <span className="text-xs text-fg-muted">
          {state === "done"
            ? "Gas topped up — you're set."
            : "Sealing & scoring run on-chain. Need gas?"}
        </span>
        <button
          onClick={go}
          disabled={state === "sending" || !address}
          className="text-xs font-medium text-accent hover:underline disabled:opacity-60 cursor-pointer whitespace-nowrap"
        >
          {state === "sending" ? "Sending…" : "Get test ETH"}
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] text-danger">{err}</div>}
    </div>
  );
}

function Header() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
        <LockIcon /> Confidential · Zama fhEVM
      </div>
      <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
        Crack the Vault's sealed code.
      </h1>
      <p className="mt-2 text-fg-secondary max-w-2xl">
        The Vault's secret code lives on-chain as <span className="text-fg-primary">FHE
        ciphertext</span>. You guess; the contract scores each guess{" "}
        <span className="text-fg-primary">on the encrypted code</span> and the
        pegs decrypt only for you. The code is never revealed — not to the chain,
        not even to us.
      </p>
    </div>
  );
}

function StartCard({
  onStart,
  busy,
  status,
}: {
  onStart: () => void;
  busy: boolean;
  status: string | null;
}) {
  return (
    <div className="panel-elevated p-6">
      <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        Step 1
      </div>
      <h2 className="mt-1 text-xl font-semibold">Start a confidential game</h2>
      <p className="mt-1 text-sm text-fg-muted">
        The Vault generates a secret 4-digit code and seals it on-chain as
        ciphertext. Then you try to crack it — you have {MAX_ROUNDS} guesses.
      </p>
      <div className="mt-5 flex items-center gap-2">
        {["·", "·", "·", "·"].map((c, i) => (
          <DigitTile key={i} char={c} />
        ))}
        <span className="ml-2 text-xs text-fg-muted inline-flex items-center gap-1">
          <LockIcon /> sealed on-chain
        </span>
      </div>
      <button
        onClick={onStart}
        disabled={busy}
        className="btn-primary mt-6 w-full cursor-pointer disabled:cursor-wait"
      >
        {busy ? status ?? "Sealing the Vault…" : "Seal the Vault & start"}
      </button>
    </div>
  );
}

function VaultBanner({ gameId, attempts }: { gameId: string; attempts: number }) {
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-accent/90">
          <LockIcon />
          The Vault's code
          <span className="text-fg-muted normal-case tracking-normal">
            (sealed — nobody can read it)
          </span>
        </div>
        {FHE_EXPLORER && (
          <a
            href={FHE_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline whitespace-nowrap"
          >
            on-chain ↗
          </a>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {["?", "?", "?", "?"].map((c, i) => (
          <DigitTile key={i} char={c} size="sm" />
        ))}
        <span className="ml-2 text-xs text-fg-muted">
          {attempts}/{MAX_ROUNDS} guesses used
        </span>
      </div>
      {gameId && (
        <div className="mt-2 text-[11px] text-fg-muted font-mono truncate">
          game {gameId.slice(0, 10)}…{gameId.slice(-6)}
        </div>
      )}
    </div>
  );
}

function CrackCard({
  value,
  onChange,
  onCrack,
  attempt,
  busy,
  status,
}: {
  value: string;
  onChange: (v: string) => void;
  onCrack: () => void;
  attempt: number;
  busy: boolean;
  status: string | null;
}) {
  const slots = [0, 1, 2, 3];
  function setAt(i: number, ch: string) {
    const d = ch.replace(/\D/g, "").slice(-1);
    const arr = value.padEnd(4, " ").slice(0, 4).split("");
    arr[i] = d || " ";
    onChange(arr.join("").replace(/ /g, ""));
  }
  return (
    <div className="panel-elevated p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
            Step 2 · Your move
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            Guess {attempt} of {MAX_ROUNDS}
          </h2>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        {slots.map((i) => (
          <input
            key={i}
            inputMode="numeric"
            maxLength={1}
            value={value[i] ?? ""}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) onCrack();
            }}
            className="w-14 h-16 text-center text-2xl font-semibold tabular-nums rounded-xl text-fg-primary outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(255,0,168,0.3)]"
            style={{
              background: "linear-gradient(160deg,#1E1329,#0D0816)",
              border: "1px solid rgba(255,0,168,0.18)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -3px 6px rgba(0,0,0,0.55)",
            }}
          />
        ))}
      </div>

      <p className="mt-4 text-sm text-fg-muted">
        Scored <span className="text-accent">inside the contract, on the
        encrypted code</span> — the pegs come back encrypted and decrypt only for
        you.
      </p>

      <button
        onClick={onCrack}
        disabled={busy}
        className="btn-primary mt-5 w-full cursor-pointer disabled:cursor-wait"
      >
        {busy ? status ?? "Scoring on ciphertext…" : "Submit guess on-chain"}
      </button>
    </div>
  );
}

function RoundLog({ rounds }: { rounds: Round[] }) {
  return (
    <div className="panel-elevated p-5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted mb-3">
        On-chain scoring log
      </div>
      <div className="space-y-2">
        {rounds.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl bg-ink-elevated border border-ink-border px-3 py-2"
          >
            <span className="text-xs text-fg-muted w-6">#{i + 1}</span>
            <span className="flex items-center gap-1">
              {r.guess.split("").map((c, k) => (
                <DigitTile key={k} char={c} size="sm" />
              ))}
            </span>
            <span className="ml-1">
              <PegRow pots={r.pots} pans={r.pans} />
            </span>
            <span className="ml-auto flex items-center gap-2">
              {r.solved && (
                <span className="text-[10px] uppercase tracking-wider text-accent">
                  cracked
                </span>
              )}
              <a
                href={txExplorer(r.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-fg-muted hover:text-accent"
                title="View the scoring transaction"
              >
                tx ↗
              </a>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
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
    <div
      className={`panel-elevated p-6 ${win ? "border-accent/40" : "border-ink-border"}`}
    >
      <div className="text-3xl font-semibold inline-flex items-center gap-2.5">
        {win ? (
          <>
            <UnlockIcon /> You cracked the Vault.
          </>
        ) : (
          <>
            <ShieldIcon /> The Vault held.
          </>
        )}
      </div>
      <p className="mt-2 text-fg-secondary">
        {win
          ? `Cracked in ${attempts} guess${attempts === 1 ? "" : "es"} — every one scored on the encrypted code. The Vault's digits were never revealed on-chain.`
          : `Out of guesses. The Vault's code stayed sealed the whole time — the contract scored you without ever exposing it.`}
      </p>
      <div className="mt-5 flex gap-3">
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

function Explainer() {
  return (
    <div className="space-y-4">
      <div className="panel-elevated p-5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          Why this matters
        </div>
        <h3 className="mt-1 text-lg font-semibold">Leaks vs. sealed</h3>
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded-lg border border-ink-border bg-ink-elevated p-3">
            <div className="text-xs uppercase tracking-wider text-fg-muted mb-1">
              Normal on-chain game
            </div>
            <p className="text-fg-secondary">
              The secret sits in storage or a hash someone can grind. A trusted
              referee scores guesses off-chain and could cheat.
            </p>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="text-xs uppercase tracking-wider text-accent mb-1">
              Crackd Confidential
            </div>
            <p className="text-fg-secondary">
              The code is FHE ciphertext. The{" "}
              <span className="text-fg-primary">contract itself</span> computes
              the pegs on encrypted data — provably honest, no trusted setter,
              no ZK circuit.
            </p>
          </div>
        </div>
      </div>

      <div className="panel-elevated p-5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          Under the hood
        </div>
        <ol className="mt-3 space-y-2 text-sm text-fg-secondary list-decimal list-inside">
          <li>4 digits encrypted to <span className="font-mono">euint8[4]</span> in your browser.</li>
          <li><span className="font-mono">createGame()</span> commits the ciphertext on-chain.</li>
          <li><span className="font-mono">submitGuess()</span> scores POT/PAN with <span className="font-mono">FHE.eq / FHE.min</span>.</li>
          <li>Encrypted pegs are decrypted only for you via the relayer.</li>
        </ol>
        {FHE_EXPLORER && (
          <a
            href={FHE_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs text-accent hover:underline"
          >
            CrackdFHE contract ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Guards
// ============================================================

function NotDeployed() {
  return (
    <Centered>
      <LockIcon large />
      <h1 className="mt-5 text-2xl font-semibold">Confidential mode isn’t live yet</h1>
      <p className="mt-3 text-fg-secondary max-w-md mx-auto">
        The CrackdFHE engine needs to be deployed to Sepolia. Deploy the
        contracts and set <span className="font-mono">VITE_CRACKD_FHE_ADDRESS</span>,
        then this challenge goes live.
      </p>
      <pre className="mt-5 text-left text-xs bg-ink-elevated border border-ink-border rounded-lg p-4 overflow-x-auto">
        cd contracts{"\n"}npm run deploy:sepolia
      </pre>
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
        You’ll seal an encrypted code on Sepolia, so you need a wallet connected.
      </p>
      <div className="mt-6 inline-flex">
        <WalletButton />
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto px-5 py-20 text-center">{children}</div>
  );
}

// ============================================================
// Bits
// ============================================================

/** Embossed 3D digit tile — matches the game board's tiles. */
function DigitTile({
  char,
  size = "md",
}: {
  char: string;
  size?: "sm" | "md";
}) {
  const dims = size === "sm" ? "w-8 h-10 text-base" : "w-12 h-14 text-2xl";
  return (
    <span
      className={`${dims} grid place-items-center rounded-xl font-mono font-semibold tabular-nums text-fg-primary shrink-0`}
      style={{
        background: "linear-gradient(160deg,#1E1329,#0D0816)",
        border: "1px solid rgba(255,0,168,0.16)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -3px 6px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)",
      }}
    >
      {char}
    </span>
  );
}

/** Four feedback pegs (pots, then pans, then misses) using the board's peg. */
function PegRow({ pots, pans }: { pots: number; pans: number }) {
  const pegs: ("pot" | "pan" | "miss")[] = [];
  for (let i = 0; i < pots; i++) pegs.push("pot");
  for (let i = 0; i < pans; i++) pegs.push("pan");
  while (pegs.length < 4) pegs.push("miss");
  return (
    <div className="flex items-center gap-1.5" aria-label={`${pots} POT, ${pans} PAN`}>
      {pegs.map((k, i) => (
        <Peg key={i} kind={k} delay={0.1 + i * 0.07} />
      ))}
    </div>
  );
}

function LockIcon({ large }: { large?: boolean }) {
  const s = large ? 40 : 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={large ? "mx-auto text-accent" : "text-accent"}
    >
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent shrink-0">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden className="text-fg-secondary shrink-0">
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
    return "Out of gas. Tap “Get test ETH” above, then try again.";
  if (msg && msg.length < 160) return msg;
  return "Something went wrong. Check your wallet & network and try again.";
}
