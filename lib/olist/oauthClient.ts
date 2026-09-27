import "server-only";

import { randomUUID } from "node:crypto";
import type { PersiRole } from "@/lib/db/nativeCommerceAuthority";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import {
  claimOlistOAuthTokenRefresh,
  readOlistOAuthToken,
  releaseOlistOAuthTokenRefreshClaim,
  upsertOlistOAuthToken,
  writeOlistOAuthToken,
  type OlistOAuthApp,
  type OlistOAuthEnvironment,
  type OlistOAuthTokenRow,
} from "./oauthTokens";
import {
  decryptOlistOAuthToken,
  encryptOlistOAuthToken,
  environmentOlistOAuthKeys,
  type OlistOAuthKeyProvider,
} from "@/lib/commerce/olistOAuthTokenCrypto";

// Grant type and endpoints confirmed in
// docs/native-commerce/olist-oauth-flow-design.md Section 1 -- the same
// Keycloak/OIDC realm wordpress-plugin/persi-catalog-engine already
// authenticates against in production for its own (unrelated) GTIN app.
export const OLIST_OAUTH_AUTHORIZATION_ENDPOINT =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
export const OLIST_OAUTH_TOKEN_ENDPOINT =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
export const OLIST_OAUTH_CALLBACK_PATH = "/api/admin/olist/oauth/callback";

// Redirect URI is resolved per environment from its own env var (same
// pattern as MELHOR_ENVIO_REDIRECT_URI in .env.example), never hardcoded
// into a client_id -- this is what lets one client work whether the Olist
// panel allows multiple redirect URIs per "Aplicativo" or requires one
// client per environment (olist-integration-design.md Section 14,
// condition 3): in either case, the owner controls
// OLIST_SYNC_CLIENT_ID/SECRET and OLIST_ORDERS_CLIENT_ID/SECRET's *values*
// and these two redirect-URI variables per deployment, and this function
// never needs to know or branch on which scenario is in effect. A sane
// default is used only if the env var is unset, so nothing breaks before
// the owner configures it.
export function getOlistOAuthRedirectUri(
  environment: OlistOAuthEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const varName = environment === "production" ? "OLIST_OAUTH_REDIRECT_URI_PRODUCTION" : "OLIST_OAUTH_REDIRECT_URI_STAGING";
  const configured = env[varName]?.trim();
  if (configured) return configured;
  const base = environment === "production" ? "https://persimateriais.com.br" : "https://staging.persimateriais.com.br";
  return `${base}${OLIST_OAUTH_CALLBACK_PATH}`;
}

function appEnvVarNames(app: OlistOAuthApp): { clientId: string; clientSecret: string } {
  return app === "catalogo"
    ? { clientId: "OLIST_SYNC_CLIENT_ID", clientSecret: "OLIST_SYNC_CLIENT_SECRET" }
    : { clientId: "OLIST_ORDERS_CLIENT_ID", clientSecret: "OLIST_ORDERS_CLIENT_SECRET" };
}

export interface OlistOAuthAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOlistOAuthAppConfig(
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): OlistOAuthAppConfig {
  const names = appEnvVarNames(app);
  const clientId = env[names.clientId]?.trim();
  const clientSecret = env[names.clientSecret]?.trim();
  if (!clientId || !clientSecret) throw new Error("OLIST_OAUTH_APP_NOT_CONFIGURED");
  return { clientId, clientSecret, redirectUri: getOlistOAuthRedirectUri(environment, env) };
}

export function buildOlistAuthorizationUrl(input: { config: OlistOAuthAppConfig; state: string }): URL {
  const url = new URL(OLIST_OAUTH_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url;
}

interface OlistTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
}

function isOlistTokenResponse(value: unknown): value is OlistTokenResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).access_token === "string" &&
    typeof (value as Record<string, unknown>).refresh_token === "string" &&
    typeof (value as Record<string, unknown>).expires_in === "number"
  );
}

// Standard OAuth2 error response shape (RFC 6749 Section 5.2) -- these two
// fields are error CODES/descriptions from the provider, never a secret or
// a token, so they are the only part of a failed response ever logged.
function extractOlistOAuthErrorFields(body: unknown): { error?: string; errorDescription?: string } {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  return {
    error: typeof record.error === "string" ? record.error.slice(0, 100) : undefined,
    errorDescription: typeof record.error_description === "string" ? record.error_description.slice(0, 300) : undefined,
  };
}

