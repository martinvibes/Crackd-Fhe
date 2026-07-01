/**
 * Ambient backdrop for the /play screens — a "cipher field":
 *   - a faint blueprint grid,
 *   - two slow-drifting magenta/violet glows,
 *   - a twinkling starfield,
 *   - faint monospace digits (0-9) that slowly rise and fade — a nod to the
 *     code-breaking theme, so it's ours and not a generic starfield.
 *
 * Pure CSS animations (GPU-friendly), positions memoised once. Sits fixed
 * behind everything on the play routes. `intense` bumps the glow on active turns.
 */
import { useMemo } from "react";

export function PlayBackground({ intense = false }: { intense?: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1 + Math.random() * 2,
        delay: Math.random() * 6,
        dur: 3 + Math.random() * 5,
      })),
    [],
  );

  const digits = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: i,
        char: String(Math.floor(Math.random() * 10)),
        left: Math.random() * 100,
        delay: Math.random() * 12,
        dur: 12 + Math.random() * 10,
        size: 12 + Math.random() * 20,
      })),
    [],
  );

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* blueprint grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,0,168,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,0,168,0.045) 1px, transparent 1px)",
          backgroundSize: "76px 76px",
          maskImage:
            "radial-gradient(ellipse 95% 75% at 50% 35%, black 5%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 95% 75% at 50% 35%, black 5%, transparent 78%)",
        }}
      />

      {/* drifting glows */}
      <div
        className="absolute rounded-full blur-3xl"
        style={{
          width: 560,
          height: 560,
          top: "-10%",
          left: "-8%",
          background: `radial-gradient(circle, rgba(255,0,168,${intense ? 0.15 : 0.09}), transparent 70%)`,
          animation: "crackd-drift-a 20s ease-in-out infinite",
        }}
      />
      <div
        className="absolute rounded-full blur-3xl"
        style={{
          width: 480,
          height: 480,
          bottom: "-12%",
          right: "-6%",
          background: `radial-gradient(circle, rgba(130,0,210,${intense ? 0.13 : 0.08}), transparent 70%)`,
          animation: "crackd-drift-b 26s ease-in-out infinite",
        }}
      />

      {/* twinkling starfield */}
      {stars.map((s) => (
        <span
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            background: s.id % 5 === 0 ? "#FF6FD0" : "rgba(255,255,255,0.75)",
            boxShadow: s.id % 5 === 0 ? "0 0 6px rgba(255,0,168,0.8)" : "none",
            animation: `crackd-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* rising cipher digits */}
      {digits.map((d) => (
        <span
          key={d.id}
          className="absolute font-mono font-semibold tabular-nums"
          style={{
            left: `${d.left}%`,
            bottom: "-8%",
            fontSize: d.size,
            color: "rgba(255,0,168,0.14)",
            animation: `crackd-rise ${d.dur}s linear ${d.delay}s infinite`,
          }}
        >
          {d.char}
        </span>
      ))}

      <style>{`
        @keyframes crackd-drift-a { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px,40px); } }
        @keyframes crackd-drift-b { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-52px,-30px); } }
        @keyframes crackd-twinkle {
          0%,100% { opacity: 0.15; transform: translateY(0); }
          50% { opacity: 0.9; transform: translateY(-4px); }
        }
        @keyframes crackd-rise {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-108vh); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="crackd-"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
