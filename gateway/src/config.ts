export interface GatewayConfig {
  network: string;
  port: number;
  dbPath: string;
  // FEE_RECIPIENT_ADDRESS: company wallet address where gateway fees should be swept
  feeRecipientAddress: string | null;
  // Spending limits in atomic units (USDC = 6 decimals). 0n = no limit.
  maxPaymentPerRequest: bigint;
  maxDailySpend: bigint;
  // Allowlist of hostnames. Empty set = allow all (dev only).
  allowedDomains: Set<string>;
}

export function loadConfig(): GatewayConfig {
  const network = process.env.NETWORK ?? "base-sepolia";
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const dbPath = process.env.DATABASE_PATH ?? "./data/gateway.db";

  const feeRecipientAddress = process.env.FEE_RECIPIENT_ADDRESS ?? null;

  // MAX_PAYMENT_PER_REQUEST: max single-payment cap in USDC atomic units (6 decimals).
  // Example: "1000000" = $1 USDC. Default 0 = no limit.
  const maxPaymentPerRequest = BigInt(process.env.MAX_PAYMENT_PER_REQUEST ?? "0");

  // MAX_DAILY_SPEND: max total spend per UTC calendar day in USDC atomic units.
  // Example: "100000000" = $100 USDC. Default 0 = no limit.
  const maxDailySpend = BigInt(process.env.MAX_DAILY_SPEND ?? "0");

  // ALLOWED_DOMAINS: comma-separated hostnames the gateway may proxy to.
  // Example: "api.example.com,service.io". Empty = allow all (not safe for production).
  const allowedDomainsStr = process.env.ALLOWED_DOMAINS ?? "";
  const allowedDomains = new Set<string>(
    allowedDomainsStr
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
  );

  return { network, port, dbPath, feeRecipientAddress, maxPaymentPerRequest, maxDailySpend, allowedDomains };
}

/**
 * Returns a list of human-readable warnings for production (mainnet) deployments.
 * All warnings must be resolved before mainnet go-live.
 */
export function getProductionWarnings(config: GatewayConfig): string[] {
  if (config.network !== "base") return [];

  const warnings: string[] = [];
  if (!config.feeRecipientAddress) {
    warnings.push("FEE_RECIPIENT_ADDRESS not set — fee sweep destination is unknown");
  }
  if (config.maxDailySpend === 0n) {
    warnings.push("MAX_DAILY_SPEND not configured — gateway has no daily spend cap");
  }
  if (config.maxPaymentPerRequest === 0n) {
    warnings.push("MAX_PAYMENT_PER_REQUEST not configured — gateway has no per-request cap");
  }
  if (config.allowedDomains.size === 0) {
    warnings.push("ALLOWED_DOMAINS not configured — gateway will proxy to any domain");
  }
  return warnings;
}
