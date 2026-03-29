import crypto from "crypto";
import { insertTransaction, updateTransaction, getDailySpend, getTodayStats } from "./db";
import { parsePaymentRequirements, signPayment, calculateFee } from "./payment";
import { logger } from "./logger";
import type { GatewayConfig } from "./config";
import type { ProxyRequest, ProxyResponse, Transaction } from "./types";

const GATEWAY_FEE_BPS = parseInt(process.env.GATEWAY_FEE_BPS ?? "15", 10);
const MAX_RETRIES = 1; // one payment attempt

// Alert threshold: if today's error rate exceeds this ratio, emit a warning log
const ERROR_RATE_ALERT_THRESHOLD = 0.5;

/**
 * Proxy an HTTP request through the x402 gateway.
 * - If the target returns 402, parse payment requirements, pay, retry.
 * - Record every attempted payment in the ledger.
 */
export async function proxyRequest(
  req: ProxyRequest,
  config: GatewayConfig
): Promise<ProxyResponse> {
  const { url, method = "GET", headers = {}, body } = req;

  // --- First attempt ---
  const firstResponse = await doFetch(url, method, headers, body);

  if (firstResponse.status !== 402) {
    logger.info("proxy.passthrough", { url, method, status: firstResponse.status });
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
    logger.warn("proxy.unparseable_402", { url, method });
    return {
      status: 402,
      headers: firstResponse.headers,
      body: firstResponse.body,
      paid: false,
    };
  }

  const paymentAmount = BigInt(requirements.maxAmountRequired);

  // --- Spending limit: per-request cap ---
  if (config.maxPaymentPerRequest > 0n && paymentAmount > config.maxPaymentPerRequest) {
    logger.warn("proxy.spend_limit_exceeded", {
      url,
      method,
      amount: requirements.maxAmountRequired,
      limit: config.maxPaymentPerRequest.toString(),
      reason: "per_request_cap",
    });
    return {
      status: 402,
      headers: {},
      body: JSON.stringify({
        error: "Payment amount exceeds gateway per-request limit",
        amount: requirements.maxAmountRequired,
        limit: config.maxPaymentPerRequest.toString(),
      }),
      paid: false,
    };
  }

  // --- Spending limit: daily cap ---
  if (config.maxDailySpend > 0n) {
    const dailySpend = getDailySpend();
    if (dailySpend + paymentAmount > config.maxDailySpend) {
      logger.warn("proxy.spend_limit_exceeded", {
        url,
        method,
        amount: requirements.maxAmountRequired,
        dailySpendSoFar: dailySpend.toString(),
        dailyLimit: config.maxDailySpend.toString(),
        reason: "daily_cap",
      });
      return {
        status: 402,
        headers: {},
        body: JSON.stringify({
          error: "Daily spend limit reached",
          dailyLimit: config.maxDailySpend.toString(),
        }),
        paid: false,
      };
    }
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
    feeRecipient: config.feeRecipientAddress,
    txHash: null,
    errorMessage: null,
  };

  insertTransaction(tx);

  logger.info("proxy.payment_attempt", {
    txId,
    url,
    method,
    amount: requirements.maxAmountRequired,
    asset: requirements.asset,
    network: requirements.network,
    recipient: requirements.payTo,
    feeAmount: feeAmount.toString(),
    feeBps: GATEWAY_FEE_BPS,
    feeRecipient: config.feeRecipientAddress,
  });

  // --- Sign payment ---
  let paymentHeader: string;
  try {
    paymentHeader = await signPayment(requirements);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateTransaction(txId, { status: "failed", errorMessage });
    logger.error("proxy.payment_sign_failed", { txId, url, errorMessage });
    _maybeAlertErrorRate();
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
      const txHash =
        paidResponse.headers["x-payment-response"] ??
        paidResponse.headers["x-transaction-hash"] ??
        null;

      updateTransaction(txId, { status: "completed", txHash });

      logger.info("proxy.payment_success", {
        txId,
        url,
        method,
        amount: requirements.maxAmountRequired,
        asset: requirements.asset,
        network: requirements.network,
        recipient: requirements.payTo,
        feeAmount: feeAmount.toString(),
        feeRecipient: config.feeRecipientAddress,
        txHash,
        responseStatus: paidResponse.status,
      });

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

  logger.error("proxy.payment_rejected", {
    txId,
    url,
    method,
    amount: requirements.maxAmountRequired,
    recipient: requirements.payTo,
  });

  _maybeAlertErrorRate();

  return {
    status: 402,
    headers: firstResponse.headers,
    body: JSON.stringify({ error: "Payment rejected by server" }),
    transactionId: txId,
    paid: false,
  };
}

/**
 * Emit a structured alert if today's error rate crosses the threshold.
 */
function _maybeAlertErrorRate(): void {
  try {
    const { completed, failed } = getTodayStats();
    const total = completed + failed;
    if (total < 5) return; // not enough data
    const errorRate = failed / total;
    if (errorRate >= ERROR_RATE_ALERT_THRESHOLD) {
      logger.error("alert.high_error_rate", {
        errorRate: errorRate.toFixed(3),
        completed,
        failed,
        total,
        threshold: ERROR_RATE_ALERT_THRESHOLD,
      });
    }
  } catch {
    // non-critical
  }
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
  const fetchOptions: RequestInit = { method, headers };

  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    fetchOptions.body = body;
  }

  const response = await fetch(url, fetchOptions);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  const responseBody = await response.text();

  return { status: response.status, headers: responseHeaders, body: responseBody };
}
