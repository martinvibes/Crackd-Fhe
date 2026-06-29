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
import { Link } from "react-router-dom";
import { useWalletStore } from "../store/walletStore";
import { getActiveProvider } from "../lib/wallet";
import {
  fheConfigured,
  sealCode,
  scoreGuessOnChain,
  txExplorer,
  FHE_EXPLORER,
} from "../lib/fheGame";
import {
  allCodes,
  filterCandidates,
  pickGuess,
  isValidCode,
} from "../lib/solver";
import WalletButton from "../components/WalletButton";

const MAX_ROUNDS = 10;

interface Round {
  guess: string;
  pots: number;
  pans: number;
  solved: boolean;
  txHash: string;
}

type Phase = "set" | "playing" | "done";

export default function Confidential() {
  const address = useWalletStore((s) => s.address);

  if (!fheConfigured()) return <NotDeployed />;
  if (!address) return <SignedOut />;

  return <Challenge />;
}

// ============================================================
// Main challenge
// ============================================================

function Challenge() {
  const [phase, setPhase] = useState<Phase>("set");
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [gameId, setGameId] = useState("");
  const [sealTx, setSealTx] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [vaultGuess, setVaultGuess] = useState("");
  const [turn, setTurn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"vault_cracked" | "you_win" | null>(null);

  const getSigner = useCallback(async () => {
    const provider = await getActiveProvider();
    return provider.getSigner();
  }, []);

  const seal = useCallback(async () => {
    setError(null);
    const code = digits.join("");
    if (!isValidCode(code)) {
      setError("Pick 4 different digits (e.g. 5831).");
      return;
    }
    setBusy(true);
    try {
      const signer = await getSigner();
      setStatus("Encrypting your code with FHE…");
      setStatus("Sealing on-chain — confirm in your wallet…");
      const { gameId, txHash } = await sealCode(
        signer,
        code.split("").map(Number),
      );
      setGameId(gameId);
      setSealTx(txHash);
      const cands = allCodes();
      setCandidates(cands);
      setVaultGuess(pickGuess(cands, 0));
      setPhase("playing");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [digits, getSigner]);

  const scoreNext = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const signer = await getSigner();
      setStatus("Scoring on the encrypted code — confirm in your wallet…");
      const res = await scoreGuessOnChain(
        signer,
        gameId,
        vaultGuess.split("").map(Number),
      );
      const round: Round = {
        guess: vaultGuess,
        pots: res.pots,
        pans: res.pans,
        solved: res.solved,
        txHash: res.txHash,
      };
      const nextRounds = [...rounds, round];
      setRounds(nextRounds);

      if (res.solved || res.pots === 4) {
        setResult("vault_cracked");
        setPhase("done");
        return;
      }
      const nextTurn = turn + 1;
      if (nextTurn >= MAX_ROUNDS) {
        setResult("you_win");
        setPhase("done");
        return;
      }
      const remaining = filterCandidates(candidates, vaultGuess, {
        pots: res.pots,
        pans: res.pans,
      });
      setCandidates(remaining);
      setVaultGuess(pickGuess(remaining, nextTurn));
      setTurn(nextTurn);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [gameId, vaultGuess, rounds, candidates, turn, getSigner]);

  const reset = useCallback(() => {
    setPhase("set");
    setDigits(["", "", "", ""]);
    setGameId("");
    setSealTx("");
    setCandidates([]);
    setRounds([]);
    setVaultGuess("");
    setTurn(0);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-12">
      <Header />

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Left: the game */}
        <div className="space-y-5">
          {phase === "set" && (
            <SetCard
              digits={digits}
              setDigits={setDigits}
              onSeal={seal}
              busy={busy}
              status={status}
            />
          )}

          {phase !== "set" && (
            <SealedBanner code={digits.join("")} sealTx={sealTx} gameId={gameId} />
          )}

          {phase === "playing" && (
            <PlayCard
              vaultGuess={vaultGuess}
              turn={turn}
              onScore={scoreNext}
              busy={busy}
              status={status}
            />
          )}

          {phase === "done" && result && (
            <ResultCard result={result} rounds={rounds.length} onReset={reset} />
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
  );
}

// ============================================================
// Pieces
// ============================================================

function Header() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
        <LockIcon /> Confidential · Zama fhEVM
      </div>
      <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
        Your code, sealed on-chain.
      </h1>
      <p className="mt-2 text-fg-secondary max-w-2xl">
        Seal a secret code as ciphertext, then watch The Vault try to crack it —
        every guess scored <span className="text-fg-primary">by the contract,
        on the encrypted code</span>. Your digits never touch the chain in the
        clear. Not even we can see them.
      </p>
    </div>
  );
}

function SetCard({
  digits,
  setDigits,
  onSeal,
  busy,
  status,
}: {
  digits: string[];
  setDigits: (v: string[]) => void;
  onSeal: () => void;
  busy: boolean;
  status: string | null;
}) {
  const slots = [0, 1, 2, 3];
  function setAt(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
  }
  function randomize() {
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setDigits(pool.slice(0, 4).map(String));
  }

  return (
    <div className="panel-elevated p-6">
      <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        Step 1
      </div>
      <h2 className="mt-1 text-xl font-semibold">Set your secret code</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Four different digits. This is what gets encrypted.
      </p>

      <div className="mt-5 flex items-center gap-3">
        {slots.map((i) => (
          <input
            key={i}
            inputMode="numeric"
            maxLength={1}
            value={digits[i] ?? ""}
            onChange={(e) => setAt(i, e.target.value)}
            className="w-14 h-16 text-center text-2xl font-semibold tabular-nums rounded-xl bg-ink-elevated border border-ink-border focus:border-accent/60 outline-none transition-colors"
          />
        ))}
        <button
          onClick={randomize}
          className="ml-2 text-xs text-fg-muted hover:text-fg-secondary cursor-pointer underline underline-offset-4"
        >
          randomize
        </button>
      </div>

      <button
        onClick={onSeal}
        disabled={busy}
        className="btn-primary mt-6 w-full cursor-pointer disabled:cursor-wait inline-flex items-center justify-center gap-2"
      >
        {busy ? (
          status ?? "Sealing…"
        ) : (
          <>
            <LockIcon /> Seal on-chain
          </>
        )}
      </button>
    </div>
  );
}

function SealedBanner({
  code,
  sealTx,
  gameId,
}: {
  code: string;
  sealTx: string;
  gameId: string;
}) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <LockIcon />
          <span className="text-fg-secondary">Your code</span>
          <span className="font-mono font-semibold tracking-[0.3em] text-fg-primary">
            {code}
          </span>
          <span className="text-xs text-fg-muted">(only you see this)</span>
        </div>
        {sealTx && (
          <a
            href={txExplorer(sealTx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline whitespace-nowrap"
          >
            sealed on-chain ↗
          </a>
        )}
      </div>
      <div className="mt-2 text-[11px] text-fg-muted font-mono truncate">
        game {gameId}
      </div>
    </div>
  );
}

function PlayCard({
  vaultGuess,
  turn,
  onScore,
  busy,
  status,
}: {
  vaultGuess: string;
  turn: number;
  onScore: () => void;
  busy: boolean;
  status: string | null;
}) {
  return (
    <div className="panel-elevated p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
            Step 2 · The Vault is cracking
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            Guess {turn + 1} of {MAX_ROUNDS}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {vaultGuess.split("").map((d, i) => (
            <span
              key={i}
              className="w-11 h-12 grid place-items-center text-xl font-semibold tabular-nums rounded-lg bg-ink-raised border border-ink-border"
            >
              {d}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-4 text-sm text-fg-muted">
        The Vault proposes this guess. Scoring runs{" "}
        <span className="text-accent">inside the contract, on your encrypted
        code</span> — the result comes back encrypted and is decrypted just for
        you.
      </p>

      <button
        onClick={onScore}
        disabled={busy}
        className="btn-primary mt-5 w-full cursor-pointer disabled:cursor-wait"
      >
        {busy ? status ?? "Scoring on ciphertext…" : "Score this guess on-chain"}
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
            className="flex items-center gap-3 rounded-lg bg-ink-elevated border border-ink-border px-3 py-2"
          >
            <span className="text-xs text-fg-muted w-6">#{i + 1}</span>
            <span className="font-mono font-semibold tracking-[0.25em] text-fg-primary">
              {r.guess}
            </span>
            <span className="flex items-center gap-1 ml-1">
              {Array.from({ length: r.pots }).map((_, k) => (
                <Peg key={`pot${k}`} kind="pot" />
              ))}
              {Array.from({ length: r.pans }).map((_, k) => (
                <Peg key={`pan${k}`} kind="pan" />
              ))}
              {r.pots + r.pans === 0 && (
                <span className="text-xs text-fg-muted">no match</span>
              )}
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
  rounds,
  onReset,
}: {
  result: "vault_cracked" | "you_win";
  rounds: number;
  onReset: () => void;
}) {
  const win = result === "you_win";
  return (
    <div
      className={`panel-elevated p-6 ${win ? "border-accent/40" : "border-ink-border"}`}
    >
      <div className="text-3xl font-semibold inline-flex items-center gap-2.5">
        {win ? (
          <>
            <ShieldIcon /> Your code held.
          </>
        ) : (
          <>
            The Vault cracked it. <UnlockIcon />
          </>
        )}
      </div>
      <p className="mt-2 text-fg-secondary">
        {win
          ? `The Vault used all ${rounds} guesses and never saw your digits — because nobody could.`
          : `Cracked in ${rounds} guesses — scored entirely on the encrypted code. Your digits were never exposed on-chain.`}
      </p>
      <div className="mt-5 flex gap-3">
        <button onClick={onReset} className="btn-primary cursor-pointer">
          Play again
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

function Peg({ kind }: { kind: "pot" | "pan" }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${
        kind === "pot" ? "bg-accent" : "border border-accent/70"
      }`}
      title={kind === "pot" ? "POT — right digit, right place" : "PAN — right digit, wrong place"}
    />
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
  if (msg && /insufficient funds/i.test(msg)) return "Not enough Sepolia ETH for gas. Grab some from a faucet.";
  if (msg && msg.length < 160) return msg;
  return "Something went wrong. Check your wallet & network and try again.";
}
