import { initDb } from "./db";
import { initWallet } from "./payment";
import { loadConfig, getProductionWarnings, getProductionAdvisories } from "./config";
import { logger } from "./logger";
import { createApp } from "./app";

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

  // Production readiness check — blocking errors
  const errors = getProductionWarnings(config);
  for (const e of errors) {
    logger.warn("config.production_error", { error: e });
  }
  if (config.network === "base" && errors.length > 0) {
    logger.error("config.mainnet_not_ready", {
      detail: "Refusing to start on mainnet with unresolved configuration errors",
      errors,
    });
    process.exit(1);
  }

  // Non-blocking advisories
  for (const a of getProductionAdvisories(config)) {
    logger.warn("config.production_advisory", { advisory: a });
  }

  const app = createApp(config);

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
