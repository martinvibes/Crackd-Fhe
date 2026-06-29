/**
 * Client-side Mastermind solver — "The Vault" brain for Confidential mode.
 *
 * Codes are 4 digits with no repeats (classic Crackd rules), so the search
 * space is 10·9·8·7 = 5040. The solver keeps the set of still-possible codes
 * and, after each scored guess, filters to those consistent with the feedback.
 *
 * Crucially the feedback it consumes comes from the CrackdFHE contract, which
 * computed it on the ENCRYPTED secret. The solver never sees the code.
 */
export interface Pegs {
  pots: number; // exact position matches (black)
  pans: number; // right digit, wrong place (white)
}

/** Score a guess against a secret (both 4-digit, no-repeat). Matches the
 *  on-chain peg semantics for no-repeat codes. Used only to filter the
 *  candidate set — the live feedback always comes from the contract. */
export function scoreGuess(secret: string, guess: string): Pegs {
  let pots = 0;
  let pans = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) pots += 1;
    else if (secret.includes(guess[i]!)) pans += 1;
  }
  return { pots, pans };
}

/** Every valid 4-digit, no-repeat code as a string. */
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

/** Keep only candidates that would have produced the same feedback. */
export function filterCandidates(
  candidates: string[],
  guess: string,
  pegs: Pegs,
): string[] {
  return candidates.filter((code) => {
    const s = scoreGuess(code, guess);
    return s.pots === pegs.pots && s.pans === pegs.pans;
  });
}

/** Pick the Vault's next guess. Opens with a strong fixed probe, then plays
 *  the first remaining candidate (cheap and effective for a demo). */
export function pickGuess(candidates: string[], turn: number): string {
  if (turn === 0) return "0123";
  if (turn === 1 && candidates.includes("4567")) return "4567";
  return candidates[0] ?? "0123";
}

/** Validate a 4-digit, no-repeat code. */
export function isValidCode(code: string): boolean {
  return /^\d{4}$/.test(code) && new Set(code).size === 4;
}
