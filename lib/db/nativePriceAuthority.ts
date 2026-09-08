import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase } from "./connection";

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

export async function resolveStorePriceAuthority(input: {
  storeId: string;
  currency: string;
  commercialContext?: CommercialContext;
  asOf: Date;
}): Promise<StorePriceAuthoritySnapshot> {
  const result = await getDatabase().execute<StorePriceAuthoritySnapshot>(sql`
    select assignment_id::text "assignmentId",assignment_version "assignmentVersion",
      price_list_id::text "priceListId",currency,commercial_context "commercialContext",
      valid_from "validFrom",valid_to "validTo"
    from public.resolve_store_price_authority(
      ${input.storeId}::uuid,${input.currency}::char(3),
      ${input.commercialContext ?? "storefront_retail"}::public.commercial_context,
      ${input.asOf.toISOString()}::timestamptz
    )
  `);
  if (result.length !== 1) throw new Error("STORE_PRICE_CONFIG_AMBIGUOUS");
  return result[0];
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

export async function readCheckoutPriceAuthority(checkoutId: string) {
  const result = await getDatabase().execute<StorePriceAuthoritySnapshot>(sql`
    select s.store_price_list_assignment_id::text "assignmentId",
      s.store_price_list_assignment_version "assignmentVersion",
      s.price_list_id::text "priceListId",s.currency,
      a.commercial_context "commercialContext",a.valid_from "validFrom",a.valid_to "validTo"
    from public.checkout_sessions s
    join public.store_price_list_assignments a on a.id=s.store_price_list_assignment_id
    where s.id=${checkoutId}::uuid
  `);
  return result[0] ?? null;
}
