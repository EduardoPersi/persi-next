import "server-only";

// Gate 3 -- process-local idempotency cache for the new cart mutation
// routes. add_native_cart_item/set_native_cart_item_quantity/
// remove_native_cart_item have no idempotency-key concept of their own at
// the SQL level (unlike submit_native_checkout/create_native_payment_attempt
// elsewhere in this codebase, which do) -- add_native_cart_item in
// particular ACCUMULATES quantity on a retried call, so without this
// layer a network retry of the exact same "add 2" request would silently
// become "add 4". Same single-persistent-process assumption as
// lib/network/rateLimit.ts's createRateLimiter.

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const store = new Map<string, CacheEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

// `scope` namespaces the key by operation (e.g. "cart:add-item") so a
// client reusing the same idempotencyKey UUID across genuinely different
// operations can never collide.
export async function withIdempotency<T>(scope: string, idempotencyKey: string, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  pruneExpired(now);
  const key = `${scope}:${idempotencyKey}`;
  const cached = store.get(key);
  if (cached) return cached.result as T;
  const result = await run();
  store.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}

export function clearIdempotencyCacheForTests(): void {
  store.clear();
}
