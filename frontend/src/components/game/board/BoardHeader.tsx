/**
 * Header above the guess timeline:
 *   1. TurnBadge — a live, colour-coded pill.
 *   2. Compact statement — the current "act".
 *   3. Player strip — You vs The Vault tiles.
 *   4. Vault taunt — an opaque speech bubble below the strip, tail pointing
 *      up at The Vault tile (no overlap with the tile's own content).
 */
import { AnimatePresence, motion } from "framer-motion";
import type { SafeGameView } from "../../../lib/socket";
import { PlayerTile } from "./PlayerTile";

export function BoardHeader({
  view,
  walletAddress,
  tauntLine,
}: {
  view: SafeGameView;
  walletAddress: string;
  tauntLine: string | null;
}) {
  const yours = view.currentTurn === view.you && view.status === "active";
  const needsCode = view.status === "setting_codes";
  const isAi = view.mode === "vs_ai_free" || view.mode === "vs_ai_staked";

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-center">
        <TurnBadge state={needsCode ? "setup" : yours ? "you" : "opponent"} />
      </div>

      {/* Compact statement — smaller than the landing hero so the board fits */}
      <div className="mt-3 text-center">
        <div
          className="font-semibold leading-[0.95] tracking-[-0.03em]"
          style={{ fontSize: "clamp(26px, 4.2vw, 44px)" }}
        >
          {needsCode ? (
            <>
              Pick your <span className="text-accent">secret.</span>
            </>
          ) : yours ? (
            <>
              Make a <span className="text-accent">crack.</span>
            </>
          ) : (
            <>
              {isAi ? "The Vault" : "Opponent"}
              <span className="text-fg-secondary italic"> is thinking…</span>
            </>
          )}
        </div>
      </div>

      {/* Player strip */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:gap-4 relative">
        <PlayerTile
          label="You"
          address={walletAddress}
          code={view.yourCode}
          active={yours}
          guessCount={view.yourGuesses.length}
        />
        <span
          className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 items-center justify-center rounded-full bg-ink text-[10px] uppercase tracking-[0.25em] text-fg-muted border border-ink-border z-10"
          aria-hidden
        >
          vs
        </span>
        <PlayerTile
          label={view.opponent === "vault" ? "The Vault" : "Opponent"}
          address={view.opponent ?? "waiting"}
          code={view.opponentCodeSet ? "••••" : "——"}
          active={!yours && view.status === "active"}
          guessCount={view.opponentGuesses.length}
          rtl
          isVault={isAi}
          thinking={isAi && !yours && view.status === "active"}
        />
      </div>

      {/* Vault taunt — opaque bubble under the strip, aligned to the Vault side */}
      <div className="grid grid-cols-2 gap-2 md:gap-4">
        <div />
        <AnimatePresence mode="wait">
          {isAi && tauntLine && (
            <motion.div
              key={tauntLine}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 26 }}
              className="relative mt-2"
            >
              {/* Tail pointing up at the Vault tile */}
              <div
                className="absolute right-6 -top-1.5 w-3 h-3 rotate-45 border-t border-l"
                style={{ background: "#150c1f", borderColor: "rgba(255,0,168,0.45)" }}
              />
              <div
                className="rounded-2xl px-3.5 py-2.5 border text-sm leading-snug"
                style={{
                  background: "linear-gradient(160deg, #1a1026, #120a1b)",
                  borderColor: "rgba(255,0,168,0.4)",
                  boxShadow: "0 14px 34px -18px rgba(255,0,168,0.7)",
                }}
              >
                <div className="text-[9px] uppercase tracking-[0.28em] text-accent/90 mb-0.5">
                  The Vault
                </div>
                <div className="text-fg-primary">{tauntLine}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Turn pill — bigger, clearer, glowing on your turn.
 */
function TurnBadge({ state }: { state: "setup" | "you" | "opponent" }) {
  if (state === "you") {
    return (
      <motion.span
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 22 }}
        className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-[0.28em] border"
        style={{
          background: "linear-gradient(180deg, rgba(255,0,168,0.22), rgba(255,0,168,0.08))",
          borderColor: "rgba(255,0,168,0.55)",
          color: "#FF75CF",
          boxShadow: "0 0 24px -6px rgba(255,0,168,0.55)",
        }}
      >
        <PulsingDot />
        Your turn
      </motion.span>
    );
  }
  if (state === "setup") {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-[0.28em] border border-ink-border bg-ink-raised text-fg-secondary">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-muted" />
        Setting codes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-[0.28em] border border-ink-border bg-ink-raised text-fg-secondary">
      <span className="inline-flex">
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.15s] ml-0.5" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce ml-0.5" />
      </span>
      Vault's turn
    </span>
  );
}

function PulsingDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className="absolute inline-flex h-full w-full rounded-full animate-ping"
        style={{ background: "#FF00A8" }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: "#FF00A8" }}
      />
    </span>
  );
}
