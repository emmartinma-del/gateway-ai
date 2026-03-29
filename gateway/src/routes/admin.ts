import { Router, Request, Response, NextFunction } from "express";
import { getPendingFeeSweepGroups, markFeesSwept } from "../db";
import { sweepFees } from "../payment";
import { logger } from "../logger";
import type { GatewayConfig } from "../config";
import type { FeeSweepResult } from "../types";

/**
 * Middleware: require X-Admin-Key header matching ADMIN_API_KEY env var.
 * If ADMIN_API_KEY is not set, all admin endpoints return 503.
 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey) {
    res.status(503).json({ error: "Admin API not configured (ADMIN_API_KEY not set)" });
    return;
  }
  const provided =
    req.headers["x-admin-key"] ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (provided !== configuredKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function createAdminRouter(config: GatewayConfig): Router {
  const router = Router();

  router.use(requireAdmin);

  /**
   * POST /v1/admin/sweep-fees
   *
   * Sweeps all pending gateway fees to FEE_RECIPIENT_ADDRESS.
   * Groups transactions by (asset, network) and sends one ERC-20 transfer per group.
   * Marks swept transactions in the DB so they are not double-swept.
   *
   * Returns:
   *   { swept: FeeSweepResult[], skipped: string | null }
   */
  router.post("/sweep-fees", async (req: Request, res: Response) => {
    if (!config.feeRecipientAddress) {
      res.status(400).json({
        error: "FEE_RECIPIENT_ADDRESS not configured — cannot sweep fees",
      });
      return;
    }

    const groups = getPendingFeeSweepGroups();

    if (groups.length === 0) {
      res.json({ swept: [], skipped: "No pending fees to sweep" });
      return;
    }

    const swept: FeeSweepResult[] = [];
    const errors: string[] = [];

    for (const group of groups) {
      try {
        logger.info("admin.sweep_fees.attempt", {
          asset: group.asset,
          network: group.network,
          totalFeeAmount: group.totalFeeAmount.toString(),
          txCount: group.txIds.length,
          recipient: config.feeRecipientAddress,
        });

        const txHash = await sweepFees(
          group.asset,
          group.totalFeeAmount,
          config.feeRecipientAddress
        );

        markFeesSwept(group.txIds);

        logger.info("admin.sweep_fees.success", {
          asset: group.asset,
          network: group.network,
          totalFeeAmount: group.totalFeeAmount.toString(),
          txCount: group.txIds.length,
          txHash,
          recipient: config.feeRecipientAddress,
        });

        swept.push({
          asset: group.asset,
          network: group.network,
          totalFeeAmount: group.totalFeeAmount.toString(),
          txCount: group.txIds.length,
          txHash,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("admin.sweep_fees.failed", {
          asset: group.asset,
          network: group.network,
          totalFeeAmount: group.totalFeeAmount.toString(),
          error: message,
        });
        errors.push(`${group.asset}/${group.network}: ${message}`);
      }
    }

    if (errors.length > 0 && swept.length === 0) {
      res.status(500).json({ error: "All sweep attempts failed", details: errors, swept });
      return;
    }

    res.json({
      swept,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  /**
   * GET /v1/admin/sweep-fees/pending
   *
   * Returns a preview of pending fee sweep amounts without executing any transfers.
   */
  router.get("/sweep-fees/pending", (req: Request, res: Response) => {
    const groups = getPendingFeeSweepGroups();
    res.json({
      groups: groups.map((g) => ({
        asset: g.asset,
        network: g.network,
        totalFeeAmount: g.totalFeeAmount.toString(),
        txCount: g.txIds.length,
      })),
      feeRecipient: config.feeRecipientAddress ?? "not configured",
    });
  });

  return router;
}
