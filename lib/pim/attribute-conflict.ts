import "server-only";
import { sql } from "drizzle-orm";
import { ATTRIBUTE_ALIASES } from "./extractor.ts";
import type { PimAttributeCode } from "./enrichment-types.ts";
import type { PersiDatabase } from "@/lib/db";

// pim_conflicts.attribute_key uses the extractor's English PimAttributeCode
// namespace (e.g. "color"), while public.attributes.name is the catalog's
// Portuguese display name (e.g. "Cor"). ATTRIBUTE_ALIASES is the single
// existing, already-deterministic mapping between the two; this module only
// reverses it for lookup instead of introducing a second, parallel mapping.
const REVERSE_ALIASES = new Map<PimAttributeCode, string[]>();
for (const [portuguese, code] of Object.entries(ATTRIBUTE_ALIASES)) {
  const list = REVERSE_ALIASES.get(code) ?? [];
  list.push(portuguese);
  REVERSE_ALIASES.set(code, list);
}

export type AttributeConflictCandidate = { attributeValueId: string; displayValue: string; reviewStatus: string | null };
export type AttributeConflictMatch = { attributeId: string; attributeName: string; candidates: AttributeConflictCandidate[] };

type Executor = { execute: PersiDatabase["execute"] };

// Read-only: finds the real, already-persisted product_attribute_values rows
// that a given pim_conflicts.attribute_key most likely refers to for one
// product. Returns null when the conflict does not correspond to a
// structured attribute with two or more competing assigned values — callers
// must fall back to the plain (non-semantic) conflict resolution in that case.
export async function findConflictAttributeCandidates(executor: Executor, productId: string, attributeKey: string): Promise<AttributeConflictMatch | null> {
  const aliases = REVERSE_ALIASES.get(attributeKey as PimAttributeCode) ?? [attributeKey];
  const normalizedAliases = sql.join(aliases.map((value) => sql`public.immutable_unaccent_lower(${value})`), sql`, `);
  const rows = (await executor.execute(sql`
    select a.id::text as "attributeId", a.name as "attributeName",
      av.id::text as "attributeValueId", av.display_value as "displayValue",
      r.status::text as "reviewStatus"
    from public.product_attribute_values pav
    join public.attributes a on a.id = pav.attribute_id
    join public.attribute_values av on av.id = pav.attribute_value_id
    left join public.pim_attribute_reviews r
      on r.product_id = pav.product_id and r.attribute_id = pav.attribute_id and r.attribute_value_id = pav.attribute_value_id
    where pav.product_id = ${productId}::uuid
      and public.immutable_unaccent_lower(a.name) in (${normalizedAliases})
    order by av.display_value
  `)) as unknown as Array<{ attributeId: string; attributeName: string; attributeValueId: string; displayValue: string; reviewStatus: string | null }>;

  if (rows.length < 2) return null;
  return {
    attributeId: rows[0].attributeId,
    attributeName: rows[0].attributeName,
    candidates: rows.map((row) => ({ attributeValueId: row.attributeValueId, displayValue: row.displayValue, reviewStatus: row.reviewStatus })),
  };
}

export type AttributeCandidates = { attributeId: string; attributeName: string; cardinality: "single" | "multiple"; decisionVersion: string; candidates: AttributeConflictCandidate[] };

// Read-only: lists every real product_attribute_values row for one
// (product, attribute) pair, regardless of whether a pim_conflicts row
// exists. Used by the general attribute review workflow (A3.4), which must
// work even when there is no conflict to resolve.
//
// decisionVersion (A3.4C) comes from pim_attribute_decisions, a table
// dedicated to versioning the DECISION as a whole — pim_attribute_reviews
// has one row per candidate value, not per decision, so it cannot itself
// carry a single optimistic-concurrency counter. Absence of a row means
// version 0, the same convention pim_product_profiles uses for a product
// with no profile yet.
export async function listAttributeCandidates(executor: Executor, productId: string, attributeId: string): Promise<AttributeCandidates | null> {
  const rows = (await executor.execute(sql`
    select a.id::text as "attributeId", a.name as "attributeName", a.cardinality::text as cardinality,
      av.id::text as "attributeValueId", av.display_value as "displayValue",
      r.status::text as "reviewStatus",
      coalesce((select d.version from public.pim_attribute_decisions d where d.product_id = pav.product_id and d.attribute_id = pav.attribute_id), 0)::text as "decisionVersion"
    from public.product_attribute_values pav
    join public.attributes a on a.id = pav.attribute_id
    join public.attribute_values av on av.id = pav.attribute_value_id
    left join public.pim_attribute_reviews r
      on r.product_id = pav.product_id and r.attribute_id = pav.attribute_id and r.attribute_value_id = pav.attribute_value_id
    where pav.product_id = ${productId}::uuid and pav.attribute_id = ${attributeId}::uuid
    order by av.display_value
  `)) as unknown as Array<{ attributeId: string; attributeName: string; cardinality: string; attributeValueId: string; displayValue: string; reviewStatus: string | null; decisionVersion: string }>;

  if (rows.length === 0) return null;
  return {
    attributeId: rows[0].attributeId,
    attributeName: rows[0].attributeName,
    cardinality: rows[0].cardinality === "multiple" ? "multiple" : "single",
    decisionVersion: rows[0].decisionVersion,
    candidates: rows.map((row) => ({ attributeValueId: row.attributeValueId, displayValue: row.displayValue, reviewStatus: row.reviewStatus })),
  };
}
