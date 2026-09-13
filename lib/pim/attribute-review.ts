import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";
import { pimAttributeDecisionSchema, type PimAttributeDecisionInput } from "@/lib/validation/pimEditorial";
import { listAttributeCandidates } from "@/lib/pim/attribute-conflict";
import { requireActor, type PimAdminAuditContext } from "@/lib/pim/workflow";

export class PimAttributeNotFoundError extends Error {
  readonly code = "PIM_ATTRIBUTE_NOT_FOUND";
  constructor() { super("Este atributo não está atribuído ao produto."); }
}

export class PimAttributeInvalidSelectionError extends Error {
  readonly code = "PIM_ATTRIBUTE_INVALID_SELECTION";
  constructor(message = "A seleção não corresponde aos valores reais deste atributo. Atualize a página.") { super(message); }
}

export class PimAttributeStaleDecisionError extends Error {
  readonly code = "PIM_ATTRIBUTE_STALE_DECISION";
  constructor() { super("Este atributo foi alterado por outra pessoa desde que você abriu a página. Atualize os dados antes de salvar sua decisão."); }
}

// General attribute review: works with or without an open pim_conflicts row.
// Every real product_attribute_values candidate for the (product, attribute)
// pair must be explicitly classified as approved or rejected in the same
// call — never left ambiguous. Reapplying this to an already-decided
// attribute is how a wrong decision gets corrected: it does not overwrite
// silently, it upserts pim_attribute_reviews and writes a fresh, distinct
// audit row (ATTRIBUTE_DECISION_CHANGED) on top of the preserved history.
export async function reviewPimAttribute(raw: PimAttributeDecisionInput, actorReference: string, context?: PimAdminAuditContext) {
  const input = pimAttributeDecisionSchema.parse(raw), actor = requireActor(actorReference);
  return getDatabase().transaction(async (tx) => {
    // Serializes concurrent decisions on the same (product, attribute) pair —
    // the same advisory-lock pattern already used by the DB trigger that
    // enforces single-cardinality assignment (validate_attribute_assignment).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.productId} || ':' || ${input.attributeId}, 0))`);

    const match = await listAttributeCandidates(tx, input.productId, input.attributeId);
    if (!match) throw new PimAttributeNotFoundError();
    // Optimistic concurrency (A3.4C): compares the decision version the UI
    // loaded against the current one, still inside the advisory lock — a
    // mismatch means someone else recorded a decision since this page was
    // opened. Nothing is written below this check when it fails.
    if (BigInt(match.decisionVersion) !== input.expectedDecisionVersion) throw new PimAttributeStaleDecisionError();

    const realIds = new Set(match.candidates.map((candidate) => candidate.attributeValueId));
    const decidedIds = new Set([...input.approvedAttributeValueIds, ...input.rejectedAttributeValueIds]);
    const allRealCovered = match.candidates.every((candidate) => decidedIds.has(candidate.attributeValueId));
    const noForeignIds = [...decidedIds].every((id) => realIds.has(id));
    if (!allRealCovered || !noForeignIds) throw new PimAttributeInvalidSelectionError();
    if (match.cardinality === "single" && input.approvedAttributeValueIds.length !== 1) {
      throw new PimAttributeInvalidSelectionError("Este atributo aceita exatamente um valor aprovado.");
    }

    const alreadyDecided = match.candidates.some((candidate) => candidate.reviewStatus === "approved" || candidate.reviewStatus === "rejected");

    for (const candidate of match.candidates) {
      const status = input.approvedAttributeValueIds.includes(candidate.attributeValueId) ? "approved" : "rejected";
      await tx.execute(sql`insert into pim_attribute_reviews(product_id,attribute_id,attribute_value_id,source,status,reviewed_by,reviewed_at)
        values(${input.productId}::uuid,${input.attributeId}::uuid,${candidate.attributeValueId}::uuid,'manual',${status},${actor},now())
        on conflict(product_id,attribute_id,attribute_value_id) do update set status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now()`);
    }

    // Increments the decision version atomically in the same transaction —
    // still under the advisory lock, so this and the version check above can
    // never race against another writer for this (product, attribute) pair.
    const versionRow = await tx.execute(sql`insert into pim_attribute_decisions(product_id,attribute_id,version,updated_at)
      values(${input.productId}::uuid,${input.attributeId}::uuid,1,now())
      on conflict(product_id,attribute_id) do update set version=pim_attribute_decisions.version+1,updated_at=now()
      returning version::text`);
    const newDecisionVersion = (versionRow as unknown as Array<{ version: string }>)[0].version;

    const approvedValues = match.candidates.filter((candidate) => input.approvedAttributeValueIds.includes(candidate.attributeValueId)).map((candidate) => candidate.displayValue);
    const rejectedValues = match.candidates.filter((candidate) => input.rejectedAttributeValueIds.includes(candidate.attributeValueId)).map((candidate) => candidate.displayValue);
    const operation = alreadyDecided ? "ATTRIBUTE_DECISION_CHANGED" : "ATTRIBUTE_DECISION_RECORDED";

    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id)
      values(${input.productId}::uuid,'attribute',${input.attributeId}::uuid,${match.attributeName},${JSON.stringify(match.candidates.map((c) => ({ value: c.displayValue, previousStatus: c.reviewStatus })))},${JSON.stringify({ approved: approvedValues, rejected: rejectedValues })},'manual',${actor},${operation},${input.reason},${context?.identityProvider ?? null},${context?.identitySubject ?? null},${context?.adminSessionId ?? null}::uuid,${context?.membershipId ?? null}::uuid,${context?.effectiveRole ?? null},${context?.correlationId ?? null}::uuid)`);

    return { productId: input.productId, attributeId: input.attributeId, approvedValues, rejectedValues, changed: alreadyDecided, newDecisionVersion };
  });
}
