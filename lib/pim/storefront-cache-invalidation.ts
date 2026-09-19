import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";
import { getProductHref } from "@/lib/routing/storefrontUrls";

// A3.7-FINAL-A, Workstream E: closes the gap between "PIM state changed"
// (publish/unpublish/review decision) and "the storefront's cached PDP
// HTML reflects it". The PIM read pipeline (services/catalog/productFichaTecnica.ts)
// re-evaluates eligibility fresh on every ACTUAL render -- but Next's Full
// Route Cache (ISR) can serve a cached HTML response for a static-eligible
// PDP route WITHOUT re-running that render at all, so a stale page can keep
// showing (or hiding) a Ficha Tecnica value until the route's own
// revalidate window (120s, services/woocommerce/client.ts's
// DEFAULT_REVALIDATE_SECONDS) elapses. revalidatePath() forces the next
// request for that exact path to re-render, closing that window down to
// "next request" instead of "up to 120s from now" -- without making the
// route itself force-dynamic (Section 11's explicit non-goal).
//
// This is deliberately BEST-EFFORT and NEVER throws: publishBatch/
// unpublishBatch/reviewPimAttribute/decidePimConflictAttribute are also
// invoked by scripts/database/pim-publication-canary-executor*.mjs, plain
// Node processes with no Next.js App Router request context at all --
// calling next/cache's revalidatePath there throws
// ("Invariant: static generation store missing in revalidatePath"-style
// errors). The underlying DB write (the actual source of truth) must
// succeed regardless of whether the cache-bust could run; a missed
// invalidation degrades to "stale for up to 120s", not a correctness bug,
// because eligibility is still fail-closed on every render that DOES
// happen. dynamic import() of next/cache also avoids pulling Next's
// runtime into disposable Node scripts that import this module's sibling
// files at all.
export type RevalidateStorefrontPath = (path: string) => void | Promise<void>;
export type ResolveStorefrontPathForProduct = (productId: string) => Promise<string | null>;

async function defaultRevalidate(path: string): Promise<void> {
  const { revalidatePath } = await import("next/cache");
  revalidatePath(path);
}

/** Read-only. Returns the storefront PDP path for a product id, or null if
 * the product has no slug (e.g. it does not exist, or is not a storefront
 * product at all) -- callers must treat null as "nothing to invalidate",
 * never as an error. */
export async function resolveStorefrontPathForProduct(productId: string): Promise<string | null> {
  const rows = (await getDatabase().execute(sql`select slug from public.products where id = ${productId}::uuid limit 1`)) as unknown as Array<{ slug: string | null }>;
  const slug = rows[0]?.slug;
  return slug ? getProductHref(slug) : null;
}

/** Best-effort. Never rejects -- see the module-level comment for why a
 * cache-invalidation failure must never be allowed to look like (or cause)
 * a publication/review failure. `resolvePath` is injectable (defaults to
 * the real DB-backed resolveStorefrontPathForProduct) purely so tests never
 * need a real database connection to exercise this function's own
 * de-duplication/best-effort contract. */
export async function revalidateStorefrontProductPaths(productIds: readonly string[], revalidate: RevalidateStorefrontPath = defaultRevalidate, resolvePath: ResolveStorefrontPathForProduct = resolveStorefrontPathForProduct): Promise<void> {
  const uniqueIds = [...new Set(productIds)];
  for (const productId of uniqueIds) {
    try {
      const path = await resolvePath(productId);
      if (path) await revalidate(path);
    } catch {
      // Best-effort: swallow both the slug lookup and the revalidate call
      // failing (e.g. no Next.js request context, product row vanished
      // between the write and this read). The route's own ISR revalidate
      // window remains the fallback.
    }
  }
}
