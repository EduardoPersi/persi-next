import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";

// Gate 3 -- catalog/reference reads (Woo product -> native variant, the
// single active store, the single active inventory location) go through
// the AMBIENT database identity (getDatabase(), same connection
// services/catalog/postgres.ts already uses for product reads), NOT
// withPersiRole("persi_app", ...): persi_app has no grant at all on
// external_mappings, products, product_variants, stores.* wait -- stores IS
// granted to persi_app, but external_mappings/product_variants/
// inventory_locations are not granted to any persi_* role in any
// migration (confirmed by inspection). This is the same boundary
// services/catalog/postgres.ts and lib/pim/repository.ts already rely on:
// catalog/reference data is a separate authority domain from commerce
// mutations, which alone go through persi_app/persi_worker.

export interface ResolvedNativeVariant {
  productId: string;
  productVariantId: string;
}

// Resolves a WooCommerce product ID (as the product page already has it)
// to the single native product_variants.id it maps to, via the SAME
// external_mappings convention already used by the PIM/catalog system
// (system='woocommerce', entity_type='product') -- see
// lib/pim/repository.ts's own "unmapped" query for the established
// pattern this mirrors.
//
// FAILS CLOSED: returns null (never guesses, never falls back to a
// different variant) when:
//  - no mapping exists for this Woo product ID;
//  - the mapped native product isn't purchasable/published;
//  - the product has zero or MORE THAN ONE variant (multi-variant
//    resolution -- e.g. Woo "variable" products with color/size options
//    -- is explicitly out of scope for this phase; see
//    docs/native-commerce/gate3-native-cart-checkout-routes.md).
export async function resolveNativeVariantByWooProductId(wooProductId: number): Promise<ResolvedNativeVariant | null> {
  const db = getDatabase();
  const rows = await db.execute<{ productId: string; variantIds: string[] }>(sql`
    select p.id::text as "productId",
      coalesce(array_agg(v.id::text) filter (where v.id is not null), '{}') as "variantIds"
    from external_mappings em
    join products p on p.id = em.internal_id
    left join product_variants v on v.product_id = p.id
    where em.system = 'woocommerce' and em.entity_type = 'product' and em.external_id = ${String(wooProductId)}
      and p.status = 'active' and p.is_purchasable = true and p.catalog_visibility <> 'hidden'
    group by p.id
  `);
  const row = rows[0];
  if (!row || row.variantIds.length !== 1) return null;
  return { productId: row.productId, productVariantId: row.variantIds[0] };
}

export interface ResolvedStoreContext {
  storeId: string;
  currency: string;
}

// FAILS CLOSED: returns null unless there is EXACTLY one active store --
// never guesses which one is "the" store for a request. No caller/config
// convention for multi-store resolution exists yet in this codebase.
export async function resolveSingleActiveStore(): Promise<ResolvedStoreContext | null> {
  const db = getDatabase();
  const rows = await db.execute<{ id: string; defaultCurrency: string }>(sql`
    select id::text as "id", default_currency as "defaultCurrency" from stores where status = 'active'
  `);
  if (rows.length !== 1) return null;
  return { storeId: rows[0].id, currency: rows[0].defaultCurrency };
}

// FAILS CLOSED: returns null unless there is EXACTLY one active, physical
// inventory location -- same reasoning as resolveSingleActiveStore. A
// real multi-warehouse resolution (by postcode/region) is out of scope
// for this phase.
export async function resolveSingleActiveInventoryLocation(): Promise<string | null> {
  const db = getDatabase();
  const rows = await db.execute<{ id: string }>(sql`
    select id::text as "id" from inventory_locations where status = 'active' and is_physical = true
  `);
  if (rows.length !== 1) return null;
  return rows[0].id;
}
