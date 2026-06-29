/**
 * Decimal-aware token unit conversion.
 *
 * On EVM every asset carries its own decimals (WETH=18, USDC=6), so all
 * conversions take the per-asset `decimals`. Base units are bigint; the
 * human-readable form is a plain number (fine for display).
 */
import { parseUnits, formatUnits } from "ethers";

/** Human amount (e.g. 1.5) → base units (bigint). */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  const str = typeof amount === "number" ? formatNumber(amount) : amount.trim();
  return parseUnits(str, decimals);
}

/** Base units (bigint) → human amount (number) for display. */
export function fromBaseUnits(base: bigint | number, decimals: number): number {
  const b = typeof base === "bigint" ? base : BigInt(Math.trunc(base));
  return Number(formatUnits(b, decimals));
}

/** Avoid scientific notation when stringifying a JS number for parseUnits. */
function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`Invalid amount: ${n}`);
  }
  // toFixed with enough precision, then strip trailing zeros.
  return n.toString().includes("e")
    ? n.toFixed(18).replace(/\.?0+$/, "")
    : n.toString();
}

/** Truncate an EVM address (0x…) for display. */
export function shortAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}
