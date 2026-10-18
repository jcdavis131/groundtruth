// Tiny in-memory TTL cache shared by the route handlers. Keeps upstream
// request volume polite (CelesTrak asks for <= 1 fetch per group per 2h,
// OpenSky bills anonymous users 400 credits/day) and makes repeated browser
// polling cheap. Lives for the life of the server process only.

interface Entry<T> {
  value: T;
  expires: number;
  storedAt: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
/** Keys whose producer recently timed out or failed: callers fail fast until `until`. */
const cooling = new Map<string, { until: number; error: Error }>();

export interface Cached<T> {
  value: T;
  /** Age of the cached value in ms (0 when freshly fetched). */
  age: number;
  hit: boolean;
}

export interface CachedOptions {
  /**
   * Stop waiting after this long. The producer keeps running in the
   * background and its value is stored when it lands; the caller gets the
   * last stored value if there is one, otherwise a DeadlineError.
   */
  deadlineMs?: number;
  /**
   * After a timeout or a failure, callers get the stored value at once, or
   * with none stored fail fast for this long instead of asking the same
   * upstream again. A query still in flight (an earlier caller's deadline
   * passed, the query did not) is waited on, up to the caller's own deadline,
   * when there is no stored value to give.
   */
  coolMs?: number;
}

export class DeadlineError extends Error {}

/** 2500 -> "2.5", 30000 -> "30": a deadline as set, not rounded to a whole second. */
function seconds(ms: number): string {
  return String(Number((ms / 1000).toFixed(2)));
}

/**
 * Get a value from the cache or produce it. Concurrent callers for the same
 * key share one producer call, and the producer stores its own value, so a
 * result that lands after every caller gave up is still kept. On upstream
 * failure a stale value is served if one exists.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
  opts: CachedOptions = {},
): Promise<Cached<T>> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) {
    return { value: hit.value, age: now - hit.storedAt, hit: true };
  }
  const stale = (): Cached<T> | null => (hit ? { value: hit.value, age: now - hit.storedAt, hit: true } : null);
  let p = inflight.get(key) as Promise<T> | undefined;
  // Only callers that opted in to cooling are turned away by it. During the
  // cool-down a held value is served at once. With nothing held, a query
  // still in flight is waited on (an earlier caller's deadline passing does
  // not mean the query failed, and waiting on it adds no upstream load); only
  // with nothing in flight either is the caller turned away.
  const cool = opts.coolMs ? cooling.get(key) : undefined;
  if (cool && cool.until > now) {
    const s = stale();
    if (s) return s;
    if (!p) throw cool.error;
  }
  if (!p) {
    p = produce()
      .then((value) => {
        store.set(key, { value, expires: Date.now() + ttlMs, storedAt: Date.now() });
        cooling.delete(key);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    if (opts.coolMs) {
      const coolMs = opts.coolMs;
      p.catch((err: unknown) => {
        cooling.set(key, { until: Date.now() + coolMs, error: err instanceof Error ? err : new Error(String(err)) });
      });
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = opts.deadlineMs
      ? await Promise.race([
          p,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new DeadlineError(`${key}: no answer within ${seconds(opts.deadlineMs!)} s`)), opts.deadlineMs);
          }),
        ])
      : await p;
    return { value, age: 0, hit: false };
  } catch (err) {
    if (err instanceof DeadlineError && opts.coolMs) cooling.set(key, { until: Date.now() + opts.coolMs, error: err });
    const s = stale();
    if (s) return s;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Drop one entry. For producers that can succeed while returning nothing
 * useful — a degraded upstream set — so the next caller retries rather than
 * inheriting the outage for the rest of the TTL. Clears the key's cool-down
 * too, so that retry is not turned away.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
  cooling.delete(key);
}

/**
 * Whether a value is held for the key, fresh or expired. Expired counts on
 * purpose: cached() still serves an expired value when its producer fails.
 */
export function cacheHas(key: string): boolean {
  return store.has(key);
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size, cooling: cooling.size };
}
