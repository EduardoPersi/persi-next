import "server-only";
import { sql } from "drizzle-orm";
import type { PersiDatabase } from "@/lib/db";
import { isKnownNeedsReview } from "./publication-needs-review-registry";

export type PublicationIdentity = { productId: string; attributeId: string; attributeValueId: string };

export type EligibilityReasonCode =
  | "ASSOCIATION_NOT_FOUND"
  | "ATTRIBUTE_VALUE_MISMATCH"
  | "ATTRIBUTE_NOT_SUPPORTED"
  | "NEEDS_REVIEW"
  | "KNOWN_FALSE_POSITIVE"
  | "HUMAN_REVIEW_REJECTED"
  | "OPEN_CONFLICT_SAME_ATTRIBUTE";

export type EligibilityResult = { eligible: boolean; reasonCodes: EligibilityReasonCode[]; sku: string | null; attributeCode: string | null; value: string | null };

type Executor = Pick<PersiDatabase, "execute">;

// The four canonical attributes this publication layer knows how to
// evaluate today (A3.5E-P2's material/conexao/comprimento/volume series).
// An attribute outside this set is ATTRIBUTE_NOT_SUPPORTED -- eligibility
// for it has never been formalized, so it must never be silently treated
// as eligible.
export const SUPPORTED_ATTRIBUTE_CODES = ["material", "conexao", "comprimento", "volume"] as const;
export type SupportedAttributeCode = (typeof SUPPORTED_ATTRIBUTE_CODES)[number];

// pim_conflicts.attribute_key uses the extractor's internal English
// vocabulary (see lib/pim/extractor.ts's PimAttributeCode / ATTRIBUTE_ALIASES),
// NOT public.attributes.code. Confirmed empirically against persi-staging
// during A3.5E-P3-A: 2 open 'connection' and 8 open 'length' conflicts
// exist that a naive `attribute_key = a.code` comparison silently misses
// (comprimento -> length, conexao -> connection; material and volume are
// identical in both namespaces). ATTRIBUTE_ALIASES itself does not cover
// length/connection (it exists for a different purpose -- color/voltage/
// current/power/diameter/material/application/model), so this is its own,
// narrow, explicit mapping restricted to the four attributes this gate
// evaluates.
export const DB_CODE_TO_CONFLICT_ATTRIBUTE_KEY: Record<SupportedAttributeCode, string> = {
  material: "material",
  conexao: "connection",
  comprimento: "length",
  volume: "volume",
};

const TEMPLATE_PLACEHOLDER_PATTERN = /\[[^\]]*?\b(?:indique|especifique|especificar|informe|adicione|adicionar|insira|inserir|preencha|preencher)\b[^\]]*\]/i;

type Row = {
  sku: string;
  attributeCode: string;
  displayValue: string | null;
  description: string | null;
  identityMatches: boolean;
  reviewStatus: "needs_review" | "approved" | "rejected" | null;
  openConflictSameAttribute: boolean;
};

