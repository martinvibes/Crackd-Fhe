/**
 * Player tile in the board header — a small vault console for each side.
 *
 * "You" reads clean and static. "The Vault" becomes a living opponent: a
 * pulsing magenta core spins up while it's thinking, and its taunt (when
 * present) surfaces as a speech bubble tethered to the tile with a little
 * tail pointing back at it.
 *
 * Mobile layout stacks address above guess-count so a short address
 * doesn't fight the count on the same row. Code tiles shrink below sm.
 */
import { motion } from "framer-motion";
import { shortAddress } from "../../../lib/evm";

export function PlayerTile({
  label,
  address,
  code,
  active,
  guessCount,
  rtl,
  isVault,
  thinking,
}: {
  label: string;
  address: string;
  code?: string;
  active?: boolean;
  guessCount: number;
  /** Mirror the layout for the opponent tile. */
  rtl?: boolean;
  /** This tile is The Vault (AI opponent) — gets the living-core treatment. */
  isVault?: boolean;
  /** The Vault is currently taking its turn. */
  thinking?: boolean;
}) {
  const display =
    address === "waiting"
      ? "waiting…"
      : address.startsWith("0x")
        ? shortAddress(address, 4)
        : address;

  return (
    <div className="relative min-w-0">
      <div
        className="panel p-3 md:p-4 min-w-0 transition-all relative overflow-hidden"
        style={
          active
            ? {
                borderColor: "rgba(255,0,168,0.4)",
                boxShadow:
                  "0 0 26px -10px rgba(255,0,168,0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
              }
            : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }
        }
      >
        <div
          className={`flex items-center gap-2 ${rtl ? "flex-row-reverse" : ""}`}
        >
          {isVault ? (
            <VaultCore thinking={!!thinking} />
          ) : (
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? "bg-accent animate-pulse" : "bg-fg-muted"}`}
            />
          )}
          <span className="text-[10px] uppercase tracking-[0.22em] text-fg-muted truncate">
            {label}
          </span>
        </div>

        {/* Address + guess count. Stacks on mobile, spreads on md+. */}
        <div
          className={`mt-2 flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-3 ${
            rtl ? "md:flex-row-reverse" : ""
          }`}
        >
          <span className="font-mono text-xs md:text-sm text-fg-primary truncate">
            {display}
          </span>
          <span className="font-mono text-[10px] md:text-xs text-fg-muted whitespace-nowrap">
            {guessCount} guess{guessCount === 1 ? "" : "es"}
          </span>
        </div>

        {/* Code tiles — embossed slots */}
        <div
          className={`mt-2.5 md:mt-3 flex items-center gap-1 ${rtl ? "justify-end" : ""}`}
        >
          {(code ?? "····").split("").map((c, i) => (
            <span
              key={i}
              className="w-6 h-8 md:w-7 md:h-9 grid place-items-center rounded-md font-mono text-[13px] md:text-[15px] tabular-nums text-fg-primary"
              style={{
                background: "linear-gradient(160deg, #1A1124, #0B0713)",
                border: "1px solid rgba(255,0,168,0.13)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -3px 5px rgba(0,0,0,0.5)",
              }}
            >
              {c === "•" ? "·" : c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The Vault's living core — a magenta reactor that idles calmly and spins
 * up (faster pulse + rotating glow ring) while it's taking its turn.
 */
function VaultCore({ thinking }: { thinking: boolean }) {
  return (
    <span className="relative inline-grid place-items-center h-3.5 w-3.5 shrink-0">
      {thinking && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(255,0,168,0) 0%, rgba(255,0,168,0.8) 70%, rgba(255,0,168,0) 100%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: "linear", duration: 1.4 }}
        />
      )}
      <motion.span
        className="relative h-2 w-2 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 32% 28%, #FF6FD0, #FF00A8 55%, #B00074)",
          boxShadow: "0 0 8px rgba(255,0,168,0.8)",
        }}
        animate={
          thinking
            ? { scale: [1, 1.35, 1], opacity: [1, 0.7, 1] }
            : { scale: 1, opacity: 0.85 }
        }
        transition={
          thinking
            ? { repeat: Infinity, duration: 0.9, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      />
    </span>
  );
}
