type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, event, ...data };
  const out = level === "error" ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  info:  (event: string, data?: Record<string, unknown>) => log("info",  event, data),
  warn:  (event: string, data?: Record<string, unknown>) => log("warn",  event, data),
  error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
};
