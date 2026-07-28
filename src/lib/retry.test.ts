import { describe, expect, it, vi } from "vitest";
import { isRetryableHttpStatus, isTransientNetworkError, withRetry } from "./retry";

describe("isTransientNetworkError", () => {
  it("detects undici causes nested in error.cause", () => {
    const err = new Error("fetch failed", { cause: new Error("other side closed") });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects bare terminated errors", () => {
    expect(isTransientNetworkError(new Error("terminated"))).toBe(true);
  });

  it("treats aborts as transient", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("does not retry config errors", () => {
    expect(isTransientNetworkError(new Error("LLM request failed: 401 invalid api key"))).toBe(
      false,
    );
    expect(isTransientNetworkError(new Error("image generation failed: 404"))).toBe(false);
  });
});

describe("isRetryableHttpStatus", () => {
  it("retries throttling and server errors only", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first successful result", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("terminated"))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up immediately on non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 unauthorized"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured attempt count", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("terminated"));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("terminated");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
