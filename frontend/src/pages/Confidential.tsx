/**
 * Confidential DUEL — the SAME game board as the normal game, but BOTH codes
 * are sealed on-chain as FHE ciphertext:
 *   • The Vault's code is sealed by the backend; you crack it.
 *   • YOUR code is sealed by your wallet; the Vault cracks it back.
 * Every guess is scored BY THE CONTRACT on the encrypted code and the pegs
 * decrypt only for the guesser. Same flow, same UI as /play — the
 * confidentiality (and the two-sided race) just happens underneath.
 */
import { useState, useCallback, useMemo } from "react";
import type { Signer } from "ethers";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useWalletStore } from "../store/walletStore";
import { getActiveProvider } from "../lib/wallet";
import {
  fheConfigured,
  scoreGuessOnChain,
  sealCode,
  decryptOwnCode,
  FHE_EXPLORER,
} from "../lib/fheGame";
import WalletButton from "../components/WalletButton";
import { Spinner } from "../components/Spinner";
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
  const [phase, setPhase] = useState<"start" | "playing" | "finished">("start");
  // vaultGameId  = the Vault's sealed code (you crack it)
  // playerGameId = your sealed code (the Vault cracks it)
  const [vaultGameId, setVaultGameId] = useState("");
  const [playerGameId, setPlayerGameId] = useState("");
  const [myCode, setMyCode] = useState("");
  const [localStatus, setLocalStatus] = useState<"setting_codes" | "active">(
    "setting_codes",
  );
  const [currentTurn, setCurrentTurn] = useState<"you" | "vault">("you");
  const [yourGuesses, setYourGuesses] = useState<Round[]>([]); // vs the Vault
  const [vaultGuesses, setVaultGuesses] = useState<Round[]>([]); // vs you
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"cracked" | "failed" | "draw" | null>(null);
  const [taunt, setTaunt] = useState<string | null>(null);

  const getSigner = useCallback(async (): Promise<Signer> => {
    const provider = await getActiveProvider();
    return provider.getSigner();
  }, []);

  // Start: the backend seals a fresh Vault code on-chain. You then set + seal
  // your own code in the board's "setting_codes" step.
  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    setStatus("Sealing the Vault's code on-chain…");
    try {
      const { gameId } = await api.confidentialNew(address);
      setVaultGameId(gameId);
      setPlayerGameId("");
      setMyCode("");
      setYourGuesses([]);
      setVaultGuesses([]);
      setResult(null);
      setCurrentTurn("you");
      setLocalStatus("setting_codes");
      setPhase("playing");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [address]);

  // Step 1 (from the Board): seal YOUR secret code on-chain from your wallet.
  const onSetCode = useCallback(
    async (raw: string): Promise<{ ok: boolean; error?: string }> => {
      const code = raw.replace(/\D/g, "").slice(0, 4);
      if (code.length !== 4) return { ok: false, error: "Enter 4 digits" };
      if (new Set(code).size !== 4)
        return { ok: false, error: "Use 4 different digits (no repeats)" };
      try {
        const signer = await getSigner();
        try {
          await api.gas(await signer.getAddress());
        } catch {
          /* best-effort gas top-up */
        }
        const { gameId } = await sealCode(signer, code.split("").map(Number));
        setPlayerGameId(gameId);
        setMyCode(code);
        setLocalStatus("active");
        setCurrentTurn("you");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: friendly(e) };
      }
    },
    [getSigner],
  );

  // Each round: YOUR guess vs the Vault's code, then the Vault's guess vs yours.
  const onGuess = useCallback(
    async (raw: string): Promise<{ ok: boolean; error?: string }> => {
      const code = raw.replace(/\D/g, "").slice(0, 4);
      if (code.length !== 4) return { ok: false, error: "Enter 4 digits" };
      try {
        const signer = await getSigner();
        try {
          await api.gas(await signer.getAddress());
        } catch {
          /* best-effort gas top-up */
        }

        // --- Your move: score against the Vault's sealed code ---
        const yr = await scoreGuessOnChain(
          signer,
          vaultGameId,
          code.split("").map(Number),
        );
        const myNext = [
          ...yourGuesses,
          { code, result: { pots: yr.pots, pans: yr.pans }, timestamp: Date.now() },
        ];
        setYourGuesses(myNext);
        if (yr.solved || yr.pots === 4) {
          setResult("cracked");
          setPhase("finished");
          return { ok: true };
        }

        // --- The Vault's move: it guesses against YOUR sealed code ---
        setCurrentTurn("vault");
        const history = vaultGuesses.map((g) => ({
          guess: g.code,
          pots: g.result.pots,
          pans: g.result.pans,
        }));
        const vg = await api.confidentialVaultGuess(playerGameId, history);
        setVaultGuesses((prev) => [
          ...prev,
          {
            code: vg.guess,
            result: { pots: vg.pots, pans: vg.pans },
            timestamp: Date.now(),
          },
        ]);
        setTaunt(vaultReaction(vg.pots, vg.pans, MAX_GUESSES - myNext.length));
        window.setTimeout(() => setTaunt(null), 6000);

        if (vg.solved || vg.pots === 4) {
          setResult("failed");
          setPhase("finished");
          return { ok: true };
        }
        if (myNext.length >= MAX_GUESSES) {
          setResult("draw");
          setPhase("finished");
          return { ok: true };
        }
        setCurrentTurn("you");
        return { ok: true };
      } catch (e) {
        setCurrentTurn("you");
        return { ok: false, error: friendly(e) };
      }
    },
    [vaultGameId, playerGameId, yourGuesses, vaultGuesses, getSigner],
  );

  // Synthetic view so we can reuse the exact normal-game Board.
  const view: SafeGameView = useMemo(
    () => ({
      gameId: vaultGameId,
      mode: "vs_ai_free",
      status: phase === "finished" ? "finished" : localStatus,
      you: "playerOne",
      youAre: address,
      opponent: "vault",
      // Your own secret, shown in the YOU tile once you've sealed it.
      yourCode: myCode || undefined,
      opponentCodeSet: true,
      yourGuesses,
      opponentGuesses: vaultGuesses, // codes visible so you see the Vault's guesses
      currentTurn: currentTurn === "you" ? "playerOne" : "playerTwo",
      winner:
        result === "cracked" ? address : result === "failed" ? "vault" : null,
      isDraw: result === "draw",
      stakeAmount: 0,
      stakeAsset: null,
      maxGuesses: MAX_GUESSES,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [
      vaultGameId,
      address,
      myCode,
      localStatus,
      phase,
      currentTurn,
      result,
      yourGuesses,
      vaultGuesses,
    ],
  );

  return (
    <div className="relative max-w-3xl mx-auto px-5 md:px-8 py-6">
      <PlayBackground intense={phase === "playing"} />
      <div className="relative z-10">
        {/* slim confidential ribbon + gas */}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
            <LockIcon /> Confidential Duel · Zama fhEVM
          </span>
          <div className="flex items-center gap-4">
            {playerGameId && (
              <RevealCodeChip getSigner={getSigner} gameId={playerGameId} />
            )}
            <GasChip address={address} />
          </div>
        </div>

        {phase === "start" && (
          <StartScreen onStart={start} busy={busy} status={status} error={error} />
        )}

        {phase === "playing" && (
          <div className="mt-4">
            <Board
              walletAddress={address}
              view={view}
              tauntLine={taunt}
              onSetCode={onSetCode}
              onGuess={onGuess}
            />
          </div>
        )}

        {phase === "finished" && result && (
          <FinishScreen
            result={result}
            attempts={yourGuesses.length}
            myCode={myCode}
            getSigner={getSigner}
            playerGameId={playerGameId}
            onReset={start}
          />
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
        A duel of <span className="text-accent">sealed codes.</span>
      </h1>
      <p className="mt-3 text-fg-secondary">
        You and the Vault each seal a secret 4-digit code on-chain as FHE
        ciphertext, then race to crack each other's. Every guess is scored{" "}
        <span className="text-fg-primary">by the contract, on the encrypted
        code</span> — neither code is ever revealed, not even to us. First to
        crack wins, within {MAX_GUESSES} guesses.
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
        className="btn-primary mt-7 cursor-pointer disabled:cursor-wait inline-flex items-center justify-center gap-2"
      >
        {busy && <Spinner />}
        {busy ? status ?? "Sealing the Vault…" : "Start the duel"}
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
  myCode,
  getSigner,
  playerGameId,
  onReset,
}: {
  result: "cracked" | "failed" | "draw";
  attempts: number;
  myCode: string;
  getSigner: () => Promise<Signer>;
  playerGameId: string;
  onReset: () => void;
}) {
  const win = result === "cracked";
  const title =
    result === "cracked"
      ? "You cracked the Vault."
      : result === "failed"
        ? "The Vault cracked you first."
        : "Stalemate — both codes held.";
  const body =
    result === "cracked"
      ? `You broke the Vault in ${attempts} guess${attempts === 1 ? "" : "es"} — before it broke you. Every peg was scored on the encrypted codes, which were never revealed on-chain.`
      : result === "failed"
        ? `The Vault decoded your sealed code before you cracked its. Both codes stayed encrypted the whole duel — the contract scored every move without ever exposing them.`
        : `Neither side cracked the other in ${MAX_GUESSES} guesses. Both codes stayed sealed on-chain the entire time.`;
  return (
    <div className="mt-12 max-w-xl mx-auto text-center animate-slide-up">
      <div className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-accent/10 text-accent">
        {win ? <UnlockIcon /> : <ShieldIcon />}
      </div>
      <h1 className="mt-5 text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
        {title}
      </h1>
      <p className="mt-3 text-fg-secondary">{body}</p>

      {myCode && (
        <div className="mt-6">
          <RevealCodeChip getSigner={getSigner} gameId={playerGameId} big />
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-3">
        <button onClick={onReset} className="btn-primary cursor-pointer">
          New duel
        </button>
        <Link to="/play" className="btn-ghost cursor-pointer">
          Classic modes
        </Link>
      </div>
    </div>
  );
}

/**
 * "Decrypt my code" — reads your OWN sealed code back from the chain as
 * ciphertext and user-decrypts it via the relayer. Proves the digits lived
 * on-chain encrypted the whole time (only you hold the ACL to reveal them).
 */
function RevealCodeChip({
  getSigner,
  gameId,
  big,
}: {
  getSigner: () => Promise<Signer>;
  gameId: string;
  big?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [code, setCode] = useState<string | null>(null);

  async function reveal() {
    if (state === "loading") return;
    setState("loading");
    try {
      const signer = await getSigner();
      const decrypted = await decryptOwnCode(signer, gameId);
      setCode(decrypted);
      setState("done");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  if (state === "done" && code) {
    return (
      <span
        className={`inline-flex items-center gap-2 ${big ? "text-base" : "text-xs"}`}
        title="Decrypted from on-chain ciphertext"
      >
        <UnlockIcon />
        <span className="text-fg-muted">Your sealed code:</span>
        <span className="font-mono tracking-[0.3em] text-accent">{code}</span>
      </span>
    );
  }

  return (
    <button
      onClick={reveal}
      disabled={state === "loading"}
      className={`inline-flex items-center gap-1.5 font-medium text-accent hover:underline disabled:opacity-60 cursor-pointer whitespace-nowrap ${
        big ? "text-sm" : "text-xs"
      }`}
    >
      {state === "loading" ? <Spinner size={12} /> : <LockIcon />}
      {state === "loading"
        ? "Decrypting…"
        : state === "error"
          ? "Couldn't decrypt — retry"
          : "Decrypt my code"}
    </button>
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
      className="text-xs font-medium text-accent hover:underline disabled:opacity-60 cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5"
    >
      {state === "sending" && <Spinner size={12} />}
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

/** The Vault's spoken reaction to a guess (English, based on how close). */
function vaultReaction(pots: number, pans: number, left: number): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]!;
  if (pots === 3)
    return pick([
      "One digit off. So close it hurts.",
      "Three in place… you're right on the edge.",
    ]);
  if (pots === 2)
    return pick(["Getting warm. Two locked in.", "Halfway there — keep pushing."]);
  if (pots === 1 || pans >= 2)
    return pick(["You're circling it now.", "Something's clicking. Barely."]);
  if (pots === 0 && pans === 0)
    return pick([
      "Ice cold. Nothing right.",
      "Not even close. The Vault holds.",
    ]);
  if (left <= 2)
    return pick(["Clock's running out on you.", "Two shots left. Make them count."]);
  return pick(["Is that your best guess?", "The Vault isn't impressed."]);
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
