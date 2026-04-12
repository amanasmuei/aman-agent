import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCircuitBreaker,
  createCircuitBreakerRegistry,
} from "../../src/orchestrator/circuit-breaker.js";

describe("createCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in closed state", () => {
    const cb = createCircuitBreaker("test");
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
    expect(cb.lastFailureAt).toBeNull();
  });

  it("exposes the name", () => {
    const cb = createCircuitBreaker("my-agent");
    expect(cb.name).toBe("my-agent");
  });

  it("canExecute returns true when closed", () => {
    const cb = createCircuitBreaker("test");
    expect(cb.canExecute()).toBe(true);
  });

  it("recordFailure increments failure count", () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 5 });
    cb.recordFailure();
    expect(cb.failures).toBe(1);
    cb.recordFailure();
    expect(cb.failures).toBe(2);
    expect(cb.state).toBe("closed");
  });

  it("records lastFailureAt timestamp", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cb = createCircuitBreaker("test");
    cb.recordFailure();
    expect(cb.lastFailureAt).toBe(Date.now());
  });

  it("trips to open after threshold failures", () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("canExecute returns false when open", () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions to half-open after timeout", () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 2,
      resetTimeoutMs: 5000,
    });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(4999);
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open");
  });

  it("canExecute returns true in half-open", () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");
    expect(cb.canExecute()).toBe(true);
  });

  it("limits attempts in half-open to halfOpenMaxAttempts", () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 2,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.canExecute()).toBe(true); // 1st
    expect(cb.canExecute()).toBe(true); // 2nd
    expect(cb.canExecute()).toBe(false); // 3rd - exhausted
  });

  it("success in half-open resets to closed", () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
    expect(cb.canExecute()).toBe(true);
  });

  it("failure in half-open returns to open", () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("reset() forces closed state", () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.state).toBe("open");

    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
    expect(cb.lastFailureAt).toBeNull();
    expect(cb.canExecute()).toBe(true);
  });

  it("recordSuccess in closed state is a no-op", () => {
    const cb = createCircuitBreaker("test");
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
  });
});

describe("createCircuitBreakerRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates breakers on demand via get()", () => {
    const registry = createCircuitBreakerRegistry();
    const cb = registry.get("agent-a");
    expect(cb.name).toBe("agent-a");
    expect(cb.state).toBe("closed");
  });

  it("returns the same breaker for repeated get() calls", () => {
    const registry = createCircuitBreakerRegistry();
    const a1 = registry.get("agent-a");
    const a2 = registry.get("agent-a");
    expect(a1).toBe(a2);
  });

  it("getAll returns all created breakers", () => {
    const registry = createCircuitBreakerRegistry();
    registry.get("a");
    registry.get("b");
    registry.get("c");
    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((cb) => cb.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("resetAll clears all breakers", () => {
    const registry = createCircuitBreakerRegistry({ failureThreshold: 1 });
    const a = registry.get("a");
    const b = registry.get("b");
    a.recordFailure();
    b.recordFailure();
    expect(a.state).toBe("open");
    expect(b.state).toBe("open");

    registry.resetAll();
    expect(a.state).toBe("closed");
    expect(b.state).toBe("closed");
  });

  it("passes shared options to created breakers", () => {
    const registry = createCircuitBreakerRegistry({ failureThreshold: 2 });
    const cb = registry.get("x");
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("formatStatus shows all breaker states", () => {
    const registry = createCircuitBreakerRegistry({ failureThreshold: 1 });
    const a = registry.get("alpha");
    const b = registry.get("beta");
    a.recordFailure();
    // alpha is open, beta is closed
    const status = registry.formatStatus();
    expect(status).toContain("alpha");
    expect(status).toContain("open");
    expect(status).toContain("beta");
    expect(status).toContain("closed");
  });

  it("formatStatus returns empty message when no breakers", () => {
    const registry = createCircuitBreakerRegistry();
    const status = registry.formatStatus();
    expect(status).toContain("No circuit breakers");
  });
});
