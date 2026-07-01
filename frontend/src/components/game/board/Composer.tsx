/**
 * Sticky composer at the bottom of the board.
 *
 * OTP-style: four individual digit inputs with auto-advance on entry
 * and backspace-to-previous on delete. Eliminates the footgun of typing
 * a single digit into an invisible buffer and seeing it multiply onto
 * every tile, and it makes the field feel purpose-built for 4-digit
 * codes instead of a generic text box.
 *
 * Typing a digit that's already present in the code is allowed at the
 * input level (so you can overwrite a slot); the server-side validator
 * will flag duplicates when you submit.
 */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { sounds } from "../../../lib/sounds";

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  submitLabel,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  submitLabel: string;
  error: string | null;
}) {
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Keep focus on the first empty slot — on mount, when the board becomes
  // interactive, as you type (auto-advance), and after a submit clears the
  // value (so the next guess starts at slot 1, not the last slot). Digits are
  // filled left-to-right so value.length is the first empty index.
  useEffect(() => {
    if (disabled) return;
    if (value.length >= 4) return; // all filled — don't yank focus while editing
    refs[value.length]?.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, value]);

  function setDigitAt(idx: number, ch: string) {
    const chars = value.padEnd(4, " ").split("");
    chars[idx] = ch || " ";
    const next = chars.join("").replace(/\s+/g, "");
    onChange(next);
  }

  function handleChange(idx: number, raw: string) {
    const digit = (raw.match(/\d/)?.[0] ?? "").slice(0, 1);
    if (!digit) {
      setDigitAt(idx, "");
      return;
    }
    setDigitAt(idx, digit);
    sounds.digitTap();
    // Auto-advance is handled by the focus effect above (keyed on value),
    // which reliably survives the controlled re-render + post-submit clear.
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === "Backspace") {
      const current = value[idx] ?? "";
      if (!current && idx > 0) {
        refs[idx - 1]?.current?.focus();
        setDigitAt(idx - 1, "");
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowLeft" && idx > 0) {
      refs[idx - 1]?.current?.focus();
      e.preventDefault();
    }
    if (e.key === "ArrowRight" && idx < 3) {
      refs[idx + 1]?.current?.focus();
      e.preventDefault();
    }
  }

  function handlePaste(idx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4 - idx);
    if (!pasted) return;
    e.preventDefault();
    const chars = value.padEnd(4, " ").split("");
    for (let i = 0; i < pasted.length; i++) {
      chars[idx + i] = pasted[i]!;
    }
    onChange(chars.join("").replace(/\s+/g, ""));
    const last = Math.min(idx + pasted.length, 3);
    refs[last]?.current?.focus();
  }

  const ready = !disabled && value.length === 4;

  return (
    <div className="panel-elevated p-3 md:p-4">
      {/* On narrow screens: tiles fill the row; submit button drops below.
          On md+: tiles + button share one row. The slot row sits on a
          slight perspective tilt so the dials read as physical hardware. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div
          className="flex-1 flex items-center gap-2"
          style={{ perspective: 700 }}
        >
          {[0, 1, 2, 3].map((i) => {
            const ch = value[i] ?? "";
            const filled = !disabled && !!ch;
            return (
              <div
                key={i}
                className="relative flex-1 min-w-0 max-w-[64px]"
                style={{ transformStyle: "preserve-3d" }}
              >
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  animate={{
                    boxShadow: filled
                      ? "0 0 22px -4px rgba(255,0,168,0.55)"
                      : "0 0 0px rgba(255,0,168,0)",
                  }}
                  transition={{ duration: 0.25 }}
                />
                <input
                  ref={refs[i]}
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={1}
                  disabled={disabled}
                  value={ch}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={(e) => handlePaste(i, e)}
                  onFocus={(e) => e.target.select()}
                  aria-label={`Digit ${i + 1}`}
                  className={`relative w-full aspect-[4/5] rounded-lg text-center font-mono text-xl sm:text-2xl md:text-3xl tabular-nums transition-colors focus:outline-none ${
                    disabled
                      ? "text-fg-dim cursor-not-allowed"
                      : filled
                        ? "text-fg-primary"
                        : "text-fg-muted"
                  }`}
                  style={{
                    background: disabled
                      ? "linear-gradient(160deg, #0C0713, #070410)"
                      : filled
                        ? "linear-gradient(160deg, #241531, #100A1B)"
                        : "linear-gradient(160deg, #150E1E, #0A0610)",
                    border: `1px solid ${
                      filled ? "rgba(255,0,168,0.45)" : "rgba(255,0,168,0.14)"
                    }`,
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -4px 8px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.5)",
                  }}
                />
              </div>
            );
          })}
        </div>

        <motion.button
          className="btn-primary shrink-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
          disabled={!ready}
          onClick={onSubmit}
          whileHover={ready ? { scale: 1.03 } : undefined}
          whileTap={ready ? { scale: 0.95, y: 1 } : undefined}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
        >
          <DialIcon />
          {submitLabel}
        </motion.button>
      </div>

      <div className="flex items-center justify-between mt-2 text-[10px] uppercase tracking-[0.22em] gap-3">
        <span className="text-fg-muted truncate">{placeholder}</span>
        <span
          className={`whitespace-nowrap ${error ? "text-danger" : "text-fg-muted"}`}
        >
          {error ?? "Enter to submit"}
        </span>
      </div>
    </div>
  );
}

/** Combination-dial glyph for the submit button. */
function DialIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12 15.5 8.5" />
      <path d="M12 3v2" />
    </svg>
  );
}
