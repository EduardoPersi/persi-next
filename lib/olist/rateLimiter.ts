import "server-only";

import { sql } from "drizzle-orm";
import { withPersiRole, type PersiRole } from "@/lib/db/nativeCommerceAuthority";

// Postgres-backed token bucket + circuit breaker, shared across however
// many Node processes Hostinger actually runs (canary-minimum-scope.md
// Section 5.1) -- see supabase/migrations/20260926010000_*.sql for the
// SQL side. Every function here is a single standalone statement: never
// call these while holding a transaction/lock that also spans an HTTP
// call to Olist (the owner's explicit condition on the OAuth/API design).

export const OLIST_RATE_LIMIT_BUCKET = "olist_account";
export const OLIST_CIRCUIT_BREAKER_KEY = "olist_api";

export function getOlistRateLimitCeilingPerMinute(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(environment.OLIST_RATE_LIMIT_PER_MINUTE ?? "28");
  return Number.isFinite(raw) && raw > 0 ? raw : 28;
}

// Same value used as both bucket capacity and refill rate -- a full
// minute's worth of budget is available at any time, refilling
// continuously (Section 14.4: "token bucket com reposição contínua").
export async function consumeOlistRateLimit(
  role: PersiRole,
  tokensRequested = 1,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const ceiling = getOlistRateLimitCeilingPerMinute(environment);
  const result = await withPersiRole(role, (db) => db.execute<{ allowed: boolean }>(sql`
    select public.consume_olist_rate_limit(${OLIST_RATE_LIMIT_BUCKET}::text, ${tokensRequested}::numeric, ${ceiling}::numeric, ${ceiling}::numeric) as "allowed"
  `));
  return result[0]?.allowed === true;
}

export interface CircuitBreakerResult {
  isOpen: boolean;
  openedUntil: string | null;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SECONDS = 300;

export async function recordOlistApiResult(
  role: PersiRole,
  succeeded: boolean,
  options: { failureThreshold?: number; cooldownSeconds?: number } = {},
): Promise<CircuitBreakerResult> {
  const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownSeconds = options.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const result = await withPersiRole(role, (db) => db.execute<{ isOpen: boolean; openedUntil: string | null }>(sql`
    select is_open as "isOpen", opened_until as "openedUntil"
    from public.record_olist_api_result(${OLIST_CIRCUIT_BREAKER_KEY}::text, ${succeeded}::boolean, ${failureThreshold}::integer, ${cooldownSeconds}::integer)
  `));
  return { isOpen: result[0]?.isOpen === true, openedUntil: result[0]?.openedUntil ?? null };
}

export async function isOlistCircuitOpen(role: PersiRole): Promise<boolean> {
  const result = await withPersiRole(role, (db) => db.execute<{ open: boolean }>(sql`
    select public.is_olist_circuit_open(${OLIST_CIRCUIT_BREAKER_KEY}::text) as "open"
  `));
  return result[0]?.open === true;
}
