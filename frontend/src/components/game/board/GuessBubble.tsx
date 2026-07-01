/**
 * A single row in the guess timeline — a slotted result card.
 *
 * Mine align right with a magenta tint, the opponent's align left in
 * neutral ink. Each guess is rendered as four mini 3D digit tiles plus a
 * cluster of embossed feedback pegs (POT = filled magenta, PAN = hollow
 * ring, miss = recessed dot). The whole row reveals with a spring slide
 * and the pegs pop in with a staggered scale so a fresh result feels
 * physical — like tumblers falling into place.
 */
import { motion } from "framer-motion";
import type { TimelineItem } from "./timeline";

export function GuessBubble({ side, code, result, redacted }: TimelineItem) {
  const mine = side === "you";
  const cracked = result.pots === 4;
  return (
    <motion.div
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
      initial={{ opacity: 0, y: 14, rotateX: -8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      style={{ perspective: 800 }}
    >
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 border ${
          mine
            ? cracked
              ? "border-accent/60"
              : "border-accent/25"
            : "border-ink-border"
        }`}
        style={{
          background: mine
            ? cracked
              ? "linear-gradient(160deg, rgba(255,0,168,0.22), rgba(255,0,168,0.06))"
              : "linear-gradient(160deg, rgba(255,0,168,0.08), rgba(255,0,168,0.02))"
            : "linear-gradient(160deg, #17101F, #0C0713)",
          boxShadow: cracked
            ? "0 0 32px -8px rgba(255,0,168,0.5), inset 0 1px 0 rgba(255,255,255,0.06)"
            : "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 28px -20px rgba(0,0,0,0.8)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] uppercase tracking-[0.25em] ${mine ? "text-accent" : "text-fg-muted"}`}
          >
            {mine ? "You" : "The Vault"}
          </span>
          {cracked && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.25em] text-accent font-semibold">
              <CrackIcon />
              Cracked
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {code.split("").map((c, i) => (
              <MiniTile
                key={i}
                index={i}
                char={redacted ? "·" : c}
                redacted={redacted}
                mine={mine}
              />
            ))}
          </div>
          <PegCluster pots={result.pots} pans={result.pans} />
        </div>
      </div>
    </motion.div>
  );
}

/** A small embossed digit tile for the timeline rows. */
function MiniTile({
  index,
  char,
  redacted,
  mine,
}: {
  index: number;
  char: string;
  redacted?: boolean;
  mine: boolean;
}) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.6, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 480,
        damping: 22,
        delay: 0.04 * index,
      }}
      className="w-8 h-10 grid place-items-center rounded-lg font-mono text-base tabular-nums text-fg-primary"
      style={{
        background: redacted
          ? "linear-gradient(160deg, #150E1E, #0A0610)"
          : mine
            ? "linear-gradient(160deg, #1E1329, #0E0817)"
            : "linear-gradient(160deg, #191122, #0C0713)",
        border: "1px solid rgba(255,0,168,0.14)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -3px 6px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.5)",
        color: redacted ? "#5E5568" : undefined,
      }}
    >
      {char}
    </motion.span>
  );
}

/**
 * Feedback pegs, left-to-right. POT (right place) = glossy filled magenta
 * peg with glow; PAN (wrong place) = hollow magenta ring; miss = recessed
 * dark socket. Each pops in with a staggered spring.
 */
function PegCluster({ pots, pans }: { pots: number; pans: number }) {
  const total = 4;
  const pegs: ("pot" | "pan" | "miss")[] = [];
  for (let i = 0; i < pots; i++) pegs.push("pot");
  for (let i = 0; i < pans; i++) pegs.push("pan");
  while (pegs.length < total) pegs.push("miss");
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${pots} POT, ${pans} PAN`}
    >
      {pegs.map((d, i) => (
        <Peg key={i} kind={d} delay={0.18 + i * 0.08} />
      ))}
    </div>
  );
}

export function Peg({
  kind,
  delay = 0,
  size = 12,
}: {
  kind: "pot" | "pan" | "miss";
  delay?: number;
  size?: number;
}) {
  const title =
    kind === "pot"
      ? "POT · right place"
      : kind === "pan"
        ? "PAN · wrong place"
        : "miss";

  const style: React.CSSProperties =
    kind === "pot"
      ? {
          width: size,
          height: size,
          background:
            "radial-gradient(circle at 32% 28%, #FF6FD0 0%, #FF00A8 42%, #B00074 100%)",
          boxShadow:
            "0 0 8px rgba(255,0,168,0.7), inset 0 1px 1px rgba(255,255,255,0.55), inset 0 -1px 2px rgba(0,0,0,0.4)",
        }
      : kind === "pan"
        ? {
            width: size,
            height: size,
            background: "radial-gradient(circle at 50% 50%, #0A0610 55%, transparent 56%)",
            border: "1.6px solid rgba(255,0,168,0.7)",
            boxShadow:
              "0 0 6px rgba(255,0,168,0.35), inset 0 1px 1px rgba(255,255,255,0.08)",
          }
        : {
            // Miss — a clearly visible muted grey tumbler (not a near-black
            // socket that reads as empty).
            width: size,
            height: size,
            background: "radial-gradient(circle at 35% 30%, #6B6472, #3A343F)",
            boxShadow:
              "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 2px rgba(0,0,0,0.55)",
          };

  return (
    <motion.span
      className="rounded-full shrink-0"
      title={title}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 600, damping: 18, delay }}
      style={style}
    />
  );
}

function CrackIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}
