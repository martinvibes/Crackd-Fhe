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
      // Fund gas first (guesses are on-chain), then seal the Vault code.
      await services.fhe.dripGas(walletAddress);
      const { gameId } = await services.fhe.sealVaultCode();
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
