import { Router, Request, Response } from "express";
import { proxyRequest } from "../proxy";
import { logger } from "../logger";
import type { GatewayConfig } from "../config";
import type { ProxyRequest } from "../types";

export function createPayRouter(config: GatewayConfig): Router {
  const router = Router();

  // POST /v1/pay
  // Body: { url, method?, headers?, body? }
  // Routes a request through the gateway, paying automatically if 402 is encountered.
  router.post("/", async (req: Request, res: Response) => {
    const { url, method, headers, body } = req.body as ProxyRequest;

    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    // --- Domain allowlist check ---
    if (config.allowedDomains.size > 0) {
      const hostname = parsed.hostname.toLowerCase();
      if (!config.allowedDomains.has(hostname)) {
        logger.warn("pay.domain_blocked", { url, hostname });
        res.status(403).json({
          error: "Domain not in allowlist",
          hostname,
        });
        return;
      }
    }

    try {
      const result = await proxyRequest({ url, method, headers, body }, config);
      res.status(result.status).json({
        ...result,
        body: tryParseJson(result.body) ?? result.body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("pay.gateway_error", { url, message });
      res.status(500).json({ error: "Gateway error", detail: message });
    }
  });

  return router;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
