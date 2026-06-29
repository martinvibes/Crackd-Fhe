/**
 * Game state persistence in Redis.
 *
 * - `game:{gameId}` → JSON-serialised GameState (TTL'd).
 * - `player:{walletAddress}:active` → gameId that this wallet is currently
 *   in (for reconnect flows).
 * - `vault:{gameId}` → AI's secret code in vs-ai modes. Held separately
 *   so it never accidentally ends up in the sanitised GameState blob we
 *   send to clients.
 */
import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { GameState } from "../types/game.js";

export class GameStateStore {
  constructor(
    private readonly redis: Redis,
    private readonly cfg: AppConfig,
  ) {}

  private key(gameId: string): string {
    return `game:${gameId}`;
  }
  private vaultKey(gameId: string): string {
    return `vault:${gameId}`;
  }
  private activeKey(wallet: string): string {
    return `player:${wallet}:active`;
  }

  async save(state: GameState): Promise<void> {
    state.updatedAt = Date.now();
    await this.redis.set(
      this.key(state.gameId),
      JSON.stringify(state),
      "EX",
      this.cfg.GAME_SESSION_TTL_SECONDS,
    );
  }

  async load(gameId: string): Promise<GameState | null> {
    const raw = await this.redis.get(this.key(gameId));
    return raw ? (JSON.parse(raw) as GameState) : null;
  }

  async delete(gameId: string): Promise<void> {
    await this.redis.del(this.key(gameId), this.vaultKey(gameId));
  }

  async setVaultCode(gameId: string, code: string): Promise<void> {
    await this.redis.set(
      this.vaultKey(gameId),
      code,
      "EX",
      this.cfg.GAME_SESSION_TTL_SECONDS,
    );
  }

  async getVaultCode(gameId: string): Promise<string | null> {
    return await this.redis.get(this.vaultKey(gameId));
  }

  async setActiveGame(walletAddress: string, gameId: string): Promise<void> {
    await this.redis.set(
      this.activeKey(walletAddress),
      gameId,
      "EX",
      this.cfg.GAME_SESSION_TTL_SECONDS,
    );
  }

  async getActiveGame(walletAddress: string): Promise<string | null> {
    return await this.redis.get(this.activeKey(walletAddress));
  }

  async clearActiveGame(walletAddress: string): Promise<void> {
    await this.redis.del(this.activeKey(walletAddress));
  }

  /**
   * Store the short invite → full gameId mapping so joiners can paste
   * just the 6-character code. TTL matches the game session so stale
   * invites disappear on their own.
   */
  async bindInvite(inviteCode: string, gameId: string): Promise<void> {
    await this.redis.set(
      `invite:${inviteCode.toUpperCase()}`,
      gameId,
      "EX",
      this.cfg.GAME_SESSION_TTL_SECONDS,
    );
  }

  async resolveInvite(inviteCode: string): Promise<string | null> {
    return await this.redis.get(`invite:${inviteCode.toUpperCase()}`);
  }

  // ---- Player identity (username) ----

  async setUsername(wallet: string, name: string): Promise<void> {
    await this.redis.set(`username:${wallet}`, name.slice(0, 20));
  }

  async getUsername(wallet: string): Promise<string | null> {
    return await this.redis.get(`username:${wallet}`);
  }

  async setAvatar(wallet: string, dataUrl: string): Promise<void> {
    // Cap at ~150KB to keep Redis happy.
    if (dataUrl.length > 200_000) throw new Error("Avatar too large");
    await this.redis.set(`avatar:${wallet}`, dataUrl);
  }

  async getAvatar(wallet: string): Promise<string | null> {
    return await this.redis.get(`avatar:${wallet}`);
  }

  async getUsernames(wallets: string[]): Promise<Record<string, string>> {
    if (wallets.length === 0) return {};
    const pipeline = this.redis.pipeline();
    for (const w of wallets) pipeline.get(`username:${w}`);
    const results = await pipeline.exec();
    const map: Record<string, string> = {};
    wallets.forEach((w, i) => {
      const val = results?.[i]?.[1] as string | null;
      if (val) map[w] = val;
    });
    return map;
  }

