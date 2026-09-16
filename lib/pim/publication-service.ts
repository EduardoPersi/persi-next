import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase, type PersiDatabase } from "@/lib/db";
import { evaluatePublicationEligibility, type PublicationIdentity } from "./publication-eligibility";
import { CURRENT_PIM_BASELINE_SHA256 } from "./publication-baseline";

type PimTransaction = Parameters<Parameters<PersiDatabase["transaction"]>[0]>[0];

export type PublicationBatchKind = "canary" | "full";
export type PublicationBatchStatus = "active" | "rolled_back";

export type PublicationBatchMember = PublicationIdentity;

export type PublishBatchInput = {
  batchId?: string;
  kind: PublicationBatchKind;
  members: PublicationBatchMember[];
  baselineReference: string;
  reason?: string;
};

export type PublishBatchResult = {
  batchId: string;
  status: PublicationBatchStatus;
  publishedCount: number;
  idempotentReplay: boolean;
};

export class PimPublicationNoMembersError extends Error {
  readonly code = "PIM_PUBLICATION_NO_MEMBERS";
  constructor() { super("Um batch de publicação precisa de pelo menos uma identidade."); }
}

export class PimPublicationDuplicateMemberError extends Error {
  readonly code = "PIM_PUBLICATION_DUPLICATE_MEMBER";
  constructor() { super("O batch contém a mesma identidade (product_id+attribute_id+attribute_value_id) mais de uma vez."); }
}

export class PimPublicationBatchIdentityConflictError extends Error {
  readonly code = "PIM_PUBLICATION_BATCH_IDENTITY_CONFLICT";
  constructor() { super("Já existe um batch com este ID, mas com um conjunto de membros diferente. Use um novo batchId."); }
}

export class PimPublicationNotEligibleError extends Error {
  readonly code = "PIM_PUBLICATION_NOT_ELIGIBLE";
  readonly failures: Array<{ identity: PublicationIdentity; reasonCodes: string[] }>;
  constructor(failures: Array<{ identity: PublicationIdentity; reasonCodes: string[] }>) {
    super(`${failures.length} identidade(s) reprovaram no eligibility gate: ${failures.map((f) => f.reasonCodes.join("+")).join(", ")}`);
    this.failures = failures;
  }
}

export class PimPublicationBatchNotFoundError extends Error {
  readonly code = "PIM_PUBLICATION_BATCH_NOT_FOUND";
  constructor() { super("Batch de publicação não encontrado."); }
}

export class PimPublicationStaleBaselineError extends Error {
  readonly code = "PIM_PUBLICATION_STALE_BASELINE";
  constructor() { super(`baselineReference não corresponde ao baseline PIM v1 vigente (${CURRENT_PIM_BASELINE_SHA256}). Recarregue o estado antes de publicar.`); }
}

export class PimPublicationBatchAlreadyRolledBackError extends Error {
  readonly code = "PIM_PUBLICATION_BATCH_ALREADY_ROLLED_BACK";
  constructor() { super("Este batch id já foi revertido (rolled_back) e é terminal -- não pode ser republicado. Gere um novo batchId para republicar os mesmos membros."); }
}

export class PimPublicationOwnedByAnotherBatchError extends Error {
  readonly code = "PIM_PUBLICATION_OWNED_BY_ANOTHER_BATCH";
  readonly identity: PublicationIdentity;
  readonly owningBatchId: string;
  constructor(identity: PublicationIdentity, owningBatchId: string) {
    super(`A identidade product_id=${identity.productId} attribute_id=${identity.attributeId} já está publicada pelo batch ${owningBatchId}. Um novo batch nunca pode reatribuir (rebind) silenciosamente a propriedade de uma publicação ativa -- reverta o batch original primeiro (unpublishBatch) antes de publicar esta identidade sob um novo batch.`);
    this.identity = identity;
    this.owningBatchId = owningBatchId;
  }
}

function requireActor(actorReference: string): string {
  const actor = actorReference.trim();
  if (!actor || actor.length > 200) throw new Error("Ator de publicação inválido.");
  return actor;
}

function memberKey(m: PublicationBatchMember): string {
  return `${m.productId}:${m.attributeId}:${m.attributeValueId}`;
}

