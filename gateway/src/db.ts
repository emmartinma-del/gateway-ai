// Uses Node.js built-in sqlite (Node 22+, experimental)
// No native compilation required.
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { Transaction, LedgerStats, FeeSweepGroup } from "./types";

let db: DatabaseSync;

export function initDb(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(dbPath);

  db.exec(`PRAGMA journal_mode = WAL`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      target_url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      amount TEXT NOT NULL,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      recipient TEXT NOT NULL,
      fee_amount TEXT NOT NULL DEFAULT '0',
      fee_bps INTEGER NOT NULL DEFAULT 0,
      fee_recipient TEXT,
      fee_swept INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `);

  // Migration: add fee_recipient column to existing databases
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN fee_recipient TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add fee_swept column to existing databases
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN fee_swept INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
}

export function insertTransaction(tx: Transaction): void {
  db.prepare(`
    INSERT INTO transactions
      (id, created_at, status, target_url, method, amount, asset, network, recipient, fee_amount, fee_bps, fee_recipient, fee_swept, tx_hash, error_message)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tx.id,
    tx.createdAt,
    tx.status,
    tx.targetUrl,
    tx.method,
    tx.amount,
    tx.asset,
    tx.network,
    tx.recipient,
    tx.feeAmount,
    tx.feeBps,
    tx.feeRecipient,
    tx.feeSwept ? 1 : 0,
    tx.txHash,
    tx.errorMessage
  );
}

export function updateTransaction(
  id: string,
  updates: Partial<Pick<Transaction, "status" | "txHash" | "errorMessage">>
): void {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    params.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    fields.push("tx_hash = ?");
    params.push(updates.txHash);
  }
  if (updates.errorMessage !== undefined) {
    fields.push("error_message = ?");
    params.push(updates.errorMessage);
  }

  if (fields.length === 0) return;
  params.push(id);

  db.prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

type DbRow = Record<string, unknown>;

function rowToTransaction(row: DbRow): Transaction {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status as Transaction["status"],
    targetUrl: row.target_url as string,
    method: row.method as string,
    amount: row.amount as string,
    asset: row.asset as string,
    network: row.network as string,
    recipient: row.recipient as string,
    feeAmount: row.fee_amount as string,
    feeBps: row.fee_bps as number,
    feeRecipient: (row.fee_recipient as string | null) ?? null,
    feeSwept: (row.fee_swept as number) === 1,
    txHash: (row.tx_hash as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  };
}

export function getTransaction(id: string): Transaction | null {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as DbRow | undefined;
  return row ? rowToTransaction(row) : null;
}

export function listTransactions(limit = 50, offset = 0): Transaction[] {
  const rows = db
    .prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as DbRow[];
  return rows.map(rowToTransaction);
}

/**
 * Returns total amount spent (completed transactions) today (UTC) in atomic units.
 */
export function getDailySpend(): bigint {
  const todayPrefix = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total
       FROM transactions
       WHERE status = 'completed' AND created_at LIKE ?`
    )
    .get(`${todayPrefix}%`) as { total: number };
  return BigInt(Math.round(row.total));
}

/**
 * Returns today's (UTC) transaction counts for monitoring/alerting.
 */
export function getTodayStats(): { completed: number; failed: number } {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const completed = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions WHERE status = 'completed' AND created_at LIKE ?`
    )
    .get(`${todayPrefix}%`) as { count: number };
  const failed = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions WHERE status = 'failed' AND created_at LIKE ?`
    )
    .get(`${todayPrefix}%`) as { count: number };
  return { completed: completed.count, failed: failed.count };
}

/**
 * Returns pending fee sweep groups: completed transactions with fee_swept=0 and feeAmount > 0,
 * aggregated by (asset, network). Caller sweeps each group with one ERC-20 transfer.
 */
export function getPendingFeeSweepGroups(): FeeSweepGroup[] {
  type SweepRow = { asset: string; network: string; total_fee: string; ids: string };
  const rows = db.prepare(`
    SELECT asset, network,
           SUM(CAST(fee_amount AS REAL)) as total_fee,
           GROUP_CONCAT(id) as ids
    FROM transactions
    WHERE status = 'completed' AND fee_swept = 0 AND CAST(fee_amount AS REAL) > 0
    GROUP BY asset, network
  `).all() as SweepRow[];

  return rows.map((r) => ({
    asset: r.asset,
    network: r.network,
    totalFeeAmount: BigInt(Math.round(parseFloat(r.total_fee))),
    txIds: r.ids.split(","),
  }));
}

/**
 * Marks the given transaction IDs as fee_swept = 1.
 */
export function markFeesSwept(txIds: string[]): void {
  if (txIds.length === 0) return;
  const placeholders = txIds.map(() => "?").join(", ");
  db.prepare(`UPDATE transactions SET fee_swept = 1 WHERE id IN (${placeholders})`).run(...txIds);
}

export function getStats(): LedgerStats {
  const total = db.prepare("SELECT COUNT(*) as count FROM transactions").get() as { count: number };
  const completed = db
    .prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'completed'")
    .get() as { count: number };
  const failed = db
    .prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'failed'")
    .get() as { count: number };

  const sums = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as vol, COALESCE(SUM(CAST(fee_amount AS REAL)), 0) as fees FROM transactions WHERE status = 'completed'"
    )
    .get() as { vol: number; fees: number };

  return {
    totalTransactions: total.count,
    completedTransactions: completed.count,
    failedTransactions: failed.count,
    totalVolume: sums.vol.toString(),
    totalFees: sums.fees.toString(),
  };
}
