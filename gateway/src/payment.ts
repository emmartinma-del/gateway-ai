import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
// @ts-ignore — x402 is ESM-only; loaded via require shimmed by ts-node/node
import { createPaymentHeader } from "x402/client";
import type { PaymentRequirements } from "./types";

const GATEWAY_FEE_BPS = parseInt(process.env.GATEWAY_FEE_BPS ?? "15", 10);

let walletClient: WalletClient;
let walletAddress: string;

export function initWallet(): string {
  const rawKey = process.env.WALLET_PRIVATE_KEY;
  if (!rawKey) {
    throw new Error("WALLET_PRIVATE_KEY is not set");
  }

  const privateKey = rawKey.startsWith("0x")
    ? (rawKey as `0x${string}`)
    : (`0x${rawKey}` as `0x${string}`);

  const account = privateKeyToAccount(privateKey);
  walletAddress = account.address;

  const networkName = process.env.NETWORK ?? "base-sepolia";
  const chain = networkName === "base" ? base : baseSepolia;

  walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  return walletAddress;
}

export function getWalletAddress(): string {
  return walletAddress;
}

/**
 * Parse x402 payment requirements from a 402 response.
 * The spec puts requirements in the `X-Payment-Required` header as JSON,
 * or in the response body as `{ version, accepts: [...] }`.
 */
export function parsePaymentRequirements(
  responseHeaders: Record<string, string>,
  responseBody: string
): PaymentRequirements | null {
  // Try X-Payment-Required header first
  const headerVal = responseHeaders["x-payment-required"] ?? responseHeaders["X-Payment-Required"];
  if (headerVal) {
    try {
      return JSON.parse(headerVal) as PaymentRequirements;
    } catch {
      // fall through to body parse
    }
  }

  // Try body: { version: "0.3", accepts: [{ scheme, network, ... }] }
  if (responseBody) {
    try {
      const body = JSON.parse(responseBody) as {
        version?: string;
        accepts?: PaymentRequirements[];
        error?: string;
      };
      if (body.accepts && Array.isArray(body.accepts) && body.accepts.length > 0) {
        // Pick first EVM requirement
        const evmReq = body.accepts.find(
          (a) => a.scheme === "exact" && a.network?.startsWith("base")
        );
        return evmReq ?? body.accepts[0];
      }
    } catch {
      // not JSON
    }
  }

  return null;
}

/**
 * Calculate gateway fee: GATEWAY_FEE_BPS basis points of the payment amount.
 * Returns fee in the same atomic units as amount.
 */
export function calculateFee(amountStr: string): { netAmount: bigint; feeAmount: bigint } {
  const amount = BigInt(amountStr);
  // fee = amount * feeBps / 10000
  const feeAmount = (amount * BigInt(GATEWAY_FEE_BPS)) / 10000n;
  const netAmount = amount - feeAmount;
  return { netAmount, feeAmount };
}

/**
 * Create x402 payment header for the given requirements.
 */
export async function signPayment(requirements: PaymentRequirements): Promise<string> {
  if (!walletClient) {
    throw new Error("Wallet not initialized. Call initWallet() first.");
  }

  // x402/client createPaymentHeader expects a viem wallet client.
  // Cast to any to avoid x402 type mismatches with viem's Account | undefined union.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentHeader = await createPaymentHeader(
    walletClient as any,
    0, // x402 draft version
    requirements as any
  );

  return paymentHeader;
}