// Deterministic, order-independent fingerprint of a batch's membership --
// lets publishBatch() distinguish "the exact same batch replayed" (safe,
// idempotent no-op) from "this batch id reused with different membership"
// (rejected, never silently overwritten) without depending on request order.
export function computeMemberFingerprint(members: PublicationBatchMember[]): string {
  const sorted = [...members].map(memberKey).sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

// Single project-wide advisory lock for the publication subsystem. Batches
// are small (canary-sized) and infrequent by design in this foundation
// phase, so serializing all publish/unpublish operations behind one lock is
// the simplest correct answer to Section 15's concurrency requirement --
// row-level PK locking on pim_attribute_publications alone would already
// prevent a duplicate row for the SAME identity, but a whole batch must
// commit or fail as one unit, which a single lock guarantees trivially.
async function withPublicationLock<T>(tx: PimTransaction, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))`);
  return fn();
}

export async function preparePublication(members: PublicationBatchMember[], baselineReference: string): Promise<Array<{ identity: PublicationIdentity; eligible: boolean; reasonCodes: string[]; sku: string | null; attributeCode: string | null; value: string | null }>> {
  if (baselineReference !== CURRENT_PIM_BASELINE_SHA256) throw new PimPublicationStaleBaselineError();
  const db = getDatabase();
  const results = [];
  for (const identity of members) {
    const result = await evaluatePublicationEligibility(db, identity);
    results.push({ identity, eligible: result.eligible, reasonCodes: result.reasonCodes, sku: result.sku, attributeCode: result.attributeCode, value: result.value });
  }
  return results;
}

export async function publishBatch(input: PublishBatchInput, actorReference: string): Promise<PublishBatchResult> {
  const actor = requireActor(actorReference);
  if (input.members.length === 0) throw new PimPublicationNoMembersError();
  const keys = input.members.map(memberKey);
  if (new Set(keys).size !== keys.length) throw new PimPublicationDuplicateMemberError();
  // Fail-closed baseline check (A3.5E-P3-B, Section 16): a publish attempt
  // carrying any reference other than the currently-authoritative PIM v1
  // baseline is rejected BEFORE eligibility or any write -- this is what
  // makes "publish after the expected baseline changes" a rejection instead
  // of a silent publish against data nobody re-qualified.
  if (input.baselineReference !== CURRENT_PIM_BASELINE_SHA256) throw new PimPublicationStaleBaselineError();
  const fingerprint = computeMemberFingerprint(input.members);

  return getDatabase().transaction(async (tx) => withPublicationLock(tx, async () => {
    let batchId = input.batchId;
    if (batchId) {
      const existing = (await tx.execute(sql`select id::text as id, member_fingerprint as "memberFingerprint", status::text as status from public.pim_publication_batches where id=${batchId}::uuid`)) as unknown as Array<{ id: string; memberFingerprint: string; status: PublicationBatchStatus }>;
      if (existing.length > 0) {
        // A rolled-back batch id is a TERMINAL identity (Section 18's state
        // machine: active -> rolled_back is one-way). Reusing it -- even
        // with the exact same membership -- must never be reinterpreted as
        // "still published"; it is not. Republishing the same members
        // requires a fresh batch id.
        if (existing[0].status === "rolled_back") throw new PimPublicationBatchAlreadyRolledBackError();
        if (existing[0].memberFingerprint !== fingerprint) throw new PimPublicationBatchIdentityConflictError();
        // Exact same batch id + exact same membership replayed while still
        // active: idempotent, known state -- report it without writing
        // anything new.
        const countRow = (await tx.execute(sql`select count(*)::int as c from public.pim_attribute_publications where batch_id=${batchId}::uuid and state='published'`)) as unknown as Array<{ c: number }>;
        return { batchId, status: existing[0].status, publishedCount: countRow[0].c, idempotentReplay: true };
      }
    }

    // Fresh eligibility check INSIDE the transaction/lock, never trusting a
    // prior preparePublication() call -- closes the prepare/publish drift
    // window Section 13 asks for explicitly.
    const failures: Array<{ identity: PublicationIdentity; reasonCodes: string[] }> = [];
    for (const identity of input.members) {
      const result = await evaluatePublicationEligibility(tx, identity);
      if (!result.eligible) failures.push({ identity, reasonCodes: result.reasonCodes });
    }
    if (failures.length > 0) throw new PimPublicationNotEligibleError(failures);

    // Generated application-side (crypto.randomUUID()) rather than left to
    // the database default -- the caller needs a stable id to hand back
    // synchronously even before this INSERT round-trips, and idempotency
    // above already depends on the caller being able to supply the same id
    // again on retry.
    const newBatchId = batchId ?? randomUUID();
    await tx.execute(sql`
      insert into public.pim_publication_batches (id, kind, member_fingerprint, baseline_reference, created_by, note)
      values (${newBatchId}::uuid, ${input.kind}, ${fingerprint}, ${input.baselineReference ?? null}, ${actor}, ${input.reason ?? null})
    `);
    batchId = newBatchId;

    for (const identity of input.members) {
      // Cross-batch ownership guard (A3.5E-P3-F, Section 16): this loop only
      // ever runs for a BRAND NEW batch id (an existing batch id already
      // short-circuited above, idempotent-replay or rejected). So if this
      // exact identity already has a row here, it is NECESSARILY owned by a
      // DIFFERENT, pre-existing batch -- an ON CONFLICT DO UPDATE would
      // silently steal it (rebind batch_id, reset published_at) with no
      // trace of which batch it took it from. Lock the row first and branch
      // explicitly: a currently-published row is never rebound; only a row
      // that is absent, or was previously unpublished (rolled_back), may be
      // (re)published under this new batch.
      const existingRow = (await tx.execute(sql`
        select state::text as state, batch_id::text as "batchId" from public.pim_attribute_publications
        where product_id=${identity.productId}::uuid and attribute_id=${identity.attributeId}::uuid and attribute_value_id=${identity.attributeValueId}::uuid
        for update
      `)) as unknown as Array<{ state: string; batchId: string }>;
      if (existingRow.length > 0 && existingRow[0].state === "published") {
        throw new PimPublicationOwnedByAnotherBatchError(identity, existingRow[0].batchId);
      }
      await tx.execute(sql`
        insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference, reason)
        values (${identity.productId}::uuid, ${identity.attributeId}::uuid, ${identity.attributeValueId}::uuid, 'published', ${batchId}::uuid, now(), ${actor}, ${input.reason ?? null})
        on conflict (product_id, attribute_id, attribute_value_id) do update set
          state='published', batch_id=excluded.batch_id, published_at=now(), unpublished_at=null,
          actor_reference=excluded.actor_reference, reason=excluded.reason
      `);
      await tx.execute(sql`
        insert into public.pim_audit_log (product_id, entity_type, entity_id, field_name, previous_value, new_value, source, actor_reference, operation, reason)
        select ${identity.productId}::uuid, 'attribute', ${identity.attributeId}::uuid, a.code, null, av.display_value, 'manual', ${actor}, 'ATTRIBUTE_PUBLISHED',
          ${`A3.5E-P3-A publishBatch: batch=${batchId} kind=${input.kind} reason=${input.reason ?? "n/a"}`}
        from public.attributes a join public.attribute_values av on av.id=${identity.attributeValueId}::uuid
        where a.id=${identity.attributeId}::uuid
      `);
    }

    return { batchId, status: "active" as const, publishedCount: input.members.length, idempotentReplay: false };
  }));
}

export async function unpublishBatch(batchId: string, actorReference: string, reason?: string): Promise<{ batchId: string; status: PublicationBatchStatus; unpublishedCount: number; idempotentReplay: boolean }> {
  const actor = requireActor(actorReference);
  return getDatabase().transaction(async (tx) => withPublicationLock(tx, async () => {
    const batchRows = (await tx.execute(sql`select id::text as id, status::text as status from public.pim_publication_batches where id=${batchId}::uuid`)) as unknown as Array<{ id: string; status: PublicationBatchStatus }>;
    if (batchRows.length === 0) throw new PimPublicationBatchNotFoundError();
    if (batchRows[0].status === "rolled_back") {
      const countRow = (await tx.execute(sql`select count(*)::int as c from public.pim_attribute_publications where batch_id=${batchId}::uuid and state='unpublished'`)) as unknown as Array<{ c: number }>;
      return { batchId, status: "rolled_back" as const, unpublishedCount: countRow[0].c, idempotentReplay: true };
    }

    const affected = (await tx.execute(sql`
      update public.pim_attribute_publications
      set state='unpublished', unpublished_at=now()
      where batch_id=${batchId}::uuid and state='published'
      returning product_id::text as "productId", attribute_id::text as "attributeId"
    `)) as unknown as Array<{ productId: string; attributeId: string }>;

    for (const row of affected) {
      await tx.execute(sql`
        insert into public.pim_audit_log (product_id, entity_type, entity_id, field_name, previous_value, new_value, source, actor_reference, operation, reason)
        select ${row.productId}::uuid, 'attribute', ${row.attributeId}::uuid, a.code, 'published', null, 'manual', ${actor}, 'ATTRIBUTE_UNPUBLISHED',
          ${`A3.5E-P3-A unpublishBatch: batch=${batchId} reason=${reason ?? "n/a"}`}
        from public.attributes a where a.id=${row.attributeId}::uuid
      `);
    }

    await tx.execute(sql`update public.pim_publication_batches set status='rolled_back', rolled_back_at=now(), rolled_back_by=${actor} where id=${batchId}::uuid`);

    return { batchId, status: "rolled_back" as const, unpublishedCount: affected.length, idempotentReplay: false };
  }));
}

export async function getPublicationState(batchId: string) {
  const db = getDatabase();
  const batch = (await db.execute(sql`select id::text as id, kind::text as kind, status::text as status, member_fingerprint as "memberFingerprint", baseline_reference as "baselineReference", created_by as "createdBy", created_at as "createdAt", rolled_back_at as "rolledBackAt", rolled_back_by as "rolledBackBy", note from public.pim_publication_batches where id=${batchId}::uuid`)) as unknown as Array<Record<string, unknown>>;
  if (batch.length === 0) return null;
  const members = await db.execute(sql`
    select v.sku, a.code as "attributeCode", av.display_value as "displayValue", pap.state::text as state, pap.published_at as "publishedAt", pap.unpublished_at as "unpublishedAt"
    from public.pim_attribute_publications pap
    join public.product_variants v on v.product_id = pap.product_id
    join public.attributes a on a.id = pap.attribute_id
    join public.attribute_values av on av.id = pap.attribute_value_id
    where pap.batch_id = ${batchId}::uuid
    order by v.sku, a.code
  `);
  return { batch: batch[0], members };
}
