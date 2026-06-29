import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services/services.js";
import { fromBaseUnits } from "../utils/units.js";

const assetQuery = z.object({ asset: z.string().optional() });

export function poolRouter(services: Services): Router {
  const r = Router();

  /**
   * GET /api/pool-balance?asset=WETH (default)
   */
  r.get("/pool-balance", async (req, res, next) => {
    try {
      const { asset = "WETH" } = assetQuery.parse(req.query);
      if (!services.assets.isSupported(asset)) {
        res.status(400).json({ error: `Unsupported asset: ${asset}` });
        return;
      }
      const decimals = services.assets.get(asset).decimals;
      const base = await services.chain.getPoolBalance(asset);
      res.json({
        asset,
        balance: fromBaseUnits(base, decimals),
        balanceBaseUnits: base.toString(),
        lastUpdated: Date.now(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/pool-balances — all supported assets in one call.
   */
  r.get("/pool-balances", async (_req, res, next) => {
    try {
      const assets = services.assets.list();
      const results = await Promise.all(
        assets.map(async (a) => {
          const base = await services.chain.getPoolBalance(a.symbol);
          return {
            asset: a.symbol,
            displayName: a.displayName,
            balance: fromBaseUnits(base, a.decimals),
            balanceBaseUnits: base.toString(),
          };
        }),
      );
      res.json({ balances: results, lastUpdated: Date.now() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/assets — list of supported staking assets (frontend uses this
   * to render the asset picker).
   */
  r.get("/assets", (_req, res) => {
    res.json({
      assets: services.assets.list().map((a) => ({
        symbol: a.symbol,
        displayName: a.displayName,
        decimals: a.decimals,
        address: a.address,
        isNative: a.isNative,
      })),
    });
  });

  return r;
}