// Read-only. Never writes. Evaluates ONE (product, attribute, attribute_value)
// identity against every gate this project has formalized across A3.5E-P2:
// association must actually exist with this EXACT identity (never inferred
// from SKU); the attribute must be one of the four this layer supports;
// NEEDS_REVIEW and KNOWN_FALSE_POSITIVE (TEMPLATE_PLACEHOLDER_TEXT, the only
// persisted-data false-positive class found in A3.5E-P2, per the
// material-only scope confirmed in P2-U/P2-V/P2-W/P2-X) block; a human
// review decision of 'rejected' for this exact value blocks; an OPEN
// conflict for the SAME attribute blocks, but an open conflict on a
// DIFFERENT attribute of the same product must never block (attribute-
// scoped, never SKU/product-scoped -- confirmed against real data with
// SKU 003359 in A3.5E-P2-W: an open 'bitola' conflict never blocked its
// unrelated 'comprimento' candidate).
export async function evaluatePublicationEligibility(db: Executor, identity: PublicationIdentity): Promise<EligibilityResult> {
  const rows = (await db.execute(sql`
    select
      v.sku,
      a.code as "attributeCode",
      av.display_value as "displayValue",
      p.description,
      (pav.attribute_value_id is not null) as "identityMatches",
      r.status::text as "reviewStatus",
      exists(
        select 1 from public.pim_conflicts c
        where c.product_id = ${identity.productId}::uuid
          and c.status = 'open'
          and c.attribute_key = case a.code
            when 'material' then 'material'
            when 'conexao' then 'connection'
            when 'comprimento' then 'length'
            when 'volume' then 'volume'
            else a.code
          end
      ) as "openConflictSameAttribute"
    from public.attributes a
    join public.products p on p.id = ${identity.productId}::uuid
    join public.product_variants v on v.product_id = p.id
    left join public.attribute_values av on av.id = ${identity.attributeValueId}::uuid
    left join public.product_attribute_values pav
      on pav.product_id = ${identity.productId}::uuid
      and pav.attribute_id = ${identity.attributeId}::uuid
      and pav.attribute_value_id = ${identity.attributeValueId}::uuid
    left join public.pim_attribute_reviews r
      on r.product_id = ${identity.productId}::uuid
      and r.attribute_id = ${identity.attributeId}::uuid
      and r.attribute_value_id = ${identity.attributeValueId}::uuid
    where a.id = ${identity.attributeId}::uuid
    order by v.created_at, v.id
    limit 1
  `)) as unknown as Row[];

  const row = rows[0];
  const reasonCodes: EligibilityReasonCode[] = [];

  if (!row) return { eligible: false, reasonCodes: ["ASSOCIATION_NOT_FOUND"], sku: null, attributeCode: null, value: null };
  if (row.displayValue === null) {
    // attribute_value_id does not resolve to any real row -- report and stop;
    // there is no meaningful value to check the remaining gates against.
    return { eligible: false, reasonCodes: ["ATTRIBUTE_VALUE_MISMATCH"], sku: row.sku, attributeCode: row.attributeCode, value: null };
  }
  if (!row.identityMatches) reasonCodes.push("ASSOCIATION_NOT_FOUND");
  if (!SUPPORTED_ATTRIBUTE_CODES.includes(row.attributeCode as SupportedAttributeCode)) reasonCodes.push("ATTRIBUTE_NOT_SUPPORTED");
  if (row.attributeCode === "material" && row.description && TEMPLATE_PLACEHOLDER_PATTERN.test(row.description)) reasonCodes.push("KNOWN_FALSE_POSITIVE");
  if (row.reviewStatus === "rejected") reasonCodes.push("HUMAN_REVIEW_REJECTED");
  // Structural NEEDS_REVIEW: any pim_attribute_reviews row left at the
  // default 'needs_review' status (never approved) blocks -- this is the
  // mechanism every FUTURE needs-review case should use (the existing
  // admin review workflow already creates rows shaped exactly like this).
  if (row.reviewStatus === "needs_review") reasonCodes.push("NEEDS_REVIEW");
  // Fail-closed stopgap (A3.5E-P3-B, Section 8): the two historical cases
  // that predate the structural mechanism above. See
  // publication-needs-review-registry.ts for why this is not a caller
  // responsibility and not SKU-as-authority.
  if (isKnownNeedsReview(row.sku, row.attributeCode)) reasonCodes.push("NEEDS_REVIEW");
  if (row.openConflictSameAttribute) reasonCodes.push("OPEN_CONFLICT_SAME_ATTRIBUTE");

  return { eligible: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)], sku: row.sku, attributeCode: row.attributeCode, value: row.displayValue };
}

export async function evaluatePublicationEligibilityBatch(db: Executor, identities: PublicationIdentity[]): Promise<Map<string, EligibilityResult>> {
  const results = new Map<string, EligibilityResult>();
  for (const identity of identities) {
    results.set(`${identity.productId}:${identity.attributeId}:${identity.attributeValueId}`, await evaluatePublicationEligibility(db, identity));
  }
  return results;
}
