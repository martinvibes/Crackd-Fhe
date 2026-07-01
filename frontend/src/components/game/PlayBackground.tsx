/**
 * Ambient backdrop for the /play screens — a floating "cipher field":
 *   - a faint blueprint grid,
 *   - two slow-drifting magenta/violet glows,
 *   - a twinkling starfield scattered everywhere,
 *   - monospace digits (0-9) scattered across the whole screen that gently
 *     float around and pulse — a nod to the code-breaking theme.
 *
 * Pure CSS animations (GPU-friendly), positions memoised once. Sits fixed
 * behind everything. `intense` bumps the glow on active turns.
 */
import { useMemo } from "react";

const FLOATS = ["a", "b", "c", "d"] as const;

export function PlayBackground({ intense = false }: { intense?: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 54 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1 + Math.random() * 2.4,
        delay: Math.random() * 6,
        dur: 3 + Math.random() * 5,
        magenta: i % 4 === 0,
      })),
    [],
  );

  // Digits scattered across the whole viewport, each drifting on one of a few
  // float paths so the motion looks organic rather than uniform.
  const digits = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        char: String(Math.floor(Math.random() * 10)),
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 12 + Math.random() * 26,
        delay: Math.random() * 8,
        dur: 7 + Math.random() * 10,
        float: FLOATS[i % FLOATS.length],
        magenta: i % 3 !== 0,
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
            "radial-gradient(ellipse 95% 80% at 50% 40%, black 10%, transparent 82%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 95% 80% at 50% 40%, black 10%, transparent 82%)",
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
          key={`s${s.id}`}
          className="absolute rounded-full"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            background: s.magenta ? "#FF6FD0" : "rgba(255,255,255,0.8)",
            boxShadow: s.magenta ? "0 0 6px rgba(255,0,168,0.85)" : "none",
            animation: `crackd-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* floating cipher digits, scattered all around */}
      {digits.map((d) => (
        <span
          key={`d${d.id}`}
          className="absolute font-mono font-semibold tabular-nums select-none"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            fontSize: d.size,
            color: d.magenta ? "rgba(255,0,168,0.9)" : "rgba(255,255,255,0.9)",
            animation: `crackd-float-${d.float} ${d.dur}s ease-in-out ${d.delay}s infinite`,
          }}
        >
          {d.char}
        </span>
      ))}

      <style>{`
        @keyframes crackd-drift-a { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px,40px); } }
        @keyframes crackd-drift-b { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-52px,-30px); } }
        @keyframes crackd-twinkle {
          0%,100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes crackd-float-a {
          0%,100% { transform: translate(0,0); opacity: 0.18; }
          50% { transform: translate(14px,-20px); opacity: 0.5; }
        }
        @keyframes crackd-float-b {
          0%,100% { transform: translate(0,0); opacity: 0.15; }
          50% { transform: translate(-18px,16px); opacity: 0.42; }
        }
        @keyframes crackd-float-c {
          0%,100% { transform: translate(0,0); opacity: 0.2; }
          33% { transform: translate(16px,14px); opacity: 0.46; }
          66% { transform: translate(-14px,-16px); opacity: 0.32; }
        }
        @keyframes crackd-float-d {
          0%,100% { transform: translate(0,0) rotate(0deg); opacity: 0.16; }
          50% { transform: translate(-12px,-14px) rotate(8deg); opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="crackd-"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