async function requestOlistToken(
  body: Record<string, string>,
  fetchImplementation: typeof fetch,
): Promise<OlistTokenResponse> {
  let response: Response;
  try {
    response = await fetchImplementation(OLIST_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    logNativeCommerceEvent("native_olist_oauth_token_exchange_failed", {
      code: error instanceof Error ? `NETWORK_${error.name}` : "NETWORK_UNKNOWN",
    });
    throw new Error("OLIST_OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || !isOlistTokenResponse(json)) {
    const { error, errorDescription } = extractOlistOAuthErrorFields(json);
    logNativeCommerceEvent("native_olist_oauth_token_exchange_failed", {
      code: `HTTP_${response.status}${error ? `:${error}` : ""}${errorDescription ? ` (${errorDescription})` : ""}`,
    });
    throw new Error("OLIST_OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  return json;
}

export async function exchangeOlistAuthorizationCode(
  input: { app: OlistOAuthApp; environment: OlistOAuthEnvironment; code: string; config: OlistOAuthAppConfig },
  options: { fetchImplementation?: typeof fetch } = {},
): Promise<OlistTokenResponse> {
  return requestOlistToken(
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.redirectUri,
    },
    options.fetchImplementation ?? fetch,
  );
}

async function persistOlistTokenResponse(
  role: PersiRole,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  tokenResponse: OlistTokenResponse,
  keys: OlistOAuthKeyProvider,
  now: Date,
): Promise<void> {
  const accessEncrypted = encryptOlistOAuthToken({
    plaintext: tokenResponse.access_token,
    context: { provider: "olist", app, environment, tokenKind: "access" },
    keys,
  });
  const refreshEncrypted = encryptOlistOAuthToken({
    plaintext: tokenResponse.refresh_token,
    context: { provider: "olist", app, environment, tokenKind: "refresh" },
    keys,
  });
  await upsertOlistOAuthToken(role, app, environment, {
    accessCiphertext: accessEncrypted.ciphertext,
    accessIv: accessEncrypted.iv,
    accessAuthTag: accessEncrypted.authTag,
    accessKeyId: accessEncrypted.keyId,
    accessExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
    refreshCiphertext: refreshEncrypted.ciphertext,
    refreshIv: refreshEncrypted.iv,
    refreshAuthTag: refreshEncrypted.authTag,
    refreshKeyId: refreshEncrypted.keyId,
    refreshExpiresAt: tokenResponse.refresh_expires_in
      ? new Date(now.getTime() + tokenResponse.refresh_expires_in * 1000)
      : null,
    envelopeVersion: accessEncrypted.envelopeVersion,
  });
}

// Called once, from the OAuth callback route, right after the owner
// approves the app in their browser (docs/native-commerce/olist-oauth-flow-design.md
// Section 2-3). No claim needed -- this is the first write, nothing to race.
export async function completeOlistOAuthAuthorization(input: {
  role: PersiRole;
  app: OlistOAuthApp;
  environment: OlistOAuthEnvironment;
  code: string;
  now?: Date;
  fetchImplementation?: typeof fetch;
  keys?: OlistOAuthKeyProvider;
}): Promise<void> {
  const config = getOlistOAuthAppConfig(input.app, input.environment);
  const tokenResponse = await exchangeOlistAuthorizationCode(
    { app: input.app, environment: input.environment, code: input.code, config },
    { fetchImplementation: input.fetchImplementation },
  );
  await persistOlistTokenResponse(
    input.role,
    input.app,
    input.environment,
    tokenResponse,
    input.keys ?? environmentOlistOAuthKeys(),
    input.now ?? new Date(),
  );
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CLAIM_POLL_ATTEMPTS = 3;
const CLAIM_POLL_DELAY_MS = 1_000;

function isAccessTokenUsable(row: OlistOAuthTokenRow | null, now: Date): boolean {
  if (!row?.accessCiphertext || !row.accessExpiresAt) return false;
  return new Date(row.accessExpiresAt).getTime() - REFRESH_MARGIN_MS > now.getTime();
}

function decryptRow(
  row: OlistOAuthTokenRow,
  app: OlistOAuthApp,
  environment: OlistOAuthEnvironment,
  keys: OlistOAuthKeyProvider,
): { accessToken: string; refreshToken: string } {
  const accessToken = decryptOlistOAuthToken({
    encrypted: {
      ciphertext: row.accessCiphertext!,
      iv: row.accessIv!,
      authTag: row.accessAuthTag!,
      keyId: row.accessKeyId!,
      envelopeVersion: row.envelopeVersion,
    },
    context: { provider: "olist", app, environment, tokenKind: "access" },
    keys,
  });
  const refreshToken = decryptOlistOAuthToken({
    encrypted: {
      ciphertext: row.refreshCiphertext!,
      iv: row.refreshIv!,
      authTag: row.refreshAuthTag!,
      keyId: row.refreshKeyId!,
      envelopeVersion: row.envelopeVersion,
    },
    context: { provider: "olist", app, environment, tokenKind: "refresh" },
    keys,
  });
  return { accessToken, refreshToken };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// The owner's explicit condition: no HTTP call to Olist ever happens
// inside a Postgres transaction/lock. Every DB call below
// (claim/read/write/release) is its own standalone statement -- the HTTP
// call to Olist's token endpoint always happens between two of them, with
// no open transaction. See docs/native-commerce/olist-oauth-flow-design.md
// Section 5 for the full "claim, release immediately, do the work
// unlocked, write back with an ownership check" design and why it's the
// right trade-off given a Keycloak refresh token typically rotates on use.
export interface OlistOAuthTokenStoreDeps {
  read: typeof readOlistOAuthToken;
  claim: typeof claimOlistOAuthTokenRefresh;
  write: typeof writeOlistOAuthToken;
  release: typeof releaseOlistOAuthTokenRefreshClaim;
}

const defaultTokenStoreDeps: OlistOAuthTokenStoreDeps = {
  read: readOlistOAuthToken,
  claim: claimOlistOAuthTokenRefresh,
  write: writeOlistOAuthToken,
  release: releaseOlistOAuthTokenRefreshClaim,
};

export async function getValidOlistAccessToken(input: {
  role: PersiRole;
  app: OlistOAuthApp;
  environment: OlistOAuthEnvironment;
  now?: Date;
  fetchImplementation?: typeof fetch;
  keys?: OlistOAuthKeyProvider;
  store?: OlistOAuthTokenStoreDeps;
}): Promise<string> {
  const now = input.now ?? new Date();
  const keys = input.keys ?? environmentOlistOAuthKeys();
  const store = input.store ?? defaultTokenStoreDeps;
  const claimant = `${process.pid}:${randomUUID()}`;

  let row = await store.read(input.role, input.app, input.environment);
  if (!row?.accessCiphertext) throw new Error("OLIST_OAUTH_NOT_AUTHORIZED");
  if (isAccessTokenUsable(row, now)) return decryptRow(row, input.app, input.environment, keys).accessToken;

  const claimed = await store.claim(input.role, input.app, input.environment, claimant);
  if (!claimed) {
    // Another process is already refreshing -- poll briefly for its
    // result instead of racing it with our own HTTP call.
    for (let attempt = 0; attempt < CLAIM_POLL_ATTEMPTS; attempt += 1) {
      await sleep(CLAIM_POLL_DELAY_MS);
      row = await store.read(input.role, input.app, input.environment);
      if (isAccessTokenUsable(row, now)) return decryptRow(row!, input.app, input.environment, keys).accessToken;
    }
    // The other process hasn't finished yet -- if our own current token
    // is still technically valid (just inside the refresh margin), use it
    // rather than fail a real request over a soft margin.
    if (row?.accessCiphertext && row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() > now.getTime()) {
      return decryptRow(row, input.app, input.environment, keys).accessToken;
    }
    throw new Error("OLIST_OAUTH_REFRESH_IN_PROGRESS");
  }

  try {
    const { refreshToken } = decryptRow(row, input.app, input.environment, keys);
    const config = getOlistOAuthAppConfig(input.app, input.environment);
    const tokenResponse = await requestOlistToken(
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      },
      input.fetchImplementation ?? fetch,
    );
    const accessEncrypted = encryptOlistOAuthToken({
      plaintext: tokenResponse.access_token,
      context: { provider: "olist", app: input.app, environment: input.environment, tokenKind: "access" },
      keys,
    });
    const refreshEncrypted = encryptOlistOAuthToken({
      plaintext: tokenResponse.refresh_token,
      context: { provider: "olist", app: input.app, environment: input.environment, tokenKind: "refresh" },
      keys,
    });
    const written = await store.write(input.role, input.app, input.environment, claimant, {
      accessCiphertext: accessEncrypted.ciphertext,
      accessIv: accessEncrypted.iv,
      accessAuthTag: accessEncrypted.authTag,
      accessKeyId: accessEncrypted.keyId,
      accessExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
      refreshCiphertext: refreshEncrypted.ciphertext,
      refreshIv: refreshEncrypted.iv,
      refreshAuthTag: refreshEncrypted.authTag,
      refreshKeyId: refreshEncrypted.keyId,
      refreshExpiresAt: tokenResponse.refresh_expires_in
        ? new Date(now.getTime() + tokenResponse.refresh_expires_in * 1000)
        : null,
      envelopeVersion: accessEncrypted.envelopeVersion,
    });
    if (!written) {
      // Lost the claim (lease expired under us) -- someone else's write
      // won; use whatever is there now instead of our own discarded result.
      const latest = await store.read(input.role, input.app, input.environment);
      if (isAccessTokenUsable(latest, now)) return decryptRow(latest!, input.app, input.environment, keys).accessToken;
      throw new Error("OLIST_OAUTH_REFRESH_LOST_CLAIM");
    }
    return tokenResponse.access_token;
  } catch (error) {
    await store.release(input.role, input.app, input.environment, claimant).catch(() => {});
    throw error;
  }
}
