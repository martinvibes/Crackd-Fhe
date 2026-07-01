/**
 * Mode picker — the first screen at /play. Four modes, each with a dial-
 * based icon that echoes the home page's signature safe dial. Cards are
 * embossed and tilt in 3D on hover.
 */
import { motion } from "framer-motion";

export type Mode =
  | "vs_ai_free"
  | "vs_ai_staked"
  | "pvp_casual"
  | "pvp_staked";

interface ModeCard {
  m: Mode;
  t: string;
  d: string;
  icon: React.ReactNode;
  staked?: boolean;
  /** If true, disable the card and show a "coming soon" overlay. */
  comingSoon?: boolean;
}

const MODE_CARDS: ModeCard[] = [
  {
    m: "vs_ai_free",
    t: "vs AI · free",
    d: "No wallet, no stake. Warm up.",
    icon: <IconSoloDial />,
  },
  {
    m: "vs_ai_staked",
    t: "vs AI · staked",
    d: "Pay to play. Win up to 2× from the pool.",
    icon: <IconStakedDial />,
    staked: true,
  },
  {
    m: "pvp_casual",
    t: "Multiplayer · casual",
    d: "Challenge a friend. No money.",
    icon: <IconDuo />,
  },
  {
    m: "pvp_staked",
    t: "Multiplayer · staked",
    d: "1v1, winner takes the pot. 2.5% fee.",
    icon: <IconStakedDuo />,
    staked: true,
  },
];

export function ModePicker({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="animate-fade-in">
      <div className="text-[11px] uppercase tracking-[0.22em] text-fg-muted">
        Start a game
      </div>
      <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-[-0.03em]">
        Pick how you want to play.
      </h1>

      <div
        className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3"
        style={{ perspective: 1200 }}
      >
        {MODE_CARDS.map(({ m, t, d, icon, staked, comingSoon }) => (
          <motion.button
            key={m}
            onClick={() => !comingSoon && onPick(m)}
            disabled={comingSoon}
            whileHover={comingSoon ? undefined : { y: -6, rotateX: 5, rotateY: -3 }}
            whileTap={comingSoon ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group relative text-left p-5 md:p-6 rounded-2xl border overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            style={{
              transformStyle: "preserve-3d",
              transformPerspective: 1000,
              background: "linear-gradient(165deg, #17101F 0%, #0A0611 100%)",
              borderColor: staked
                ? "rgba(255,0,168,0.28)"
                : "rgba(255,255,255,0.08)",
              boxShadow: staked
                ? "0 22px 48px -26px rgba(255,0,168,0.5), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "0 22px 48px -30px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            {/* glossy top sheen */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-24 opacity-70"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.055), transparent)",
              }}
            />
            {/* staked corner glow */}
            {staked && !comingSoon && (
              <div
                aria-hidden
                className="absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70"
                style={{ background: "radial-gradient(circle, rgba(255,0,168,0.18), transparent 70%)" }}
              />
            )}

            <div
              className="relative flex items-start justify-between gap-4"
              style={{ transform: "translateZ(28px)" }}
            >
              <span
                className="inline-flex items-center justify-center w-12 h-12 rounded-xl"
                style={{
                  background: staked
                    ? "linear-gradient(160deg, rgba(255,0,168,0.22), rgba(255,0,168,0.05))"
                    : "linear-gradient(160deg, #1C1426, #0D0814)",
                  border: staked
                    ? "1px solid rgba(255,0,168,0.35)"
                    : "1px solid rgba(255,255,255,0.07)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -3px 6px rgba(0,0,0,0.5)",
                  color: staked ? "#FF6FD0" : "var(--fg-secondary, #B8B0C2)",
                }}
              >
                {icon}
              </span>
              <span
                className={`text-[9px] uppercase tracking-[0.24em] pt-1 ${
                  comingSoon
                    ? "text-fg-muted"
                    : staked
                      ? "text-accent/90"
                      : "text-fg-muted"
                }`}
              >
                {comingSoon ? "Coming soon" : staked ? "Real stakes" : "No wager"}
              </span>
            </div>

            <div
              className="relative"
              style={{ transform: "translateZ(16px)" }}
            >
              <div className="mt-6 text-xs uppercase tracking-[0.2em] text-fg-muted">
                {t}
              </div>
              <div className="mt-1.5 text-base md:text-[17px] font-medium text-fg-primary leading-snug">
                {d}
              </div>
              {!comingSoon ? (
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-fg-secondary group-hover:text-fg-primary transition-colors">
                  Start
                  <span className="transition-transform group-hover:translate-x-0.5">
                    <ArrowGlyph />
                  </span>
                </div>
              ) : (
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  Unlocking post-launch
                </div>
              )}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function ArrowGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

// ------------------------------------------------------------
// Mode icons — geometric glyphs that riff on the home page's dial.
// ------------------------------------------------------------

function IconSoloDial() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <line
        x1="12"
        y1="3"
        x2="12"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconStakedDial() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10" cy="13" r="7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="13" r="2" fill="currentColor" />
      <rect
        x="17"
        y="3"
        width="5"
        height="5"
        fill="currentColor"
        transform="rotate(45 19.5 5.5)"
      />
    </svg>
  );
}

function IconDuo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconStakedDuo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="14" r="4.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="14" cy="14" r="4.8" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="17.5"
        y="3"
        width="4.5"
        height="4.5"
        fill="currentColor"
        transform="rotate(45 19.75 5.25)"
      />
    </svg>
  );
}

// Helper the Game page uses to label modes in titles.
export function modeLabel(m: Mode): string {
  switch (m) {
    case "vs_ai_free":
      return "vs AI · free";
    case "vs_ai_staked":
      return "vs AI · staked";
    case "pvp_casual":
      return "Multiplayer · casual";
    case "pvp_staked":
      return "Multiplayer · staked";
  }
}
