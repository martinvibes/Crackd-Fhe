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

const body = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address"),
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

  return r;
}
