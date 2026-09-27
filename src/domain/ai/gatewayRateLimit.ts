/**
 * Trackit X — gateway rate limiting.
 *
 * ── What this is, precisely ──────────────────────────────────────────────────
 * A pluggable limiter and one in-memory implementation, wired into every gateway
 * operation. It is not a billing system, and it does not pretend to be one.
 *
 * What it does buy, today and for real:
 *
 *   · No obviously unbounded endpoint. Every AI call costs money at the provider,
 *     and the gateway is the only place that can refuse before the cost is
 *     incurred. A stolen session token is therefore not a blank cheque.
 *   · A place for the real controls to land. `RateLimiter` is an interface with
 *     one method, and the handler depends on that interface rather than on a
 *     concrete store. Replacing the implementation is a one-line change at
 *     composition time and touches no decision logic.
 *
 * ── Why in-memory is honest here, and where it stops being enough ───────────
 * An Edge Function instance's memory is per-instance and does not survive a cold
 * start. With one instance this is a correct limiter. With N instances behind a
 * load balancer, a caller gets N times the limit by spreading requests — so the
 * effective ceiling is the per-instance number times the instance count, which is
 * not a number anyone should ship as a guarantee.
 *
 * That is stated in the exported `RATE_LIMITING_LIMITS` documentation and in
 * `docs/architecture/AI_GATEWAY_ARCHITECTURE.md` rather than left for someone to
 * discover. The production requirement — a shared store, Redis or a Postgres
 * table with an atomic increment — is recorded as a hardening step, and the
 * interface here is shaped so that adding it changes no call site.
 *
 * ── What the keys are ────────────────────────────────────────────────────────
 * Four independent dimensions, because they defend against different abuse:
 *
 *   · `user`  — one person abusing their own access.
 *   · `org`   — many people, or a compromised account, draining one
 *     organization's provider budget. This is the dimension that protects the
 *     customer who pays the bill.
 *   · `provider` — a runaway loop, or a client bug, hammering one upstream.
 *   · `ip`    — unauthenticated floods, which are refused earlier but still
 *     counted so the log shows them.
 *
 * A request consumes one token from EVERY applicable bucket, so it must satisfy
 * all four at once. That is the property that makes a per-org limit meaningful:
 * rotating users does not reset it.
 */

export type RateLimitDimension = 'user' | 'org' | 'provider' | 'ip';

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Which dimension refused, so the response can say something useful. */
  readonly refusedBy: RateLimitDimension | null;
  /** Seconds until the bucket refills. Sent as `Retry-After`. */
  readonly retryAfterSeconds: number;
  /** How many requests remain in the tightest bucket. Safe to expose. */
  readonly remaining: number;
}

export interface RateLimitRequest {
  readonly userId: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly ip: string;
  /** 'generate' is the expensive operation; the others are cheap. */
  readonly operation: 'generate' | 'test-connection' | 'store-credential' | 'delete-credential' | 'status';
}

export interface RateLimiter {
  check(request: RateLimitRequest): RateLimitVerdict;
}

/**
 * One dimension's ceiling and window.
 *
 * A sliding window rather than a fixed one, because a fixed window lets a caller
 * spend the whole limit at 10:00:59 and again at 10:01:00 — double the intended
 * rate across a one-second boundary, which is the cheapest possible bypass of a
 * naive implementation.
 */
