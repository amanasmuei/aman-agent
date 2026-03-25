import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 10, retryable: () => true });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 10,
      retryable: (err) => err.message.includes("rate limit"),
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("auth failed"));
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelay: 10,
        retryable: (err) => err.message.includes("rate limit"),
      }),
    ).rejects.toThrow("auth failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("rate limit"));
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelay: 10,
        retryable: () => true,
      }),
    ).rejects.toThrow("rate limit");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const start = Date.now();
    await withRetry(fn, { maxAttempts: 3, baseDelay: 50, retryable: () => true });
    const elapsed = Date.now() - start;
    // With jitter (0.5-1.0x), minimum total delay is ~50*0.5 + ~100*0.5 = 75ms
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});
