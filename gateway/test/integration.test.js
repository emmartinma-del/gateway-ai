"use strict";
/**
 * x402 Gateway — Integration Tests
 *
 * Tests run against the compiled gateway (dist/) using Node's built-in test
 * runner. A lightweight Express server mimics the x402 test-server as the
 * payment-gated backend.
 *
 * signPayment is patched before any proxy code loads so tests never touch
 * the actual blockchain signing stack.
 */
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("path");
const express = require("express");

const DIST = path.resolve(__dirname, "..", "dist");

// ─── Patch signPayment BEFORE proxy.js is loaded ──────────────────────────
const paymentMod = require(path.join(DIST, "payment.js"));
paymentMod.signPayment = async (_requirements) => "mock-x402-payment-header";

// ─── Load gateway internals (use patched payment module) ──────────────────
const { initDb } = require(path.join(DIST, "db.js"));
const { createApp } = require(path.join(DIST, "app.js"));

// ─── Test price the mock server advertises (atomic USDC) ──────────────────
const MOCK_PRICE = "1000";
const MOCK_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const MOCK_PAYEE = "0x0000000000000000000000000000000000000001";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Find an available TCP port. */
function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** Wrap http.Server.listen in a promise. */
function startServer(app, port) {
  return new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(port, () => resolve(srv));
  });
}

/** Wrap http.Server.close in a promise. */
function stopServer(srv) {
  return new Promise((resolve, reject) => {
    if (!srv) return resolve();
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Build a GatewayConfig suitable for testing. */
function makeConfig(gatewayPort, testServerPort, overrides = {}) {
  return {
    network: "base-sepolia",
    port: gatewayPort,
    dbPath: ":memory:",
    feeRecipientAddress: null,
    maxPaymentPerRequest: 0n,
    maxDailySpend: 0n,
    allowedDomains: new Set(),
    apiKeys: new Set(),
    gatewayFeeBps: 15,
    ...overrides,
  };
}

/** POST /v1/pay through the gateway. */
async function gatewayPay(gatewayPort, targetUrl, extraHeaders = {}) {
  const res = await fetch(`http://localhost:${gatewayPort}/v1/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ url: targetUrl }),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Mock x402 backend server ─────────────────────────────────────────────
//
// Mirrors the behaviour of test-server/server.js:
//   GET /data    — requires payment (402) → 200 on valid X-Payment
//   GET /free    — no payment required → 200
//
function createMockBackend(backendPort) {
  const app = express();
  app.use(express.json());

  app.get("/data", (req, res) => {
    if (!req.headers["x-payment"]) {
      return res.status(402).json({
        version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: MOCK_PRICE,
            resource: `http://localhost:${backendPort}/data`,
            description: "Test data endpoint",
            mimeType: "application/json",
            payTo: MOCK_PAYEE,
            maxTimeoutSeconds: 60,
            asset: MOCK_ASSET,
            extra: { name: "USD Coin", version: "2" },
          },
        ],
        error: "Payment required",
      });
    }
    res.json({ success: true, data: "paid data" });
  });

  app.get("/free", (_req, res) => {
    res.json({ free: true });
  });

  return app;
}

// ─── Test suite ───────────────────────────────────────────────────────────

