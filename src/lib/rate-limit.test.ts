import { describe, it, expect, beforeEach } from "vitest";
import {
  hitRateLimit,
  getClientIp,
  _resetRateLimitForTests,
  _rateLimitBucketCountForTests,
  _runRateLimitGcForTests,
} from "@/lib/rate-limit";

describe("rate-limit", () => {
  beforeEach(() => _resetRateLimitForTests());

  it("allows up to max hits inside the window", () => {
    const opts = { key: "test:a", windowMs: 1000, max: 3 };
    expect(hitRateLimit(opts).ok).toBe(true);
    expect(hitRateLimit(opts).ok).toBe(true);
    expect(hitRateLimit(opts).ok).toBe(true);
    const r = hitRateLimit(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates different keys", () => {
    const a = { key: "test:a", windowMs: 1000, max: 1 };
    const b = { key: "test:b", windowMs: 1000, max: 1 };
    expect(hitRateLimit(a).ok).toBe(true);
    expect(hitRateLimit(a).ok).toBe(false);
    expect(hitRateLimit(b).ok).toBe(true);
  });

  it("resets after the window passes", async () => {
    const opts = { key: "test:reset", windowMs: 50, max: 1 };
    expect(hitRateLimit(opts).ok).toBe(true);
    expect(hitRateLimit(opts).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 70));
    expect(hitRateLimit(opts).ok).toBe(true);
  });

  it("reclaims buckets whose hits have all expired", async () => {
    hitRateLimit({ key: "gc:expired", windowMs: 40, max: 5 });
    expect(_rateLimitBucketCountForTests()).toBe(1);

    _runRateLimitGcForTests();
    expect(_rateLimitBucketCountForTests()).toBe(1);

    await new Promise((r) => setTimeout(r, 60));
    _runRateLimitGcForTests();
    expect(_rateLimitBucketCountForTests()).toBe(0);
  });

  it("keeps buckets that still hold hits inside the window", () => {
    hitRateLimit({ key: "gc:active", windowMs: 60_000, max: 5 });
    _runRateLimitGcForTests();
    expect(_rateLimitBucketCountForTests()).toBe(1);
  });

  it("extracts client IP from x-forwarded-for", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
    const real = new Request("http://x", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(getClientIp(real)).toBe("5.6.7.8");
    const none = new Request("http://x");
    expect(getClientIp(none)).toBe("unknown");
  });
});
