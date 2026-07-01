/**
 * "The Vault is typing…" — a chat-style typing indicator shown on the
 * opponent's (left) side of the timeline while the Vault computes its next
 * guess on-chain. Matches the neutral-ink styling of the Vault's guess
 * bubbles so it reads as the same speaker, mid-thought.
 */
import { motion } from "framer-motion";

export function TypingBubble() {
  return (
    <motion.div
      className="flex justify-start"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      style={{ perspective: 800 }}
    >
      <div
        className="max-w-[92%] rounded-2xl px-4 py-3 border border-ink-border"
        style={{
          background: "linear-gradient(160deg, #17101F, #0C0713)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 28px -20px rgba(0,0,0,0.8)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.25em] text-fg-muted">
            The Vault
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5" aria-label="The Vault is thinking">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background:
                  "radial-gradient(circle at 35% 30%, #FF6FD0, #FF00A8 60%, #B00074)",
                boxShadow: "0 0 6px rgba(255,0,168,0.5)",
              }}
              animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.16,
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
