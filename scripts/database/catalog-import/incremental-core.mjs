import { createHash } from "node:crypto";
import { MAX_SYNC_ATTEMPTS, classifySyncFailure, retryDelayMs } from "../../../lib/catalog/incrementalSync.ts";

export function payloadHash(payload) { return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex"); }

export async function enqueueSignal(sql, event) {
  const rows = await sql`insert into public.integration_inbox(source,event_type,external_event_id,entity_type,external_entity_id,payload_hash,source_changed_at)
    values('woocommerce',${event.eventType},${event.externalEventId},${event.entityType},${String(event.externalEntityId)},${event.payloadHash??null},${event.sourceChangedAt??null})
    on conflict(source,external_event_id) do nothing returning id`;
  return rows.length ? "insert" : "noop";
}

export async function claimSignals(sql, workerId, limit = 10) {
  return sql.begin(async (tx) => {await tx`update public.integration_inbox set status='retry',locked_at=null,locked_by=null,next_attempt_at=now(),last_error_code='STALE_LEASE_RECOVERED' where status='processing' and locked_at<now()-interval '5 minutes'`;return tx`with work as (
    select id from public.integration_inbox where status in ('pending','retry') and next_attempt_at<=now()
    order by next_attempt_at,received_at,id for update skip locked limit ${limit}
  ) update public.integration_inbox i set status='processing',attempts=i.attempts+1,locked_at=now(),locked_by=${workerId}
    from work where i.id=work.id returning i.*`;});
}

export async function finishSignal(sql, row, outcome) {
  if (outcome.ok) return sql`update public.integration_inbox set status='processed',processed_at=now(),result=${outcome.result},duration_ms=${outcome.durationMs},last_error_code=null,locked_at=null,locked_by=null where id=${row.id}`;
  const kind = classifySyncFailure(outcome.error), dead = kind === "permanent" || row.attempts >= MAX_SYNC_ATTEMPTS;
  const delay = retryDelayMs(row.attempts);
  return sql`update public.integration_inbox set status=${dead?"dead_letter":"retry"},last_error_code=${outcome.code},next_attempt_at=now()+(${delay}::text||' milliseconds')::interval,locked_at=null,locked_by=null where id=${row.id}`;
}
