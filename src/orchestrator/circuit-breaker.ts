export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

const DEFAULTS: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 1,
};

export interface CircuitBreaker {
  readonly name: string;
  readonly state: CircuitState;
  readonly failures: number;
  readonly lastFailureAt: number | null;

  /** Check if a request can proceed. Returns false if circuit is open. */
  canExecute(): boolean;

  /** Record a successful execution. Resets to closed. */
  recordSuccess(): void;

  /** Record a failed execution. May trip the circuit to open. */
  recordFailure(): void;

  /** Force reset to closed state. */
  reset(): void;
}

export function createCircuitBreaker(
  name: string,
  options?: Partial<CircuitBreakerOptions>,
): CircuitBreaker {
  const opts: CircuitBreakerOptions = { ...DEFAULTS, ...options };

  let state: CircuitState = "closed";
  let failures = 0;
  let lastFailureAt: number | null = null;
  let openedAt: number | null = null;
  let halfOpenAttempts = 0;

  function checkHalfOpen(): void {
    if (
      state === "open" &&
      openedAt !== null &&
      Date.now() - openedAt >= opts.resetTimeoutMs
    ) {
      state = "half-open";
      halfOpenAttempts = 0;
    }
  }

  return {
    get name() {
      return name;
    },
    get state() {
      checkHalfOpen();
      return state;
    },
    get failures() {
      return failures;
    },
    get lastFailureAt() {
      return lastFailureAt;
    },

    canExecute(): boolean {
      checkHalfOpen();
      if (state === "closed") return true;
      if (state === "open") return false;
      // half-open: limited attempts
      if (halfOpenAttempts >= opts.halfOpenMaxAttempts) return false;
      halfOpenAttempts++;
      return true;
    },

    recordSuccess(): void {
      if (state === "half-open") {
        state = "closed";
        failures = 0;
        lastFailureAt = null;
        openedAt = null;
        halfOpenAttempts = 0;
      }
    },

    recordFailure(): void {
      failures++;
      lastFailureAt = Date.now();
      if (state === "half-open") {
        // back to open
        state = "open";
        openedAt = Date.now();
        halfOpenAttempts = 0;
      } else if (failures >= opts.failureThreshold) {
        state = "open";
        openedAt = Date.now();
      }
    },

    reset(): void {
      state = "closed";
      failures = 0;
      lastFailureAt = null;
      openedAt = null;
      halfOpenAttempts = 0;
    },
  };
}

/**
 * Registry of circuit breakers, one per agent profile.
 */
export interface CircuitBreakerRegistry {
  get(name: string): CircuitBreaker;
  getAll(): CircuitBreaker[];
  resetAll(): void;
  /** Get formatted status summary. */
  formatStatus(): string;
}

export function createCircuitBreakerRegistry(
  options?: Partial<CircuitBreakerOptions>,
): CircuitBreakerRegistry {
  const breakers = new Map<string, CircuitBreaker>();

  return {
    get(name: string): CircuitBreaker {
      let cb = breakers.get(name);
      if (!cb) {
        cb = createCircuitBreaker(name, options);
        breakers.set(name, cb);
      }
      return cb;
    },

    getAll(): CircuitBreaker[] {
      return [...breakers.values()];
    },

    resetAll(): void {
      for (const cb of breakers.values()) {
        cb.reset();
      }
    },

    formatStatus(): string {
      if (breakers.size === 0) {
        return "No circuit breakers registered.";
      }
      const lines = [...breakers.values()].map(
        (cb) =>
          `  ${cb.name}: state=${cb.state} failures=${cb.failures}`,
      );
      return `Circuit breakers (${breakers.size}):\n${lines.join("\n")}`;
    },
  };
}
