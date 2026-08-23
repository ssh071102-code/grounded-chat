import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, guard } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, clock: () => now });
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
    expect(limiter.check("1.2.3.4").allowed).toBe(false);
  });

  it("counts each client separately", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => now });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("2.2.2.2").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(false);
  });

  it("lets a client back in once its window has passed", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => now });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    now = 59_999;
    expect(limiter.check("1.1.1.1").allowed).toBe(false);
    now = 60_001;
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
  });

  it("reports how long to wait, so the caller can send Retry-After", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => now });
    limiter.check("1.1.1.1");
    now = 20_000;
    const denied = limiter.check("1.1.1.1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(40);
  });

  it("forgets clients whose windows have expired instead of growing without bound", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, clock: () => now });
    for (let i = 0; i < 500; i++) {
      now = i * 10;
      limiter.check(`client-${i}`);
    }
    // A public widget is reachable by anyone; a map keyed on caller identity is
    // a memory leak unless expired entries are dropped.
    expect(limiter.size()).toBeLessThan(500);
  });
});

describe("clientKey", () => {
  it("uses the first hop of x-forwarded-for, which is the real caller", () => {
    // Vercel appends its own hops; the client is at the front.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("falls back to a real-ip header when forwarding is absent", () => {
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("groups callers it cannot identify rather than letting them through unmetered", () => {
    // An unidentifiable caller sharing one bucket is the safe failure: the
    // alternative, a unique key per unknown caller, is no limit at all.
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("guard", () => {
  function req(ip: string): Request {
    return new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
  }

  it("returns null while the caller is within its allowance", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, clock: () => now });
    expect(guard(req("1.1.1.1"), limiter)).toBeNull();
    expect(guard(req("1.1.1.1"), limiter)).toBeNull();
  });

  it("answers 429 with Retry-After once the caller is over", async () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => now });
    guard(req("1.1.1.1"), limiter);
    const res = guard(req("1.1.1.1"), limiter)!;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/too many/i);
  });
});
