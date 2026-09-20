import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withPersiRole } from "./nativeCommerceAuthority";

export type CommercialContext = "storefront_retail";

export interface StorePriceAuthoritySnapshot {
  [key: string]: unknown;
  assignmentId: string;
  assignmentVersion: bigint;
  priceListId: string;
  currency: string;
  commercialContext: CommercialContext;
  validFrom: Date;
  validTo: Date | null;
}

// getDatabase().execute() (drizzle-orm's postgres-js raw-execute path)
// returns timestamptz columns as strings, not Date instances, regardless of
// the generic type parameter passed to .execute<T>() -- that generic is a
// compile-time assertion only, never a runtime coercion (same caveat
// documented in lib/db/nativeCheckoutPii.ts). createAuthorityPriceFingerprint
// below calls .toISOString() on exactly these fields, so this coercion has
// to happen once, here, at the boundary -- found by inspection (this module
// has no caller yet) rather than by a crash in production.
function toStorePriceAuthoritySnapshot(row: StorePriceAuthoritySnapshot): StorePriceAuthoritySnapshot {
  return { ...row, validFrom: new Date(row.validFrom), validTo: row.validTo ? new Date(row.validTo) : null };
}

export async function resolveStorePriceAuthority(input: {
  storeId: string;
  currency: string;
  commercialContext?: CommercialContext;
  asOf: Date;
}): Promise<StorePriceAuthoritySnapshot> {
  const result = await withPersiRole("persi_app", (db) => db.execute<StorePriceAuthoritySnapshot>(sql`
    select assignment_id::text "assignmentId",assignment_version "assignmentVersion",
      price_list_id::text "priceListId",currency,commercial_context "commercialContext",
      valid_from "validFrom",valid_to "validTo"
    from public.resolve_store_price_authority(
      ${input.storeId}::uuid,${input.currency}::char(3),
      ${input.commercialContext ?? "storefront_retail"}::public.commercial_context,
      ${input.asOf.toISOString()}::timestamptz
    )
  `));
  if (result.length !== 1) throw new Error("STORE_PRICE_CONFIG_AMBIGUOUS");
  return toStorePriceAuthoritySnapshot(result[0]);
}

export function createAuthorityPriceFingerprint(input: {
  storeId: string;
  commercialContext: CommercialContext;
  assignmentId: string;
  assignmentVersion: bigint;
  priceListId: string;
  currency: string;
  asOf: Date;
  priceId: string;
  priceValidFrom: Date;
  priceValidTo: Date | null;
  regularAmountMinor: bigint;
  effectiveAmountMinor: bigint;
}): string {
  const canonical = [
    "native-authority-price-v1", input.storeId, input.commercialContext,
    input.assignmentId, input.assignmentVersion.toString(), input.priceListId,
    input.currency, input.asOf.toISOString(), input.priceId,
    input.priceValidFrom.toISOString(), input.priceValidTo?.toISOString() ?? "",
    input.regularAmountMinor.toString(), input.effectiveAmountMinor.toString(),
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// KNOWN GAP (found by this round's execution-identity audit, docs/database/88):
// store_price_list_assignments has `revoke all ... from public, anon,
// authenticated, persi_app, persi_worker, persi_readonly`
// (20260903120000_store_price_authority_foundation.sql:150) -- direct SELECT
// access is revoked from EVERY application role, including persi_app. The
// only sanctioned access path is resolve_store_price_authority(), which
// re-resolves the CURRENT authority by (store, currency, context, asOf); it
// has no parameter to fetch one already-pinned assignment row by id, which
// is what this function would need to safely stop reading the table
// directly. This function has zero real callers anywhere in the codebase
// today (confirmed by grep) -- it was never exercised under real grants
// (every existing caller runs as the local Postgres superuser, which
// bypasses all grant checks). Left as-is rather than inventing a new
// SECURITY DEFINER accessor (a schema change, which this round's own rules
// require reporting rather than creating): NEW_MIGRATION_REQUIRED=YES,
// scoped to this one function, not to the execution-identity model overall.
export async function readCheckoutPriceAuthority(checkoutId: string): Promise<StorePriceAuthoritySnapshot | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<StorePriceAuthoritySnapshot>(sql`
    select s.store_price_list_assignment_id::text "assignmentId",
      s.store_price_list_assignment_version "assignmentVersion",
      s.price_list_id::text "priceListId",s.currency,
      a.commercial_context "commercialContext",a.valid_from "validFrom",a.valid_to "validTo"
    from public.checkout_sessions s
    join public.store_price_list_assignments a on a.id=s.store_price_list_assignment_id
    where s.id=${checkoutId}::uuid
  `));
  return result[0] ? toStorePriceAuthoritySnapshot(result[0]) : null;
}
