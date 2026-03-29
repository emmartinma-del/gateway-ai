import express from "express";
import cors from "cors";
import type { GatewayConfig } from "./config";
import { createTransactionsRouter } from "./routes/transactions";
import { createPayRouter } from "./routes/pay";
import { createDashboardRouter } from "./routes/dashboard";
import { createAdminRouter } from "./routes/admin";

/**
 * Creates and returns a configured Express application.
 * Does NOT start listening — the caller binds the server.
 * Separating app creation from startup makes the gateway testable in-process.
 */
export function createApp(config: GatewayConfig) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", network: config.network, timestamp: new Date().toISOString() });
  });

  app.use("/v1/transactions", createTransactionsRouter(config));
  app.use("/v1/pay", createPayRouter(config));
  app.use("/v1/admin", createAdminRouter(config));
  app.use("/dashboard", createDashboardRouter(config));

  app.get("/", (_req, res) => res.redirect("/dashboard"));

  return app;
}