describe("x402 gateway integration", { concurrency: false }, () => {
  let backendPort;
  let backendServer;

  before(async () => {
    backendPort = await getFreePort();
    backendServer = await startServer(createMockBackend(backendPort), backendPort);
  });

  after(async () => {
    await stopServer(backendServer);
  });

  // ── Happy path ────────────────────────────────────────────────────────
  describe("happy path", { concurrency: false }, () => {
    let gatewayPort;
    let gatewayServer;

    before(async () => {
      gatewayPort = await getFreePort();
      initDb(":memory:");
      const config = makeConfig(gatewayPort, backendPort);
      gatewayServer = await startServer(createApp(config), gatewayPort);
    });

    after(async () => {
      await stopServer(gatewayServer);
    });

    test("proxies payment and returns 200 with data", async () => {
      const { status, body } = await gatewayPay(
        gatewayPort,
        `http://localhost:${backendPort}/data`
      );
      assert.equal(status, 200);
      assert.equal(body.paid, true);
      assert.equal(body.body.success, true);
    });

    test("records completed transaction in the ledger", async () => {
      // Make a payment first
      await gatewayPay(gatewayPort, `http://localhost:${backendPort}/data`);

      const res = await fetch(`http://localhost:${gatewayPort}/v1/transactions`);
      const { transactions } = await res.json();
      assert.ok(transactions.length >= 1, "at least one transaction recorded");
      const tx = transactions[0];
      assert.equal(tx.status, "completed");
      assert.equal(tx.amount, MOCK_PRICE);
      assert.equal(tx.asset, MOCK_ASSET);
      assert.equal(tx.recipient, MOCK_PAYEE);
    });
  });

  // ── Passthrough (non-402 responses) ───────────────────────────────────
  describe("passthrough", { concurrency: false }, () => {
    let gatewayPort;
    let gatewayServer;

    before(async () => {
      gatewayPort = await getFreePort();
      initDb(":memory:");
      const config = makeConfig(gatewayPort, backendPort);
      gatewayServer = await startServer(createApp(config), gatewayPort);
    });

    after(async () => {
      await stopServer(gatewayServer);
    });

    test("passes non-402 responses through unchanged", async () => {
      const { status, body } = await gatewayPay(
        gatewayPort,
        `http://localhost:${backendPort}/free`
      );
      assert.equal(status, 200);
      assert.equal(body.paid, false);
      assert.equal(body.body.free, true);
    });

    test("does not record a transaction for passthrough", async () => {
      await gatewayPay(gatewayPort, `http://localhost:${backendPort}/free`);

      const res = await fetch(`http://localhost:${gatewayPort}/v1/transactions`);
      const { transactions } = await res.json();
      assert.equal(transactions.length, 0, "no transaction recorded for free endpoint");
    });
  });

  // ── Spending limits ────────────────────────────────────────────────────
  describe("spending limits", { concurrency: false }, () => {
    test("per-request cap rejects payment exceeding limit", async () => {
      const gatewayPort = await getFreePort();
      initDb(":memory:");
      // Cap at 500; mock price is 1000 → over limit
      const config = makeConfig(gatewayPort, backendPort, {
        maxPaymentPerRequest: 500n,
      });
      const srv = await startServer(createApp(config), gatewayPort);
      try {
        const { status, body } = await gatewayPay(
          gatewayPort,
          `http://localhost:${backendPort}/data`
        );
        assert.equal(status, 402);
        assert.match(body.error ?? body.body?.error ?? "", /per-request limit/i);
      } finally {
        await stopServer(srv);
      }
    });

    test("daily cap rejects payment when budget is exhausted", async () => {
      const gatewayPort = await getFreePort();
      initDb(":memory:");
      // Daily cap at 1; mock price is 1000 → exceeds cap
      const config = makeConfig(gatewayPort, backendPort, {
        maxDailySpend: 1n,
      });
      const srv = await startServer(createApp(config), gatewayPort);
      try {
        const { status, body } = await gatewayPay(
          gatewayPort,
          `http://localhost:${backendPort}/data`
        );
        assert.equal(status, 402);
        assert.match(
          body.error ?? body.body?.error ?? "",
          /daily spend limit/i
        );
      } finally {
        await stopServer(srv);
      }
    });
  });

  // ── Domain allowlist ───────────────────────────────────────────────────
  describe("domain allowlist", { concurrency: false }, () => {
    test("blocks requests to domains not in allowlist", async () => {
      const gatewayPort = await getFreePort();
      initDb(":memory:");
      // Only allow example.com; test server is on localhost
      const config = makeConfig(gatewayPort, backendPort, {
        allowedDomains: new Set(["example.com"]),
      });
      const srv = await startServer(createApp(config), gatewayPort);
      try {
        const { status, body } = await gatewayPay(
          gatewayPort,
          `http://localhost:${backendPort}/data`
        );
        assert.equal(status, 403);
        assert.match(body.error ?? "", /allowlist/i);
      } finally {
        await stopServer(srv);
      }
    });

    test("allows requests to domains in allowlist", async () => {
      const gatewayPort = await getFreePort();
      initDb(":memory:");
      const config = makeConfig(gatewayPort, backendPort, {
        allowedDomains: new Set(["localhost"]),
      });
      const srv = await startServer(createApp(config), gatewayPort);
      try {
        const { status } = await gatewayPay(
          gatewayPort,
          `http://localhost:${backendPort}/data`
        );
        assert.equal(status, 200);
      } finally {
        await stopServer(srv);
      }
    });
  });

  // ── Invalid input ──────────────────────────────────────────────────────
  describe("invalid input", { concurrency: false }, () => {
    let gatewayPort;
    let gatewayServer;

    before(async () => {
      gatewayPort = await getFreePort();
      initDb(":memory:");
      const config = makeConfig(gatewayPort, backendPort);
      gatewayServer = await startServer(createApp(config), gatewayPort);
    });

    after(async () => {
      await stopServer(gatewayServer);
    });

    test("returns 400 when url is missing", async () => {
      const res = await fetch(`http://localhost:${gatewayPort}/v1/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error ?? "", /url is required/i);
    });

    test("returns 400 when url is invalid", async () => {
      const res = await fetch(`http://localhost:${gatewayPort}/v1/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-valid-url" }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error ?? "", /invalid url/i);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────
  describe("auth", { concurrency: false }, () => {
    let gatewayPort;
    let gatewayServer;
    const API_KEY = "test-secret-key-abc123";

    before(async () => {
      gatewayPort = await getFreePort();
      initDb(":memory:");
      const config = makeConfig(gatewayPort, backendPort, {
        apiKeys: new Set([API_KEY]),
      });
      gatewayServer = await startServer(createApp(config), gatewayPort);
    });

    after(async () => {
      await stopServer(gatewayServer);
    });

    test("rejects POST /v1/pay without auth", async () => {
      const res = await fetch(`http://localhost:${gatewayPort}/v1/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `http://localhost:${backendPort}/data` }),
      });
      assert.equal(res.status, 401);
    });

    test("rejects GET /v1/transactions without auth", async () => {
      const res = await fetch(`http://localhost:${gatewayPort}/v1/transactions`);
      assert.equal(res.status, 401);
    });

    test("accepts POST /v1/pay with valid Bearer token", async () => {
      const { status } = await gatewayPay(
        gatewayPort,
        `http://localhost:${backendPort}/data`,
        { Authorization: `Bearer ${API_KEY}` }
      );
      assert.equal(status, 200);
    });

    test("rejects POST /v1/pay with wrong Bearer token", async () => {
      const { status } = await gatewayPay(
        gatewayPort,
        `http://localhost:${backendPort}/data`,
        { Authorization: "Bearer wrong-key" }
      );
      assert.equal(status, 401);
    });
  });
});
