/**
 * Per-actor circuit breaker for Apify connectors.
 *
 * States:
 *   closed    → normal operation; failures increment counter
 *   open      → all calls short-circuit (saves Apify credits)
 *   half_open → allow 1 probe; success → closed, failure → open
 *
 * State is in-memory (resets on deploy). This is intentional: a deploy
 * is a natural recovery point, and persisting to DB would add a query
 * per actor call. The breaker only needs to survive within a single
 * Inngest function invocation or serverless cold-start window.
 */

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerConfig = {
  /** Consecutive failures before opening. Default: 3. */
  failureThreshold?: number;
  /** Ms to wait before transitioning open → half_open. Default: 300_000 (5 min). */
  resetTimeoutMs?: number;
};

type CircuitRecord = {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
};

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_TIMEOUT_MS = 300_000; // 5 minutes

/** In-memory per-key circuit state. */
const circuits = new Map<string, CircuitRecord>();

function getOrCreate(key: string): CircuitRecord {
  let record = circuits.get(key);
  if (!record) {
    record = { state: "closed", failures: 0, lastFailureAt: 0 };
    circuits.set(key, record);
  }
  return record;
}

/**
 * Check whether a call to the given actor key is allowed.
 * Transitions open → half_open if the reset timeout has elapsed.
 */
export function isCallAllowed(
  key: string,
  config?: CircuitBreakerConfig,
  now = Date.now(),
): boolean {
  const record = getOrCreate(key);
  const resetTimeout = config?.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;

  if (record.state === "closed") return true;

  if (record.state === "open") {
    if (now - record.lastFailureAt >= resetTimeout) {
      record.state = "half_open";
      return true; // allow the probe
    }
    return false;
  }

  // half_open — allow 1 probe (the probe call is in progress)
  return true;
}

/**
 * Record a successful call. Resets the circuit to closed.
 */
export function recordSuccess(key: string): void {
  const record = getOrCreate(key);
  record.state = "closed";
  record.failures = 0;
}

/**
 * Record a failed call. Increments failure counter; opens the circuit
 * when the threshold is reached.
 */
export function recordFailure(
  key: string,
  config?: CircuitBreakerConfig,
  now = Date.now(),
): void {
  const record = getOrCreate(key);
  const threshold = config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;

  record.failures += 1;
  record.lastFailureAt = now;

  if (record.state === "half_open") {
    // Probe failed — go back to open
    record.state = "open";
    return;
  }

  if (record.failures >= threshold) {
    record.state = "open";
  }
}

/**
 * Get the current circuit state for a key. Returns "closed" for unknown keys.
 */
export function getCircuitState(key: string): CircuitState {
  return getOrCreate(key).state;
}

/**
 * Reset a specific circuit (useful for testing or manual recovery).
 */
export function resetCircuit(key: string): void {
  circuits.delete(key);
}

/**
 * Reset all circuits (testing only).
 */
export function resetAllCircuits(): void {
  circuits.clear();
}