  /**
   * Batch-resolve identities for a list of wallets. Returns a map of
   * wallet → { username?, avatarUrl? } for leaderboard display.
   */
  async resolveIdentities(
    wallets: string[],
  ): Promise<Record<string, { username?: string; avatarUrl?: string }>> {
    if (wallets.length === 0) return {};
    const pipe = this.redis.pipeline();
    for (const w of wallets) {
      pipe.get(`username:${w}`);
      pipe.get(`avatar:${w}`);
    }
    const results = await pipe.exec();
    const map: Record<string, { username?: string; avatarUrl?: string }> = {};
    wallets.forEach((w, i) => {
      const username = results?.[i * 2]?.[1] as string | null;
      const avatarUrl = results?.[i * 2 + 1]?.[1] as string | null;
      map[w] = {
        ...(username ? { username } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      };
    });
    return map;
  }

  // ---- PvP staked earnings (backend-tracked, mirrors vault layout) ----
  //
  // The CrackdDuel contract pays winners but doesn't keep a per-player
  // earnings ledger the way CrackdVault does. To keep the profile + per-
  // asset leaderboard honest, we mirror PvP wins into Redis ourselves,
  // keyed by token address (matching the on-chain per-token earnings shape
  // so they can be merged additively without translation).
  //
  // Two stores:
  //  - HASH `pvp:earnings:{wallet}` — field=token, value=base units earned
  //  - ZSET `pvp:lb:{token}`        — score=base units earned, member=wallet
  //                                   (used for the per-asset leaderboard)
  //
  // NOTE: scores are stored as JS Numbers in Redis ZSETs. WETH (18 dp)
  // base units exceed Number.MAX_SAFE_INTEGER for large stakes, so this
  // ledger is a best-effort display aid; the on-chain contract is the
  // source of truth for actual balances.

  async recordPvpEarnings(
    wallet: string,
    token: string,
    amount: bigint,
  ): Promise<void> {
    if (!wallet || wallet === "vault") return;
    if (amount <= 0n) return;
    const n = Number(amount);
    await Promise.all([
      this.redis.hincrbyfloat(`pvp:earnings:${wallet}`, token, n),
      this.redis.zincrby(`pvp:lb:${token}`, n, wallet),
    ]);
  }

  async getPvpEarnings(wallet: string): Promise<Record<string, bigint>> {
    const raw = await this.redis.hgetall(`pvp:earnings:${wallet}`);
    const out: Record<string, bigint> = {};
    for (const [token, val] of Object.entries(raw)) {
      try {
        out[token] = BigInt(Math.trunc(Number(val)));
      } catch {
        // skip corrupt entries
      }
    }
    return out;
  }

  /**
   * Top earners for a given token, sorted by base units earned (desc).
   * Returns wallet + earned-base-units pairs; caller pads with usernames.
   */
  async getPvpLeaderboard(
    token: string,
    limit = 50,
  ): Promise<Array<{ wallet: string; earned: bigint }>> {
    const rows = await this.redis.zrevrange(
      `pvp:lb:${token}`,
      0,
      limit - 1,
      "WITHSCORES",
    );
    const out: Array<{ wallet: string; earned: bigint }> = [];
    for (let i = 0; i < rows.length; i += 2) {
      const wallet = rows[i]!;
      const score = rows[i + 1]!;
      out.push({ wallet, earned: BigInt(Math.trunc(Number(score))) });
    }
    return out;
  }

  // ---- All-players leaderboard (backend-tracked, all modes) ----

  async recordGameResult(wallet: string, won: boolean): Promise<void> {
    if (!wallet || wallet === "vault") return;
    await this.redis.zincrby("lb:games", 1, wallet);
    if (won) {
      await this.redis.zincrby("lb:wins", 1, wallet);
      // Bump current streak, then update best to max(current, best).
      const current = Number(
        await this.redis.zincrby("lb:streak:current", 1, wallet),
      );
      // ZADD with GT only writes if the new score beats the existing one,
      // giving us best = max(best, current) atomically.
      await this.redis.zadd("lb:streak:best", "GT", current, wallet);
    } else {
      await this.redis.zincrby("lb:losses", 1, wallet);
      // Reset current streak to 0 — best is sticky.
      await this.redis.zadd("lb:streak:current", 0, wallet);
    }
  }

  async getStreaks(
    wallet: string,
  ): Promise<{ current: number; best: number }> {
    const [c, b] = await Promise.all([
      this.redis.zscore("lb:streak:current", wallet),
      this.redis.zscore("lb:streak:best", wallet),
    ]);
    return { current: Number(c) || 0, best: Number(b) || 0 };
  }

  async getAllPlayersLeaderboard(
    limit = 20,
  ): Promise<Array<{ wallet: string; wins: number; losses: number; games: number }>> {
    const wallets = await this.redis.zrevrangebyscore(
      "lb:games",
      "+inf",
      "1",
      "LIMIT",
      0,
      limit,
    );
    const result: Array<{ wallet: string; wins: number; losses: number; games: number }> = [];
    for (const wallet of wallets) {
      const wins = Number(await this.redis.zscore("lb:wins", wallet)) || 0;
      const losses = Number(await this.redis.zscore("lb:losses", wallet)) || 0;
      const games = Number(await this.redis.zscore("lb:games", wallet)) || 0;
      result.push({ wallet, wins, losses, games });
    }
    // Sort by wins desc, then by fewer losses
    result.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    return result;
  }

  // ---- Onboarding (one-shot per address) ----
  //
  // Tracks whether an address has been through first-sign-in onboarding so
  // the same address isn't re-processed on every reload. On EVM Sepolia
  // there's no auto-faucet to drip gas, so this is just a marker flag.

  async wasFunded(walletAddress: string): Promise<boolean> {
    return (await this.redis.exists(`onboard:funded:${walletAddress}`)) === 1;
  }

  async markFunded(walletAddress: string): Promise<void> {
    // No TTL — onboarding is one-shot per address forever.
    await this.redis.set(`onboard:funded:${walletAddress}`, "1");
  }
}
