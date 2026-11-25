/**
 * Fixed-window, in-memory rate limiter (OWASP A06 Insecure Design and
 * LLM "unbounded consumption"): every AI call costs money, and login
 * attempts must not be guessable at full speed. In-memory fits the
 * single-server deployment described in docs/design.md.
 */
type Bucket = { count: number; resetAt: number };
type LimiterGlobal = { __rateBuckets?: Map<string, Bucket> };
const g = globalThis as LimiterGlobal;
const buckets = (g.__rateBuckets ??= new Map<string, Bucket>());

export const LIMITS = {
  /** AI requests (task analysis + chat) per user per minute. */
  ai: () => Number(process.env.AI_RATE_LIMIT_PER_MIN) || 30,
  /** Login attempts per client per minute. */
  login: () => Number(process.env.LOGIN_RATE_LIMIT_PER_MIN) || 10,
};

/** Returns true if allowed, false if the caller is over the limit. */
export function takeToken(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
