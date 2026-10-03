import { getConfig } from "./config";
import { AppError } from "./errors";

// Fixed-window limiter, in-memory. Fine for a single instance; use Redis/Upstash behind multiple instances.
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

export function checkRateLimit(key: string, now = Date.now()): void {
  const limit = getConfig().RATE_LIMIT_PER_MIN;
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (hits.size > MAX_KEYS) hits.clear();
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new AppError("RATE_LIMITED", { retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) });
  }
}

export function __resetRateLimitForTests() {
  hits.clear();
}
