import crypto from "crypto";
import { insertTransaction, updateTransaction } from "./db";
import { parsePaymentRequirements, signPayment, calculateFee } from "./payment";
import type { ProxyRequest, ProxyResponse, Transaction } from "./types";

const GATEWAY_FEE_BPS = parseInt(process.env.GATEWAY_FEE_BPS ?? "15", 10);
const MAX_RETRIES = 1; // one payment attempt

/**
 * Proxy an HTTP request through the x402 gateway.
 * - If the target returns 402, parse payment requirements, pay, retry.
 * - Record every attempted payment in the ledger.
 */
export async function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const { url, method = "GET", headers = {}, body } = req;

  // --- First attempt ---
  const firstResponse = await doFetch(url, method, headers, body);

  if (firstResponse.status !== 402) {
    // No payment needed
    return {
      status: firstResponse.status,
      headers: firstResponse.headers,
      body: firstResponse.body,
      paid: false,
    };
  }

  // --- 402 received — parse requirements ---
  const requirements = parsePaymentRequirements(firstResponse.headers, firstResponse.body);
  if (!requirements) {
    return {
      status: 402,
      headers: firstResponse.headers,
      body: firstResponse.body,
      paid: false,
    };
  }

  const txId = crypto.randomUUID();
  const { feeAmount } = calculateFee(requirements.maxAmountRequired);

  const tx: Transaction = {
    id: txId,
    createdAt: new Date().toISOString(),
    status: "pending",
    targetUrl: url,
    method,
    amount: requirements.maxAmountRequired,
    asset: requirements.asset,
    network: requirements.network,
    recipient: requirements.payTo,
    feeAmount: feeAmount.toString(),
    feeBps: GATEWAY_FEE_BPS,
    txHash: null,
    errorMessage: null,
  };

  insertTransaction(tx);

  // --- Sign payment ---
  let paymentHeader: string;
  try {
    paymentHeader = await signPayment(requirements);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateTransaction(txId, { status: "failed", errorMessage });
    return {
      status: 402,
      headers: firstResponse.headers,
      body: JSON.stringify({ error: "Payment signing failed", detail: errorMessage }),
      transactionId: txId,
      paid: false,
    };
  }

  // --- Retry with payment header ---
  let retries = 0;
  while (retries <= MAX_RETRIES) {
    const paidResponse = await doFetch(url, method, { ...headers, "X-Payment": paymentHeader }, body);

    if (paidResponse.status !== 402) {
      // Payment accepted — extract tx hash from response header if available
      const txHash =
        paidResponse.headers["x-payment-response"] ??
        paidResponse.headers["x-transaction-hash"] ??
        null;

      updateTransaction(txId, { status: "completed", txHash });

      return {
        status: paidResponse.status,
        headers: paidResponse.headers,
        body: paidResponse.body,
        transactionId: txId,
        paid: true,
        paymentAmount: requirements.maxAmountRequired,
      };
    }

    retries++;
  }

  // Still 402 after payment attempt
  updateTransaction(txId, {
    status: "failed",
    errorMessage: "Payment rejected by server after submission",
  });

  return {
    status: 402,
    headers: firstResponse.headers,
    body: JSON.stringify({ error: "Payment rejected by server" }),
    transactionId: txId,
    paid: false,
  };
}

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function doFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<FetchResult> {
  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    fetchOptions.body = body;
  }

  const response = await fetch(url, fetchOptions);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  const responseBody = await response.text();

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
  };
}
