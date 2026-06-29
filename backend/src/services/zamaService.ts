/**
 * Thin wrapper around ethers v6 for the multi-asset Crackd contracts on
 * the Zama fhEVM (Ethereum Sepolia).
 *
 * Most methods take an `asset` parameter (symbol like "WETH" or "USDC"),
 * resolved to a token address via the `AssetRegistry`. This keeps callers
 * denomination-agnostic — they just pick the asset.
 *
 * Reads go through a JsonRpcProvider (no gas cost).
 * Admin writes are signed with the admin Wallet.
 *
 * Players self-submit their own create/join/stake transactions from their
 * wallet; the backend never holds player keys and only records/optionally
 * verifies their tx hashes. The admin still calls declareWinner /
 * declareDraw / resolveWin / resolveLoss.
 */
import { ethers } from "ethers";
import type { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import type { AssetRegistry, AssetSymbol } from "./assets.js";

export interface PlayerStatsOnChain {
  wins: number;
  losses: number;
  bestStreak: number;
  currentStreak: number;
  gamesPlayed: number;
}

export interface LeaderboardEntryOnChain {
  player: string;
  totalEarned: bigint;
  wins: number;
  bestStreak: number;
}

export interface DuelGameOnChain {
  gameId: string;
  playerOne: string;
  playerTwo: string | null;
  token: string; // 0x token address
  stakeAmount: bigint;
  status: "Waiting" | "Active" | "Completed" | "Refunded" | "Expired";
  createdAt: number;
  winner: string | null;
  payout: bigint | null;
}

// ----------------------------- ABIs ---------------------------------
// Minimal human-readable fragments — only what the backend touches.

const VAULT_ABI = [
  "function adminDeposit(address token, uint256 amount)",
  "function resolveLoss(address player)",
  "function resolveWin(address player, address token, uint256 stakeAmount, uint32 guessesUsed) returns (uint256)",
  "function getPoolBalance(address token) view returns (uint256)",
  "function getPlayerStats(address player) view returns (tuple(uint32 wins, uint32 losses, uint32 bestStreak, uint32 currentStreak, uint32 gamesPlayed))",
  "function getPlayerEarned(address player, address token) view returns (uint256)",
  "function getDailyRemaining(address player, address token) view returns (uint256)",
  "function getLeaderboard(address token) view returns (tuple(address player, uint256 totalEarned, uint32 wins, uint32 bestStreak)[])",
];

const DUEL_ABI = [
  "function declareWinner(bytes32 gameId, address winner)",
  "function declareDraw(bytes32 gameId)",
  "function cancelGame(bytes32 gameId)",
  "function expireGame(bytes32 gameId)",
  "function withdrawTreasury(address token, uint256 amount, address recipient)",
  "function getGame(bytes32 gameId) view returns (tuple(bytes32 gameId, address playerOne, address playerTwo, address token, uint256 stakeAmount, uint8 status, uint64 createdAt, address winner, uint256 payout))",
  "function getPlayerGames(address player) view returns (bytes32[])",
  "function getTreasuryBalance(address token) view returns (uint256)",
  "event GameCreated(bytes32 indexed gameId, address indexed playerOne, address indexed token, uint256 stake)",
];

const FHE_ABI = [
  "function getFeedback(bytes32 gameId, address guesser) view returns (bytes32 black, bytes32 white, bytes32 solved, uint32 guessIndex)",
];

const DUEL_STATUS: DuelGameOnChain["status"][] = [
  "Waiting", // 0 None → treat as Waiting placeholder
  "Waiting", // 1 Waiting
  "Active", // 2 Active
  "Completed", // 3 Completed
  "Refunded", // 4 Refunded
  "Expired", // 5 Expired
];

const ZERO = "0x0000000000000000000000000000000000000000";

// ethers' Contract uses a dynamic proxy for method access, which TS can't
// see through under `strict` + `noUncheckedIndexedAccess`. We declare the
// methods explicitly (named, not via index signature) so each is callable
// and non-undefined. Each method also carries `.staticCall` for read-only
// simulation of a state-mutating function.
type ContractFn = ((...args: any[]) => Promise<any>) & {
  staticCall: (...args: any[]) => Promise<any>;
};
interface VaultContract {
  adminDeposit: ContractFn;
  resolveLoss: ContractFn;
  resolveWin: ContractFn;
  getPoolBalance: ContractFn;
  getPlayerStats: ContractFn;
  getPlayerEarned: ContractFn;
  getDailyRemaining: ContractFn;
  getLeaderboard: ContractFn;
}
interface DuelContract {
  declareWinner: ContractFn;
  declareDraw: ContractFn;
  cancelGame: ContractFn;
  expireGame: ContractFn;
  withdrawTreasury: ContractFn;
  getGame: ContractFn;
  getPlayerGames: ContractFn;
  getTreasuryBalance: ContractFn;
}
interface FheContract {
  getFeedback: ContractFn;
}

export class ZamaService {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly admin: ethers.Wallet;
  private readonly vault: VaultContract;
  private readonly duel: DuelContract;
  private readonly fhe: FheContract;

  constructor(
    cfg: AppConfig,
    private readonly assets: AssetRegistry,
  ) {
    this.provider = new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, {
      chainId: cfg.EVM_CHAIN_ID,
      name: cfg.EVM_NETWORK,
    });
    this.admin = new ethers.Wallet(cfg.ADMIN_PRIVATE_KEY, this.provider);
    // Reads bind to the provider; admin writes go through the wallet.
    this.vault = new ethers.Contract(
      cfg.CRACKD_VAULT_ADDRESS,
      VAULT_ABI,
      this.admin,
    ) as unknown as VaultContract;
    this.duel = new ethers.Contract(
      cfg.CRACKD_DUEL_ADDRESS,
      DUEL_ABI,
      this.admin,
    ) as unknown as DuelContract;
    this.fhe = new ethers.Contract(
      cfg.CRACKD_FHE_ADDRESS,
      FHE_ABI,
      this.provider,
    ) as unknown as FheContract;
  }

  private tokenAddress(asset: AssetSymbol): string {
    return this.assets.get(asset).address;
  }

  // ---------- provider helpers ----------

  /**
   * Best-effort verification that a player-submitted tx succeeded. Returns
   * the receipt (or null if not found / reverted). Callers may trust+record
   * even when this returns null; on-chain state is the ultimate authority.
   */
  async getReceipt(
    txHash: string,
  ): Promise<ethers.TransactionReceipt | null> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (err) {
      logger.warn({ err, txHash }, "getReceipt failed");
      return null;
    }
  }

  // ---------- Vault reads ----------

  async getPoolBalance(asset: AssetSymbol): Promise<bigint> {
    return (await this.vault.getPoolBalance(this.tokenAddress(asset))) as bigint;
  }

  async getPlayerStats(player: string): Promise<PlayerStatsOnChain> {
    const s = await this.vault.getPlayerStats(player);
    return {
      wins: Number(s.wins),
      losses: Number(s.losses),
      bestStreak: Number(s.bestStreak),
      currentStreak: Number(s.currentStreak),
      gamesPlayed: Number(s.gamesPlayed),
    };
  }

  /** Cumulative bonus earnings for one asset (base units). */
  async getPlayerEarned(player: string, asset: AssetSymbol): Promise<bigint> {
    return (await this.vault.getPlayerEarned(
      player,
      this.tokenAddress(asset),
    )) as bigint;
  }

  /**
   * Per-asset earnings keyed by token address (matches how routes merge
   * with Redis-tracked PvP earnings). Loops the supported assets because
   * the contract exposes a per-token getter rather than a map.
   */
  async getPlayerEarnings(player: string): Promise<Record<string, bigint>> {
    const assets = this.assets.list();
    const values = await Promise.all(
      assets.map((a) => this.getPlayerEarned(player, a.symbol)),
    );
    const out: Record<string, bigint> = {};
    assets.forEach((a, i) => {
      out[a.address] = values[i] ?? 0n;
    });
    return out;
  }

  async getLeaderboard(asset: AssetSymbol): Promise<LeaderboardEntryOnChain[]> {
    const entries = (await this.vault.getLeaderboard(
      this.tokenAddress(asset),
    )) as Array<{
      player: string;
      totalEarned: bigint;
      wins: bigint;
      bestStreak: bigint;
    }>;
    return entries.map((e) => ({
      player: e.player,
      totalEarned: e.totalEarned,
      wins: Number(e.wins),
      bestStreak: Number(e.bestStreak),
    }));
  }

  async getDailyRemaining(
    player: string,
    asset: AssetSymbol,
  ): Promise<bigint> {
    return (await this.vault.getDailyRemaining(
      player,
      this.tokenAddress(asset),
    )) as bigint;
  }

  async getDuelGame(gameIdHex: string): Promise<DuelGameOnChain> {
    const id = normalizeBytes32(gameIdHex);
    const g = await this.duel.getGame(id);
    const statusIdx = Number(g.status);
    return {
      gameId: g.gameId,
      playerOne: g.playerOne,
      playerTwo: g.playerTwo === ZERO ? null : g.playerTwo,
      token: g.token,
      stakeAmount: g.stakeAmount as bigint,
      status: DUEL_STATUS[statusIdx] ?? "Waiting",
      createdAt: Number(g.createdAt),
      winner: g.winner === ZERO ? null : g.winner,
      payout: (g.payout as bigint) === 0n ? null : (g.payout as bigint),
    };
  }

  async getPlayerGames(player: string): Promise<string[]> {
    return (await this.duel.getPlayerGames(player)) as string[];
  }

  // ---------- Vault admin writes ----------

  async resolveWin(
    player: string,
    asset: AssetSymbol,
    stakeAmount: bigint,
    guessesUsed: number,
  ): Promise<{ txHash: string; bonus: bigint }> {
    // Read the bonus via staticCall (the tx itself only returns void on
    // chain), then submit the actual mutation.
    const bonus = (await this.vault.resolveWin.staticCall(
      player,
      this.tokenAddress(asset),
      stakeAmount,
      guessesUsed,
    )) as bigint;
    const tx = await this.vault.resolveWin(
      player,
      this.tokenAddress(asset),
      stakeAmount,
      guessesUsed,
    );
    const receipt = await tx.wait();
    logger.info({ method: "resolveWin", txHash: receipt?.hash }, "evm tx ok");
    return { txHash: receipt?.hash ?? tx.hash, bonus };
  }

  async resolveLoss(player: string): Promise<string> {
    const tx = await this.vault.resolveLoss(player);
    const receipt = await tx.wait();
    logger.info({ method: "resolveLoss", txHash: receipt?.hash }, "evm tx ok");
    return receipt?.hash ?? tx.hash;
  }

  // ---------- Duel admin writes ----------

  async declareDuelWinner(
    gameIdHex: string,
    winner: string,
  ): Promise<string> {
    const tx = await this.duel.declareWinner(normalizeBytes32(gameIdHex), winner);
    const receipt = await tx.wait();
    logger.info(
      { method: "declareWinner", txHash: receipt?.hash },
      "evm tx ok",
    );
    return receipt?.hash ?? tx.hash;
  }

  async declareDuelDraw(gameIdHex: string): Promise<string> {
    const tx = await this.duel.declareDraw(normalizeBytes32(gameIdHex));
    const receipt = await tx.wait();
    logger.info({ method: "declareDraw", txHash: receipt?.hash }, "evm tx ok");
    return receipt?.hash ?? tx.hash;
  }

  /**
   * Admin-signed `cancelGame` — refunds the stake to playerOne. Only valid
   * while the game is in Waiting status (lobby, before the opponent joins).
   * We use the admin from the backend to spare the player a wallet prompt.
   */
  async cancelDuelGame(gameIdHex: string): Promise<string> {
    const tx = await this.duel.cancelGame(normalizeBytes32(gameIdHex));
    const receipt = await tx.wait();
    logger.info({ method: "cancelGame", txHash: receipt?.hash }, "evm tx ok");
    return receipt?.hash ?? tx.hash;
  }

  // ---------- CrackdFHE reads (rarely used) ----------

  async getFheFeedback(
    gameIdHex: string,
    guesser: string,
  ): Promise<{ black: string; white: string; solved: string; guessIndex: number }> {
    const r = await this.fhe.getFeedback(normalizeBytes32(gameIdHex), guesser);
    return {
      black: r.black,
      white: r.white,
      solved: r.solved,
      guessIndex: Number(r.guessIndex),
    };
  }
}

// --------------------------- helpers ---------------------------

function normalizeBytes32(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`Expected 32-byte hex, got ${hex.length} chars`);
  }
  return `0x${clean}`;
}
