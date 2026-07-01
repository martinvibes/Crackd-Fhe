/**
 * Mastermind solver for The Vault's guesses in the confidential duel.
 * Codes are 4 distinct digits (0-9). Given the history of guesses + real
 * (on-chain) feedback, pick a next guess consistent with all of it.
 */
export interface Feedback {
  pots: number;
  pans: number;
}
export interface HistoryItem {
  guess: string;
  pots: number;
  pans: number;
}

export function scoreGuess(secret: string, guess: string): Feedback {
  let pots = 0;
  let pans = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) pots += 1;
    else if (secret.includes(guess[i]!)) pans += 1;
  }
  return { pots, pans };
}

export function allCodes(): string[] {
  const out: string[] = [];
  for (let a = 0; a < 10; a++)
    for (let b = 0; b < 10; b++) {
      if (b === a) continue;
      for (let c = 0; c < 10; c++) {
        if (c === a || c === b) continue;
        for (let d = 0; d < 10; d++) {
          if (d === a || d === b || d === c) continue;
          out.push(`${a}${b}${c}${d}`);
        }
      }
    }
  return out;
}

/** The Vault's next guess given its prior guesses + real feedback. */
export function pickVaultGuess(history: HistoryItem[]): string {
  // Fixed strong openers, then the first candidate consistent with history.
  if (history.length === 0) return "0123";
  let candidates = allCodes();
  for (const h of history) {
    candidates = candidates.filter((code) => {
      const s = scoreGuess(code, h.guess);
      return s.pots === h.pots && s.pans === h.pans;
    });
  }
  if (history.length === 1 && candidates.includes("4567")) return "4567";
  return candidates[0] ?? "0123";
}
