import "server-only";
import { sql } from "drizzle-orm";
import type { PersiDatabase } from "@/lib/db";
import { isKnownNeedsReview } from "./publication-needs-review-registry";

export type PublicationIdentity = { productId: string; attributeId: string; attributeValueId: string };

export type EligibilityReasonCode =
  | "ASSOCIATION_NOT_FOUND"
  | "ATTRIBUTE_VALUE_MISMATCH"
  | "ATTRIBUTE_NOT_SUPPORTED"
  | "NOT_REVIEWED"
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

// A3.7-FINAL-A, Workstream B: the operational policy this project now
// enforces is "every value exposed publicly must have passed human
// review" -- so the ABSENCE of a pim_attribute_reviews row (reviewStatus
// === null, i.e. nobody has ever recorded a decision for this exact
// identity) must block exactly like an explicit 'rejected'/'needs_review'
// decision does. Before this round, a null reviewStatus produced ZERO
// reason codes -- an association that had NEVER been looked at by a human
// was silently treated as eligible. This is a deliberate policy reversal
// (forward-only: no historical publication/review row is rewritten), not a
// bug fix to prior eligibility gates, which is why it gets its own reason
// code (NOT_REVIEWED) rather than being folded into NEEDS_REVIEW --
// "nobody has looked at this yet" and "somebody looked and left it
// pending" are different operational states worth distinguishing in
// diagnostics and UI, even though both block identically today.
function evaluateEligibilityRow(row: Row | undefined): EligibilityResult {
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
  // NEW (Workstream B): no review row at all -- nobody has ever recorded a
  // decision for this exact identity. See the function-level comment above.
  if (row.reviewStatus === null) reasonCodes.push("NOT_REVIEWED");
  // Fail-closed stopgap (A3.5E-P3-B, Section 8): the two historical cases
  // that predate the structural mechanism above. See
  // publication-needs-review-registry.ts for why this is not a caller
  // responsibility and not SKU-as-authority.
  if (isKnownNeedsReview(row.sku, row.attributeCode)) reasonCodes.push("NEEDS_REVIEW");
  if (row.openConflictSameAttribute) reasonCodes.push("OPEN_CONFLICT_SAME_ATTRIBUTE");

  return { eligible: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)], sku: row.sku, attributeCode: row.attributeCode, value: row.displayValue };
}

const OPEN_CONFLICT_ATTRIBUTE_KEY_CASE = sql`case a.code
            when 'material' then 'material'
            when 'conexao' then 'connection'
            when 'comprimento' then 'length'
            when 'volume' then 'volume'
            else a.code
          end`;

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
          and c.attribute_key = ${OPEN_CONFLICT_ATTRIBUTE_KEY_CASE}
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

  return evaluateEligibilityRow(rows[0]);
}

// A3.7-FINAL-A, Workstream D: previously this looped, calling
// evaluatePublicationEligibility() (one round trip each) once per identity
// -- for a product with N published canary attributes (e.g. SKU 0117's 3),
// the storefront's Ficha Tecnica pipeline paid N sequential round trips for
// this ONE stage alone, on top of the cold-start connection cost already
// qualified in A3.7-A-R17-R2A-D6/D7. This rewrite fetches every identity's
// row in ONE query (a VALUES-based join keyed by an explicit ordinal so
// identities -- including duplicate ones, which the old loop also treated
// as separately-computed-but-identical -- map back deterministically) and
// reuses the EXACT SAME per-row gate evaluation (evaluateEligibilityRow)
// the single-identity function uses, so both call sites can never drift on
// what "eligible" means. Callers, return shape, and Map keys are all
// unchanged.
export async function evaluatePublicationEligibilityBatch(db: Executor, identities: PublicationIdentity[]): Promise<Map<string, EligibilityResult>> {
  const results = new Map<string, EligibilityResult>();
  if (identities.length === 0) return results;

  const rows = (await db.execute(sql`
    with identities(ord, product_id, attribute_id, attribute_value_id) as (
      values ${sql.join(
        identities.map((identity, index) => sql`(${index}, ${identity.productId}::uuid, ${identity.attributeId}::uuid, ${identity.attributeValueId}::uuid)`),
        sql`, `,
      )}
    ),
    ranked_variant as (
      select distinct on (i.ord) i.ord, v.sku
      from identities i
      join public.product_variants v on v.product_id = i.product_id
      order by i.ord, v.created_at, v.id
    )
    select
      i.ord::int as ord,
      rv.sku,
      a.code as "attributeCode",
      av.display_value as "displayValue",
      p.description,
      (pav.attribute_value_id is not null) as "identityMatches",
      r.status::text as "reviewStatus",
      exists(
        select 1 from public.pim_conflicts c
        where c.product_id = i.product_id
          and c.status = 'open'
          and c.attribute_key = ${OPEN_CONFLICT_ATTRIBUTE_KEY_CASE}
      ) as "openConflictSameAttribute"
    from identities i
    join public.attributes a on a.id = i.attribute_id
    join public.products p on p.id = i.product_id
    join ranked_variant rv on rv.ord = i.ord
    left join public.attribute_values av on av.id = i.attribute_value_id
    left join public.product_attribute_values pav
      on pav.product_id = i.product_id
      and pav.attribute_id = i.attribute_id
      and pav.attribute_value_id = i.attribute_value_id
    left join public.pim_attribute_reviews r
      on r.product_id = i.product_id
      and r.attribute_id = i.attribute_id
      and r.attribute_value_id = i.attribute_value_id
    order by i.ord
  `)) as unknown as Array<Row & { ord: number }>;

  const rowsByOrd = new Map<number, Row>(rows.map((row) => [row.ord, row]));
  identities.forEach((identity, index) => {
    results.set(`${identity.productId}:${identity.attributeId}:${identity.attributeValueId}`, evaluateEligibilityRow(rowsByOrd.get(index)));
  });
  return results;
}
