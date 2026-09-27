export interface RateLimitOptions {
  /** Requests allowed per client per window. */
  limit: number;
  windowMs: number;
  /** Injectable for tests; defaults to wall clock. */
  clock?: () => number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until this client may try again. Zero when allowed. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  startedAt: number;
}

/**
 * Fixed-window limiter, per client, held in process memory.
 *
 * The chat endpoint is a public POST with no authentication, which is correct
 * for a widget on someone's website and means anyone can loop it. Every call
 * spends model tokens on whichever key the deployment carries, so without a
 * ceiling the first thing a bored visitor finds is the deployment's bill.
 *
 * Deliberately not distributed. A serverless deployment runs several instances
 * and each keeps its own counters, so the effective ceiling is the limit times
 * the instance count. That is a blunt bound rather than a precise one, and it
 * is enough to turn an unbounded bill into a bounded one without adding Redis
 * to a product whose selling point is that it needs no infrastructure. A
 * deployment that needs an exact ceiling should put one at the edge.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const clock = options.clock ?? (() => Date.now());
  const windows = new Map<string, Window>();

  function sweep(now: number): void {
    for (const [key, window] of windows) {
      if (now - window.startedAt > options.windowMs) windows.delete(key);
    }
  }

  return {
    check(client: string): RateLimitVerdict {
      const now = clock();
      sweep(now);

      const window = windows.get(client);
      if (!window || now - window.startedAt > options.windowMs) {
        windows.set(client, { count: 1, startedAt: now });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (window.count < options.limit) {
        window.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const elapsed = now - window.startedAt;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((options.windowMs - elapsed) / 1000)),
      };
    },
    size(): number {
      return windows.size;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/**
 * Who is calling. Behind Vercel the caller is the first hop of
 * x-forwarded-for; the rest of that header is Vercel's own proxies. Callers
 * that cannot be identified share a single bucket, which is the safe failure:
 * giving each unknown caller its own key would be the same as having no limit.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** A 429 to return, or null when the caller may proceed. */
export function guard(request: Request, limiter: RateLimiter): Response | null {
  const verdict = limiter.check(clientKey(request.headers));
  if (verdict.allowed) return null;
  return new Response(
    JSON.stringify({
      error: "too many questions from this address, briefly",
      retryAfterSeconds: verdict.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(verdict.retryAfterSeconds),
      },
    },
  );
}
