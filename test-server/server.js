/**
 * x402 Test Server
 *
 * A minimal Express server that implements the x402 Payment Required protocol.
 * Use this to validate the x402 gateway end-to-end.
 *
 * Usage:
 *   PAYEE_ADDRESS=0xYourAddress PORT=3010 node server.js
 *
 * Then test the gateway:
 *   curl -X POST http://localhost:3001/v1/pay \
 *     -H "Content-Type: application/json" \
 *     -d '{"url": "http://localhost:3010/data"}'
 */

const express = require("express");

const PORT = parseInt(process.env.PORT ?? "3010", 10);
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? "3001", 10);

// USDC contract on Base Sepolia testnet
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Payee address — set via PAYEE_ADDRESS env var (the gateway wallet or any testnet address)
const PAYEE_ADDRESS = process.env.PAYEE_ADDRESS ?? "0x0000000000000000000000000000000000000001";

// Price: 0.001 USDC = 1000 atomic units (USDC has 6 decimals)
const PRICE_ATOMIC = process.env.PRICE_ATOMIC ?? "1000";

const app = express();
app.use(express.json());

/**
 * Build x402 payment requirements object per the spec.
 */
function buildPaymentRequirements(resourceUrl) {
  return {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: PRICE_ATOMIC,
    resource: resourceUrl,
    description: "Access to test data endpoint",
    mimeType: "application/json",
    payTo: PAYEE_ADDRESS,
    maxTimeoutSeconds: 60,
    asset: USDC_BASE_SEPOLIA,
    extra: {
      name: "USD Coin",
      version: "2",
    },
  };
}

/**
 * x402 middleware: requires payment on any route it wraps.
 * - Returns 402 with payment requirements if no X-Payment header
 * - Passes through if X-Payment is present (testnet: accept any non-empty proof)
 */
function requirePayment(req, res, next) {
  const paymentHeader = req.headers["x-payment"];

  if (!paymentHeader) {
    const requirements = buildPaymentRequirements(
      `http://localhost:${PORT}${req.path}`
    );

    // x402 spec: 402 response body is { version, accepts: [...] }
    return res.status(402).json({
      version: 1,
      accepts: [requirements],
      error: "Payment required",
    });
  }

  // Testnet: accept any non-empty payment header
  // In production: verify using x402/facilitator.verify against the chain
  console.log(`[test-server] Payment received on ${req.path}: ${paymentHeader.slice(0, 64)}...`);
  next();
}

// Protected endpoint: GET /data
app.get("/data", requirePayment, (req, res) => {
  res.json({
    success: true,
    message: "Payment accepted. Here is your test data.",
    data: {
      timestamp: new Date().toISOString(),
      records: [
        { id: 1, value: "alpha", score: 0.92 },
        { id: 2, value: "beta", score: 0.87 },
        { id: 3, value: "gamma", score: 0.81 },
      ],
    },
    payment: {
      asset: USDC_BASE_SEPOLIA,
      amount: PRICE_ATOMIC,
      amountFormatted: `${(parseInt(PRICE_ATOMIC) / 1e6).toFixed(6)} USDC`,
    },
  });
});

// Protected endpoint: GET /premium — higher price
app.get("/premium", requirePayment, (req, res) => {
  res.json({
    success: true,
    message: "Premium data unlocked.",
    data: {
      timestamp: new Date().toISOString(),
      insight: "This is premium content that required payment.",
    },
  });
});

// Health check (free)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    payee: PAYEE_ADDRESS,
    price: PRICE_ATOMIC,
    priceFormatted: `${(parseInt(PRICE_ATOMIC) / 1e6).toFixed(6)} USDC`,
    network: "base-sepolia",
    timestamp: new Date().toISOString(),
  });
});

// Info (free)
app.get("/", (req, res) => {
  res.json({
    name: "x402 Test Server",
    description: "Returns HTTP 402 for protected endpoints",
    endpoints: {
      "/data": `${PRICE_ATOMIC} atomic USDC (protected)`,
      "/premium": `${PRICE_ATOMIC} atomic USDC (protected)`,
      "/health": "free",
    },
    gatewayUsage: {
      example: `curl -X POST http://localhost:${GATEWAY_PORT}/v1/pay -H "Content-Type: application/json" -d '{"url":"http://localhost:${PORT}/data"}'`,
    },
  });
});

app.listen(PORT, () => {
  console.log(`[test-server] x402 test server running on http://localhost:${PORT}`);
  console.log(`[test-server] Payee: ${PAYEE_ADDRESS}`);
  console.log(`[test-server] Price: ${PRICE_ATOMIC} atomic USDC (${(parseInt(PRICE_ATOMIC) / 1e6).toFixed(6)} USDC)`);
  console.log(`[test-server] Network: base-sepolia`);
  console.log();
  console.log(`Test with gateway:`);
  console.log(`  curl -X POST http://localhost:${GATEWAY_PORT}/v1/pay \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"url":"http://localhost:${PORT}/data"}'`);
});
