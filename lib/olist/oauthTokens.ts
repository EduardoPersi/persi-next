import "server-only";

import { sql } from "drizzle-orm";
import { withPersiRole, type PersiRole } from "@/lib/db/nativeCommerceAuthority";

export type OlistOAuthApp = "catalogo" | "pedidos";
export type OlistOAuthEnvironment = "staging" | "production";

export interface OlistOAuthTokenRow {
  [key: string]: unknown;
  accessCiphertext: string | null;
  accessIv: string | null;
  accessAuthTag: string | null;
  accessKeyId: string | null;
  accessExpiresAt: string | null;
  refreshCiphertext: string | null;
  refreshIv: string | null;
  refreshAuthTag: string | null;
  refreshKeyId: string | null;
  refreshExpiresAt: string | null;
  envelopeVersion: number;
  refreshClaimedBy: string | null;
  refreshClaimedAt: string | null;
  version: bigint;
  lastRefreshedAt: string | null;
}

const ROW_COLUMNS = sql`
  access_ciphertext as "accessCiphertext", access_iv as "accessIv", access_auth_tag as "accessAuthTag",
  access_key_id as "accessKeyId", access_expires_at as "accessExpiresAt",
  refresh_ciphertext as "refreshCiphertext", refresh_iv as "refreshIv", refresh_auth_tag as "refreshAuthTag",
  refresh_key_id as "refreshKeyId", refresh_expires_at as "refreshExpiresAt",
  envelope_version as "envelopeVersion", refresh_claimed_by as "refreshClaimedBy",
  refresh_claimed_at as "refreshClaimedAt", version, last_refreshed_at as "lastRefreshedAt"
`;

export async function readOlistOAuthToken(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
): Promise<OlistOAuthTokenRow | null> {
  const result = await withPersiRole(role, (db) => db.execute<OlistOAuthTokenRow>(sql`
    select ${ROW_COLUMNS} from public.read_oauth_integration_token('olist'::text, ${app}::text, ${environment}::text)
  `));
  const row = result[0];
  return row && row.accessCiphertext !== null ? row : null;
}

export interface OlistTokenEnvelopeInput {
  accessCiphertext: string;
  accessIv: string;
  accessAuthTag: string;
  accessKeyId: string;
  accessExpiresAt: Date;
  refreshCiphertext: string;
  refreshIv: string;
  refreshAuthTag: string;
  refreshKeyId: string;
  refreshExpiresAt: Date | null;
  envelopeVersion: number;
}

// Used only for the owner's one-time browser authorization (or a full
// re-authorization after revocation) -- no claim needed, there is nothing
// concurrent to race against the very first grant.
export async function upsertOlistOAuthToken(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  input: OlistTokenEnvelopeInput,
): Promise<void> {
  await withPersiRole(role, (db) => db.execute(sql`
    select public.upsert_oauth_integration_token(
      'olist'::text, ${app}::text, ${environment}::text,
      ${input.accessCiphertext}::text, ${input.accessIv}::text, ${input.accessAuthTag}::text, ${input.accessKeyId}::text, ${input.accessExpiresAt.toISOString()}::timestamptz,
      ${input.refreshCiphertext}::text, ${input.refreshIv}::text, ${input.refreshAuthTag}::text, ${input.refreshKeyId}::text, ${input.refreshExpiresAt ? input.refreshExpiresAt.toISOString() : null}::timestamptz,
      ${input.envelopeVersion}::integer
    )
  `));
}

// Standalone, autocommitted -- callers must NOT wrap this in a transaction
// that also makes the HTTP call to Olist's token endpoint (the owner's
// explicit condition: no HTTP call inside a Postgres transaction/lock).
export async function claimOlistOAuthTokenRefresh(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  claimant: string,
  leaseSeconds = 30,
): Promise<boolean> {
  const result = await withPersiRole(role, (db) => db.execute<{ claimed: boolean }>(sql`
    select coalesce(public.claim_oauth_token_refresh('olist'::text, ${app}::text, ${environment}::text, ${claimant}::text, ${leaseSeconds}::integer), false) as "claimed"
  `));
  return result[0]?.claimed === true;
}

export async function releaseOlistOAuthTokenRefreshClaim(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  claimant: string,
): Promise<void> {
  await withPersiRole(role, (db) => db.execute(sql`
    select public.release_oauth_token_refresh_claim('olist'::text, ${app}::text, ${environment}::text, ${claimant}::text)
  `));
}

// Returns false if the claim's lease expired and another process already
// won and wrote its own refresh -- the caller must discard its own result
// and re-read (readOlistOAuthToken) instead of overwriting a newer token.
export async function writeOlistOAuthToken(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  claimant: string,
  input: OlistTokenEnvelopeInput,
): Promise<boolean> {
  const result = await withPersiRole(role, (db) => db.execute<{ written: boolean }>(sql`
    select coalesce(public.write_oauth_integration_token(
      'olist'::text, ${app}::text, ${environment}::text, ${claimant}::text,
      ${input.accessCiphertext}::text, ${input.accessIv}::text, ${input.accessAuthTag}::text, ${input.accessKeyId}::text, ${input.accessExpiresAt.toISOString()}::timestamptz,
      ${input.refreshCiphertext}::text, ${input.refreshIv}::text, ${input.refreshAuthTag}::text, ${input.refreshKeyId}::text, ${input.refreshExpiresAt ? input.refreshExpiresAt.toISOString() : null}::timestamptz,
      ${input.envelopeVersion}::integer
    ), false) as "written"
  `));
  return result[0]?.written === true;
}
