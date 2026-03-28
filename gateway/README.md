# x402 Payment Gateway

An HTTP proxy gateway that automatically handles [x402](https://x402.org) payment flows. When a proxied request returns HTTP 402 Payment Required, the gateway signs and submits the payment, then retries — all transparently to the calling agent.

## Architecture

```
Agent → POST /v1/pay → Gateway Proxy → Target Service
                              ↓ (on 402)
                       Sign + Submit Payment
                              ↓
                       Retry Request with X-Payment header
                              ↓
                       Record in SQLite Ledger
```

## Features

- **Automatic x402 payment**: intercepts 402 responses, signs USDC payments on Base Sepolia
- **Transaction ledger**: SQLite log of every payment attempt (status, amount, tx hash)
- **Gateway fee**: 0.15% fee on each transaction for revenue
- **Admin dashboard**: live view of volume, fees, recent transactions
- **REST API**: `POST /v1/pay`, `GET /v1/transactions`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:
- `WALLET_PRIVATE_KEY` — the gateway's EVM signing key
- `NETWORK` — `base-sepolia` (testnet, default) or `base` (mainnet, CEO approval required)

### 3. Fund the gateway wallet

Get the wallet address after first start, then:
- **Testnet ETH** (for gas): https://www.alchemy.com/faucets/base-sepolia
- **Testnet USDC**: https://faucet.circle.com/

### 4. Start the server

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

Server runs on `http://localhost:3001` by default.

## API Reference

### POST /v1/pay

Route a request through the gateway. Automatically pays x402 responses.

**Request body:**
```json
{
  "url": "https://api.example.com/resource",
  "method": "GET",
  "headers": { "Authorization": "Bearer token" },
  "body": null
}
```

**Response:**
```json
{
  "status": 200,
  "headers": { ... },
  "body": { ... },
  "paid": true,
  "transactionId": "uuid",
  "paymentAmount": "100000"
}
```

### GET /v1/transactions

List all transactions (most recent first).

Query params: `limit` (max 200, default 50), `offset` (default 0).

### GET /v1/transactions/:id

Get a single transaction by ID.

### GET /dashboard

Admin dashboard — volume, fees, recent transactions.

## Revenue Model

The gateway takes a **0.15% fee (15 bps)** on every payment processed. At $1M/day transaction volume, that's $1,500/day in gateway revenue.

## Security

- **Testnet only until CEO approves mainnet** (`NETWORK=base-sepolia`)
- Private key never leaves the server environment
- No auth layer on API for MVP (add before public exposure)

## File Structure

```
gateway/
├── src/
│   ├── index.ts          # Express server entry point
│   ├── proxy.ts          # x402 proxy handler
│   ├── payment.ts        # Viem wallet + x402 signing
│   ├── db.ts             # SQLite ledger
│   ├── types.ts          # TypeScript types
│   └── routes/
│       ├── pay.ts        # POST /v1/pay
│       ├── transactions.ts  # GET /v1/transactions
│       └── dashboard.ts  # Admin dashboard
├── .env.example
├── package.json
└── tsconfig.json
```
