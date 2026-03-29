import { Router, Request, Response } from "express";
import { getTransaction, listTransactions } from "../db";
import { requireBearerAuth } from "../middleware/auth";
import type { GatewayConfig } from "../config";

export function createTransactionsRouter(config: GatewayConfig): Router {
  const router = Router();
  router.use(requireBearerAuth(config));

  // GET /v1/transactions
  router.get("/", (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const txs = listTransactions(limit, offset);
    res.json({ transactions: txs, limit, offset });
  });

  // GET /v1/transactions/:id
  router.get("/:id", (req: Request, res: Response) => {
    const tx = getTransaction(req.params.id);
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    res.json(tx);
  });

  return router;
}
