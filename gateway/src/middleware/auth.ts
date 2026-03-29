import { Request, Response, NextFunction } from "express";
import type { GatewayConfig } from "../config";

/**
 * Bearer token auth for JSON API routes.
 * Requires `Authorization: Bearer <key>` header.
 * No-op when API_KEYS is not configured (dev mode).
 */
export function requireBearerAuth(config: GatewayConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.apiKeys.size === 0) {
      next();
      return;
    }
    const auth = req.headers["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !config.apiKeys.has(token)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

/**
 * HTTP Basic Auth for browser-accessible routes (e.g. dashboard).
 * Uses the same API keys as the password (any username is accepted).
 * No-op when API_KEYS is not configured (dev mode).
 */
export function requireDashboardAuth(config: GatewayConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.apiKeys.size === 0) {
      next();
      return;
    }
    const auth = req.headers["authorization"] ?? "";
    if (!auth.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="x402 Gateway"');
      res.status(401).send("Unauthorized");
      return;
    }
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
    if (!config.apiKeys.has(password)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="x402 Gateway"');
      res.status(401).send("Unauthorized");
      return;
    }
    next();
  };
}
