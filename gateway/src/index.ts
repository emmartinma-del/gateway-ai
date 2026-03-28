import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb } from "./db";
import { initWallet } from "./payment";
import transactionsRouter from "./routes/transactions";
import payRouter from "./routes/pay";
import dashboardRouter from "./routes/dashboard";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const DB_PATH = process.env.DATABASE_PATH ?? "./data/gateway.db";

async function main() {
  // Initialize database
  initDb(DB_PATH);
  console.log(`[db] SQLite ledger at ${DB_PATH}`);

  // Initialize wallet
  let walletAddr: string;
  try {
    walletAddr = initWallet();
    console.log(`[wallet] Gateway wallet: ${walletAddr}`);
    console.log(`[wallet] Network: ${process.env.NETWORK ?? "base-sepolia"}`);
  } catch (err) {
    console.warn(`[wallet] WARNING: ${err instanceof Error ? err.message : err}`);
    console.warn("[wallet] Payment signing will fail until WALLET_PRIVATE_KEY is set.");
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ limit: "1mb" }));

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API routes
  app.use("/v1/transactions", transactionsRouter);
  app.use("/v1/pay", payRouter);

  // Admin dashboard
  app.use("/dashboard", dashboardRouter);

  // Root redirect
  app.get("/", (req, res) => res.redirect("/dashboard"));

  app.listen(PORT, () => {
    console.log(`[gateway] x402 Payment Gateway running on http://localhost:${PORT}`);
    console.log(`[gateway] Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`[gateway] API: POST http://localhost:${PORT}/v1/pay`);
  });
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
