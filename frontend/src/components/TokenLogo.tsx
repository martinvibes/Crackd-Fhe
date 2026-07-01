/**
 * Token logo — official ETH / USDC / WETH marks bundled in /public/tokens,
 * with a coloured letter-chip fallback if an image fails to load.
 * Shared across the wallet menu, stake card, and game board.
 */
import { useState } from "react";

const TOKEN_LOGOS: Record<string, string> = {
  ETH: "/tokens/eth.png",
  WETH: "/tokens/weth.png",
  USDC: "/tokens/usdc.png",
};

export function TokenLogo({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const src = TOKEN_LOGOS[symbol.toUpperCase()];
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={symbol}
        width={size}
        height={size}
        className="rounded-full shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-ink-raised text-[10px] font-semibold text-fg-secondary shrink-0"
      style={{ width: size, height: size }}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}