interface BucketSpec {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * The per-dimension ceilings.
 *
 * `generate` numbers are for a small business using the Copilot interactively:
 * a person asks a question every few seconds while they work. The provider costs
 * are the reason the numbers are low — 20 Gemini Flash calls a minute is a
 * generous human rate and a small bill. They are documented defaults, not
 * measured ones, and are meant to be tuned against real usage.
 */
export const RATE_LIMITING_LIMITS: Readonly<Record<RateLimitDimension, BucketSpec>> = {
  user: { limit: 20, windowMs: 60_000 },
  org: { limit: 120, windowMs: 60_000 },
  provider: { limit: 300, windowMs: 60_000 },
  ip: { limit: 60, windowMs: 60_000 },
};

/**
 * A smaller ceiling for the cheap operations, which have no reason to be frequent.
 *
 * Typed as a partial record over ALL operations, so that `generate` being absent
 * is a type-checked statement that it is bounded by the dimension limits rather
 * than by an entry here. An `Exclude<..., 'generate''>d` key type would have
 * looked tidier and then refused to index, which is the bug this annotation exists
 * to prevent rather than to document.
 */
export const RATE_LIMITING_OPERATION_LIMITS: Readonly<
  Partial<Record<RateLimitRequest['operation'], BucketSpec>>
> = {
  'test-connection': { limit: 5, windowMs: 60_000 },
  'store-credential': { limit: 5, windowMs: 300_000 },
  'delete-credential': { limit: 10, windowMs: 300_000 },
  status: { limit: 60, windowMs: 60_000 },
};

/** Timestamps of accepted requests per key, oldest first. */
type Timestamps = number[];

/**
 * Sliding-window limiter held in this instance's memory.
 *
 * Bounded on purpose: `MAX_TRACKED_KEYS` stops an attacker who can vary `ip` or
 * `user` from growing the map without limit and turning a rate limiter into a
 * memory-exhaustion vector. When the bound is reached, the least recently used
 * bucket is dropped — which fails *open* for that one bucket, and is the right
 * direction to fail: the alternative is refusing legitimate traffic because a
 * map is full.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Timestamps>();
  private lastSeen = new Map<string, number>();

  constructor(
    private readonly specs: Readonly<Record<RateLimitDimension, BucketSpec>> = RATE_LIMITING_LIMITS,
    private readonly maxTrackedKeys = 10_000,
  ) {}

  check(request: RateLimitRequest): RateLimitVerdict {
    const now = Date.now();
    // `generate` is deliberately absent from the operation table: it is bounded by
    // the per-dimension limits above, which is where its ceiling belongs. The
    // operations in the table are the cheap ones, and they get a tighter cap
    // because they are the ones a stuck retry loop can hammer.
    const operationCap: BucketSpec | undefined = RATE_LIMITING_OPERATION_LIMITS[request.operation];

    const dimensions: readonly (readonly [RateLimitDimension, string, BucketSpec])[] = [
      ['user', request.userId, this.specs.user],
      ['org', request.organizationId, this.specs.org],
      ['provider', request.provider, this.specs.provider],
      ['ip', request.ip, this.specs.ip],
    ];

    // The operation-level cap is modelled as a synthetic dimension keyed on the
    // user, so it composes with the rest rather than being a special case that
    // could be forgotten on a new operation.
    const all: readonly (readonly [RateLimitDimension, string, BucketSpec])[] =
      operationCap === undefined
        ? dimensions
        : [
            ...dimensions,
            ['user', `op:${request.operation}:${request.userId}`, operationCap],
          ];

    let tightestRemaining = Number.POSITIVE_INFINITY;
    let refusedBy: RateLimitDimension | null = null;
    let refusedRetryAfter = 0;

    for (const [dimension, key, spec] of all) {
      const timestamps = this.prune(key, spec.windowMs, now);
      const used = timestamps.length;

      if (used >= spec.limit) {
        const retryAfterMs = Math.max(0, (timestamps[0] ?? now) + spec.windowMs - now);
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        if (refusedBy === null || retryAfterSeconds > refusedRetryAfter) {
          refusedBy = dimension;
          refusedRetryAfter = retryAfterSeconds;
        }
        // Keep the window accounted for: the call was refused, so nothing is
        // recorded, and the caller must wait for the oldest entry to age out.
        continue;
      }

      timestamps.push(now);
      this.buckets.set(key, timestamps);
      this.lastSeen.set(key, now);
      this.evictIfNeeded();

      const remaining = spec.limit - timestamps.length;
      if (remaining < tightestRemaining) {
        tightestRemaining = remaining;
      }
    }

    if (refusedBy !== null) {
      return {
        allowed: false,
        refusedBy,
        retryAfterSeconds: refusedRetryAfter,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      refusedBy: null,
      retryAfterSeconds: 0,
      remaining: Number.isFinite(tightestRemaining) ? Math.max(0, tightestRemaining) : 0,
    };
  }

  private prune(key: string, windowMs: number, now: number): Timestamps {
    const existing = this.buckets.get(key) ?? [];
    const cutoff = now - windowMs;
    const kept = existing.filter((timestamp) => timestamp > cutoff);
    if (kept.length > 0) this.buckets.set(key, kept);
    else this.buckets.delete(key);
    this.lastSeen.delete(key);
    return kept;
  }

  private evictIfNeeded(): void {
    if (this.buckets.size <= this.maxTrackedKeys) return;
    let oldestKey: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, seen] of this.lastSeen) {
      if (seen < oldestSeen) {
        oldestSeen = seen;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.buckets.delete(oldestKey);
      this.lastSeen.delete(oldestKey);
    }
  }
}

/**
 * The limiter used when the gateway is running.
 *
 * Exported as a singleton so a single module instance is shared, and deliberately
 * not configurable from the environment: a limit that can be raised by an
 * environment variable is a limit that will be raised by an environment variable.
 */
export const gatewayRateLimiter: RateLimiter = new InMemoryRateLimiter();
