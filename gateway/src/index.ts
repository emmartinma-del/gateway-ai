import express from "express";
import cors from "cors";
import { initDb } from "./db";
import { initWallet } from "./payment";
import { loadConfig, getProductionWarnings } from "./config";
import { logger } from "./logger";
import transactionsRouter from "./routes/transactions";
import { createPayRouter } from "./routes/pay";
import dashboardRouter from "./routes/dashboard";

async function main() {
  // Load .env only in non-production environments.
  // In production, secrets MUST be injected by the deployment platform
  // (Docker secrets, K8s secrets, AWS Secrets Manager, etc.)
  // and MUST NOT be stored in a plain .env file.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("dotenv").config();
  }

  const config = loadConfig();

  // Initialize database
  initDb(config.dbPath);
  logger.info("db.init", { path: config.dbPath });

  // Initialize wallet
  let walletAddr: string;
  try {
    walletAddr = initWallet();
    logger.info("wallet.init", {
      address: walletAddr,
      network: config.network,
      feeRecipient: config.feeRecipientAddress ?? "not configured",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("wallet.init_failed", { message });
    logger.warn("wallet.degraded", {
      detail: "Payment signing will fail until WALLET_PRIVATE_KEY is set",
    });
  }

  // Production readiness check
  const warnings = getProductionWarnings(config);
  for (const w of warnings) {
    logger.warn("config.production_warning", { warning: w });
  }
  if (config.network === "base" && warnings.length > 0) {
    logger.error("config.mainnet_not_ready", {
      detail: "Refusing to start on mainnet with unresolved configuration warnings",
      warnings,
    });
    process.exit(1);
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ limit: "1mb" }));

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", network: config.network, timestamp: new Date().toISOString() });
  });

  // API routes
  app.use("/v1/transactions", transactionsRouter);
  app.use("/v1/pay", createPayRouter(config));

  // Admin dashboard
  app.use("/dashboard", dashboardRouter);

  // Root redirect
  app.get("/", (req, res) => res.redirect("/dashboard"));

  app.listen(config.port, () => {
    logger.info("gateway.started", {
      port: config.port,
      network: config.network,
      allowedDomains: config.allowedDomains.size > 0
        ? [...config.allowedDomains]
        : "all (unrestricted)",
      maxPaymentPerRequest: config.maxPaymentPerRequest.toString(),
      maxDailySpend: config.maxDailySpend.toString(),
    });
  });
}

main().catch((err) => {
  logger.error("fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
