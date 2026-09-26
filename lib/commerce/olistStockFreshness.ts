import "server-only";

import { sql } from "drizzle-orm";
import { withPersiRole } from "@/lib/db/nativeCommerceAuthority";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { getOlistProductStock, OlistApiError } from "@/lib/olist/apiClient";
import { isProductionRuntime } from "@/lib/runtime/runtime-environment";
import type { OlistOAuthEnvironment } from "@/lib/olist/oauthTokens";

// Cart/checkout live stock check (olist-integration-design.md Section
// 5.7). Layered ON TOP OF the existing inventory_levels/reservation
// checks -- never a replacement for them. Feature-flagged off by default:
// OLIST_LIVE_STOCK_CHECK_ENABLED must be explicitly "true" for this to do
// anything. Kept off for the whole of this round (OLIST_API_CALLS=0 until
// the owner authorizes OAuth in staging) -- flipping it on is a separate,
// later decision, not something this file does on its own.
//
// The owner's explicit condition: the Olist HTTP call happens here, in
// application code, BEFORE prepare/submission calls into Postgres -- never
// inside a transaction/lock. This module makes no assumption about being
// called from within one; every DB read it does (the freshness fallback)
// is its own standalone statement.

export function isOlistLiveStockCheckEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.OLIST_LIVE_STOCK_CHECK_ENABLED === "true";
}

export function getOlistStockFreshnessMaxMinutes(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(environment.OLIST_STOCK_FRESHNESS_MAX_MINUTES ?? "30");
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export type CartStockCheckStage = "prepare" | "submission";

export type CartStockCheckOutcome =
  | { ok: true; source: "skipped" | "olist_live" | "local_fallback" }
  | { ok: false; reason: "insufficient_stock" | "stale_local_data"; productVariantId: string };

export interface CartStockCheckItem {
  productVariantId: string;
  quantity: bigint;
}

interface OlistMappingRow {
  [key: string]: unknown;
  externalId: string;
}

async function resolveOlistProductId(productVariantId: string): Promise<number | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<OlistMappingRow>(sql`
    select external_id as "externalId" from public.external_mappings
    where system = 'olist' and entity_type = 'product_variant' and internal_id = ${productVariantId}::uuid
      and status = 'active'
    limit 1
  `));
  const externalId = result[0]?.externalId;
  return externalId ? Number(externalId) : null;
}

interface InventoryFreshnessRow {
  [key: string]: unknown;
  quantityAvailable: bigint;
  lastSyncedAt: string | null;
}

async function readLocalFreshness(productVariantId: string): Promise<InventoryFreshnessRow | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<InventoryFreshnessRow>(sql`
    select quantity_available as "quantityAvailable", last_synced_at as "lastSyncedAt"
    from public.read_native_inventory_freshness(${productVariantId}::uuid)
  `));
  return result[0] ?? null;
}

export interface CheckCartStockDeps {
  getOlistProductStock: typeof getOlistProductStock;
  resolveOlistProductId: typeof resolveOlistProductId;
  readLocalFreshness: typeof readLocalFreshness;
}

const defaultDeps: CheckCartStockDeps = { getOlistProductStock, resolveOlistProductId, readLocalFreshness };

export async function checkCartStockAvailability(
  items: CartStockCheckItem[],
  context: { stage: CartStockCheckStage; cartId?: string; checkoutId?: string; role: import("@/lib/db/nativeCommerceAuthority").PersiRole },
  deps: CheckCartStockDeps = defaultDeps,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CartStockCheckOutcome> {
  if (!isOlistLiveStockCheckEnabled(environment)) return { ok: true, source: "skipped" };

  const maxAgeMs = getOlistStockFreshnessMaxMinutes(environment) * 60_000;
  const olistEnvironment: OlistOAuthEnvironment = isProductionRuntime(environment) ? "production" : "staging";
  let usedFallback = false;

  for (const item of items) {
    const idProduto = await deps.resolveOlistProductId(item.productVariantId);
    if (idProduto === null) continue; // unmapped SKU -- not this check's concern (Section 4)

    try {
      const stock = await deps.getOlistProductStock(
        { role: context.role, app: "catalogo", environment: olistEnvironment },
        idProduto,
      );
      if (BigInt(stock.saldoDisponivel) < item.quantity) {
        return { ok: false, reason: "insufficient_stock", productVariantId: item.productVariantId };
      }
    } catch (error) {
      usedFallback = true;
      logNativeCommerceEvent("native_olist_stock_check_fallback_used", {
        cartId: context.cartId,
        checkoutId: context.checkoutId,
        code: error instanceof OlistApiError ? error.name : "OLIST_UNAVAILABLE",
      });
      const freshness = await deps.readLocalFreshness(item.productVariantId);
      const lastSyncedAtMs = freshness?.lastSyncedAt ? new Date(freshness.lastSyncedAt).getTime() : null;
      const isFresh = lastSyncedAtMs !== null && Date.now() - lastSyncedAtMs < maxAgeMs;
      if (!isFresh) return { ok: false, reason: "stale_local_data", productVariantId: item.productVariantId };
      if ((freshness?.quantityAvailable ?? BigInt(0)) < item.quantity) {
        return { ok: false, reason: "insufficient_stock", productVariantId: item.productVariantId };
      }
    }
  }

  return { ok: true, source: usedFallback ? "local_fallback" : "olist_live" };
}
