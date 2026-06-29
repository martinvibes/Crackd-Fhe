/**
 * Game REST routes. Socket.io owns real-time play; these endpoints cover
 * the lifecycle entry points that need a synchronous notification from the
 * player after they self-submit an on-chain tx (staking), or summary reads
 * for replay / share card.
 */
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { Services } from "../services/services.js";
import { createInitialState, redactForPlayer } from "../services/gameLogic.js";
import { fromBaseUnits } from "../utils/units.js";
import { logger } from "../utils/logger.js";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address");
const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash");

// Player self-submits the vault stake tx, then notifies the backend with
// the tx hash. Amount is in token base units (bigint as a string).
const stakeBody = z.object({
  address: addressSchema,
  asset: z.string().min(3),
  txHash: txHashSchema,
  stakeAmount: z.string().regex(/^\d+$/, "stakeAmount must be base units"),
});

export function gameRouter(services: Services): Router {
  const r = Router();

  /**
   * GET /api/invite/:code — resolve a short invite code (like "5DA70B")
   * into a full gameId so the joiner doesn't need to paste the uuid.
   */
  r.get("/invite/:code", async (req, res, next) => {
    try {
      const code = String(req.params.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        res.status(400).json({ error: "Invalid invite code" });
        return;
      }
      const gameId = await services.gameStore.resolveInvite(code);
      if (!gameId) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }
      res.json({ gameId });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/game/:gameId — sanitised read for replay / share card.
   */
  r.get("/game/:gameId", async (req, res, next) => {
    try {
      const state = await services.gameStore.load(req.params.gameId);
      if (!state) {
        res.status(404).json({ error: "game not found" });
        return;
      }
      const view = redactForPlayer(state, "playerOne");
      const decimals = state.stakeAsset
        ? services.assets.get(state.stakeAsset).decimals
        : 18;
      res.json({
        gameId: state.gameId,
        mode: state.mode,
        status: state.status,
        playerOne: state.playerOne,
        playerTwo: state.playerTwo,
        currentTurn: state.currentTurn,
        winner: state.winner,
        isDraw: state.isDraw,
        maxGuesses: state.maxGuesses,
        stake: fromBaseUnits(BigInt(state.stakeAmount), decimals),
        stakeBaseUnits: state.stakeAmount,
        stakeAsset: state.stakeAsset ?? null,
        contractGameId: state.contractGameId,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        playerOneGuessCount: state.playerOneGuesses.length,
        playerTwoGuessCount: state.playerTwoGuesses.length,
        revealed:
          state.status === "finished"
            ? {
                playerOneCode: state.playerOneCode,
                playerTwoCode: state.playerTwoCode,
                playerOneGuesses: state.playerOneGuesses,
                playerTwoGuesses: state.playerTwoGuesses,
              }
            : null,
        view,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/game/stake-vs-ai
   *
   * Body: { address, asset, txHash, stakeAmount }
   *
   * Flow: the frontend sends a `stake(token, amount)` tx against the vault
   * contract directly from the player's wallet, waits for confirmation,
   * then notifies the backend here with the tx hash. We best-effort verify
   * the receipt, record the stake, and spin up an AI game session.
   */
  r.post("/game/stake-vs-ai", async (req, res, next) => {
    try {
      const { address, asset, txHash, stakeAmount } = stakeBody.parse(req.body);
      if (!services.assets.isSupported(asset)) {
        res.status(400).json({ error: `Unsupported asset: ${asset}` });
        return;
      }

      // Best-effort on-chain verification. The player already confirmed the
      // tx in their wallet, so a missing/slow receipt isn't fatal — we
      // trust + record and let on-chain state be the final authority.
      const receipt = await services.chain.getReceipt(txHash);
      if (receipt && receipt.status === 0) {
        res.status(400).json({ error: "stake tx reverted" });
        return;
      }

      const gameId = uuidv4();
      const state = createInitialState({
        gameId,
        mode: "vs_ai_staked",
        playerOne: address,
        stakeAmount,
        stakeAsset: asset,
      });
      state.playerTwo = "vault";
      state.status = "setting_codes";

      const vaultCode = services.ai.generateVaultCode();
      await services.gameStore.setVaultCode(gameId, vaultCode);
      await services.gameStore.save(state);
      await services.gameStore.setActiveGame(address, gameId);

      logger.info({ gameId, address, asset, txHash }, "stake-vs-ai recorded");
      res.json({ gameId, asset, txHash });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request", issues: err.issues });
        return;
      }
      next(err);
    }
  });

  return r;
}
