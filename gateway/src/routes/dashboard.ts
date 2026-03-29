import { Router, Request, Response } from "express";
import { getStats, listTransactions } from "../db";
import { getWalletAddress } from "../payment";
import { requireDashboardAuth } from "../middleware/auth";
import type { GatewayConfig } from "../config";

export function createDashboardRouter(config: GatewayConfig): Router {
  const router = Router();
  router.use(requireDashboardAuth(config));

  router.get("/", (req: Request, res: Response) => {
  const stats = getStats();
  const recent = listTransactions(20);
  const walletAddr = (() => {
    try {
      return getWalletAddress();
    } catch {
      return "wallet not initialized";
    }
  })();

  // Format amounts: USDC has 6 decimals
  const formatUsdc = (atomicStr: string) => {
    try {
      const n = parseFloat(atomicStr) / 1_000_000;
      return `$${n.toFixed(4)} USDC`;
    } catch {
      return atomicStr;
    }
  };

  const txRows = recent
    .map(
      (tx) => `
    <tr>
      <td title="${tx.id}">${tx.id.slice(0, 8)}…</td>
      <td>${new Date(tx.createdAt).toLocaleString()}</td>
      <td><span class="status-${tx.status}">${tx.status}</span></td>
      <td title="${tx.targetUrl}">${tx.targetUrl.slice(0, 40)}${tx.targetUrl.length > 40 ? "…" : ""}</td>
      <td>${formatUsdc(tx.amount)}</td>
      <td>${formatUsdc(tx.feeAmount)}</td>
      <td>${tx.network}</td>
      <td>${tx.txHash ? `<a href="https://sepolia.basescan.org/tx/${tx.txHash}" target="_blank">${tx.txHash.slice(0, 10)}…</a>` : "—"}</td>
    </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>x402 Gateway — Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e2e2e2; margin: 0; padding: 0; }
    header { background: #1a1a2e; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
    header h1 { margin: 0; font-size: 1.2rem; color: #00d4ff; }
    header .wallet { font-size: 0.75rem; color: #888; font-family: monospace; }
    .stats { display: flex; gap: 1rem; padding: 1.5rem 2rem; flex-wrap: wrap; }
    .stat-card { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 1rem 1.5rem; min-width: 160px; }
    .stat-card h3 { margin: 0 0 0.5rem; font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 1.5rem; font-weight: bold; color: #00d4ff; }
    .section { padding: 0 2rem 2rem; }
    .section h2 { font-size: 0.9rem; text-transform: uppercase; color: #888; letter-spacing: 0.05em; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th { text-align: left; padding: 0.5rem; color: #888; font-weight: 500; border-bottom: 1px solid #333; }
    td { padding: 0.5rem; border-bottom: 1px solid #1e1e1e; }
    td a { color: #00d4ff; text-decoration: none; }
    .status-completed { color: #22c55e; }
    .status-pending { color: #f59e0b; }
    .status-failed { color: #ef4444; }
    .refresh { font-size: 0.75rem; color: #555; padding: 0 2rem 1rem; }
  </style>
</head>
<body>
  <header>
    <h1>⚡ x402 Gateway Admin</h1>
    <span class="wallet">Wallet: ${walletAddr}</span>
  </header>

  <div class="stats">
    <div class="stat-card">
      <h3>Total Transactions</h3>
      <div class="value">${stats.totalTransactions}</div>
    </div>
    <div class="stat-card">
      <h3>Completed</h3>
      <div class="value">${stats.completedTransactions}</div>
    </div>
    <div class="stat-card">
      <h3>Failed</h3>
      <div class="value">${stats.failedTransactions}</div>
    </div>
    <div class="stat-card">
      <h3>Total Volume</h3>
      <div class="value">${formatUsdc(stats.totalVolume)}</div>
    </div>
    <div class="stat-card">
      <h3>Fees Collected</h3>
      <div class="value">${formatUsdc(stats.totalFees)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Recent Transactions</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Time</th>
          <th>Status</th>
          <th>Target URL</th>
          <th>Amount</th>
          <th>Fee</th>
          <th>Network</th>
          <th>Tx Hash</th>
        </tr>
      </thead>
      <tbody>
        ${txRows || '<tr><td colspan="8" style="color:#555;text-align:center;padding:2rem">No transactions yet</td></tr>'}
      </tbody>
    </table>
  </div>

  <p class="refresh">Auto-refreshes every 30s · <a href="/dashboard" style="color:#555">Refresh now</a></p>
  <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  return router;
}
