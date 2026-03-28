import { Router, Request, Response } from "express";
import { proxyRequest } from "../proxy";
import type { ProxyRequest } from "../types";

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
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const result = await proxyRequest({ url, method, headers, body });
    res.status(result.status).json({
      ...result,
      // parse body as JSON if possible
      body: tryParseJson(result.body) ?? result.body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Gateway error", detail: message });
  }
});

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default router;
