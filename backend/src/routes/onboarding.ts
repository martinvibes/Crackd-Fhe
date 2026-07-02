/**
 * POST /api/onboarding/fund
 *
 * Body: { walletAddress: string }
 *
 * Previously this auto-funded a fresh testnet address on first sign-in.
 * EVM Sepolia has no auto-faucet, so this is now a no-op stub: it records
 * that the address has been through onboarding (idempotent via a Redis
 * flag) and returns the onboarding info. It never tries to drip ETH —
 * users top up Sepolia gas via a public faucet themselves.
 *
 * The endpoint shape is preserved so the frontend keeps working.
 */
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/services.js";
import type { AppConfig } from "../config.js";
import type { AssetSymbol } from "../services/assets.js";
import { pickVaultGuess } from "../services/solver.js";

const body = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address"),
});

const faucetBody = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address"),
  asset: z.string().default("USDC"),
});

export function onboardingRouter(services: Services, _cfg: AppConfig): Router {
  const r = Router();

  r.post("/onboarding/fund", async (req, res, next) => {
    try {
      const { walletAddress } = body.parse(req.body);

      const already = await services.gameStore.wasFunded(walletAddress);
      if (!already) {
        await services.gameStore.markFunded(walletAddress);
      }

      // No automatic drip on Sepolia — onboarding is a marker only.
      res.json({ funded: false, alreadyFunded: already, wallet: walletAddress });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid wallet address" });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/faucet  { walletAddress, asset }
   *
   * Admin-mints test tokens to the player and (once per address) drips a
   * little Sepolia ETH for gas, so a fresh wallet can stake without first
   * finding ETH elsewhere. All funded by the admin key — the player pays
   * nothing.
   */
  r.post("/faucet", async (req, res, next) => {
    try {
      const { walletAddress, asset } = faucetBody.parse(req.body);
      if (!services.assets.isSupported(asset)) {
        res.status(400).json({ error: `Unsupported asset: ${asset}` });
        return;
      }
      const { txHash, amountHuman } = await services.chain.mintTestTokens(
        walletAddress,
        asset as AssetSymbol,
      );
      // Top up gas to target (no-ops if already funded enough).
      const gasTx = await services.chain.dripGas(walletAddress);
      res.json({ ok: true, asset, amount: amountHuman, tokenTx: txHash, gasTx });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/confidential/vault-guess  { playerGameId, history }
   *
   * The Vault's turn in the two-sided confidential duel: pick a guess (solver)
   * consistent with its prior real feedback, submit it against the PLAYER's
   * sealed code on-chain, and return the pegs (decrypted admin-side).
   */
  r.post("/confidential/vault-guess", async (req, res, next) => {
    try {
      const schema = z.object({
        playerGameId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bad game id"),
        history: z
          .array(
            z.object({
              guess: z.string().regex(/^\d{4}$/),
              pots: z.number().int().min(0).max(4),
              pans: z.number().int().min(0).max(4),
            }),
          )
          .default([]),
      });
      const { playerGameId, history } = schema.parse(req.body);
      const guess = pickVaultGuess(history);
      const scored = await services.fhe.scoreAsVault(
        playerGameId,
        guess.split("").map(Number),
      );
      res.json({ ok: true, guess, ...scored });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/confidential/result  { walletAddress, vaultGameId, outcome, winningGuess? }
   *
   * Records a finished Confidential Duel into the same all-modes leaderboard +
   * player stats the classic modes use. A claimed WIN is verified against the
   * Vault's stored code (the winning guess must equal it), so results can't be
   * spoofed. A draw isn't recorded (counts for neither side).
   */
  r.post("/confidential/result", async (req, res, next) => {
    try {
      const schema = z.object({
        walletAddress: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address"),
        vaultGameId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bad game id"),
        outcome: z.enum(["cracked", "failed", "draw"]),
        winningGuess: z.string().regex(/^\d{4}$/).optional(),
      });
      const { walletAddress, vaultGameId, outcome, winningGuess } =
        schema.parse(req.body);

      if (outcome === "draw") {
        res.json({ ok: true, recorded: false, reason: "draw" });
        return;
      }

      if (outcome === "cracked") {
        // Verify the win: the winning guess must equal the Vault's real code.
        const code = await services.gameStore.getVaultCode(vaultGameId);
        if (!code || !winningGuess || winningGuess !== code) {
          res.status(400).json({ ok: false, error: "Win could not be verified" });
          return;
        }
        await services.gameStore.recordGameResult(walletAddress, true);
        res.json({ ok: true, recorded: true, result: "win" });
        return;
      }

      // A loss (the Vault cracked the player first) — nothing to spoof.
      await services.gameStore.recordGameResult(walletAddress, false);
      res.json({ ok: true, recorded: true, result: "loss" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/gas  { walletAddress }
   *
   * Gas-only top-up (no token mint) — used by Confidential mode, where players
   * just need Sepolia ETH to seal + score on-chain.
   */
  r.post("/gas", async (req, res, next) => {
    try {
      const { walletAddress } = body.parse(req.body);
      const gasTx = await services.chain.dripGas(walletAddress);
      res.json({ ok: true, gasTx });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid wallet address" });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /api/confidential/new  { walletAddress }
   *
   * Starts a CONFIDENTIAL vs-AI game: seals a fresh Vault code on-chain as FHE
   * ciphertext and tops the player up with gas so they can submit guesses.
   * Returns the on-chain gameId the player cracks against.
   */
  r.post("/confidential/new", async (req, res, next) => {
    try {
      const { walletAddress } = body.parse(req.body);
      // Seal the Vault's code (the core step). Gas is topped up client-side
      // before each guess, so we don't drip here — keeps the seal fast and
      // avoids a second admin tx that can time out / race nonces.
      const { gameId, code } = await services.fhe.sealVaultCode();
      // Remember the Vault's plaintext code so we can VERIFY a claimed win
      // later (a real crack means the winning guess equals this code) — the
      // client can't spoof a leaderboard win.
      await services.gameStore.setVaultCode(gameId, code);
      void services.fhe.dripGas(walletAddress).catch(() => {});
      res.json({ ok: true, gameId });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid wallet address" });
        return;
      }
      next(err);
    }
  });

  return r;
}
