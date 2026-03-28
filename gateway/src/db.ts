// Uses Node.js built-in sqlite (Node 22+, experimental)
// No native compilation required.
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { Transaction, LedgerStats } from "./types";

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
      tx_hash TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `);
}

export function insertTransaction(tx: Transaction): void {
  db.prepare(`
    INSERT INTO transactions
      (id, created_at, status, target_url, method, amount, asset, network, recipient, fee_amount, fee_bps, tx_hash, error_message)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
