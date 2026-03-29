export interface Transaction {
  id: string;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  // Request details
  targetUrl: string;
  method: string;
  // Payment details
  amount: string; // in atomic units (e.g., USDC with 6 decimals)
  asset: string; // token contract address or "ETH"
  network: string;
  recipient: string; // payee address
  // Gateway fee
  feeAmount: string; // gateway fee in same units as amount
  feeBps: number; // fee in basis points
  feeRecipient: string | null; // company wallet address for fee collection
  // On-chain proof
  txHash: string | null;
  // Error info
  errorMessage: string | null;
  // Fee sweep: true once feeAmount has been transferred on-chain to feeRecipient
  feeSwept: boolean;
}

export interface FeeSweepGroup {
  asset: string;
  network: string;
  totalFeeAmount: bigint;
  txIds: string[];
}

export interface FeeSweepResult {
  asset: string;
  network: string;
  totalFeeAmount: string;
  txCount: number;
  txHash: string;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: Record<string, unknown>;
}

export interface ProxyRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  transactionId?: string;
  paid?: boolean;
  paymentAmount?: string;
}

export interface LedgerStats {
  totalTransactions: number;
  completedTransactions: number;
  failedTransactions: number;
  totalVolume: string;
  totalFees: string;
}
