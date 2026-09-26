import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  buildOlistAuthorizationUrl,
  exchangeOlistAuthorizationCode,
  getOlistOAuthAppConfig,
  getOlistOAuthRedirectUri,
  getValidOlistAccessToken,
} from "../lib/olist/oauthClient.ts";
import { encryptOlistOAuthToken } from "../lib/commerce/olistOAuthTokenCrypto.ts";

const RAW_KEY = Buffer.alloc(32, 3).toString("base64url");
function testKeys() {
  return { currentKeyId: () => "k1", encryptionKey: () => Buffer.from(RAW_KEY, "base64url") };
}

function encryptedToken(plaintext, tokenKind, context) {
  return encryptOlistOAuthToken({ plaintext, context: { ...context, tokenKind }, keys: testKeys() });
}

function fakeFetch(responses) {
  let call = 0;
  return async () => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: response.ok !== false, json: async () => response.body };
  };
}

test("getOlistOAuthRedirectUri uses the configured env var, falling back to a sane default", () => {
  assert.equal(
    getOlistOAuthRedirectUri("staging", { OLIST_OAUTH_REDIRECT_URI_STAGING: "https://custom.example/callback" }),
    "https://custom.example/callback",
  );
  assert.equal(
    getOlistOAuthRedirectUri("production", {}),
    "https://persimateriais.com.br/api/admin/olist/oauth/callback",
  );
});

test("getOlistOAuthAppConfig throws when client id/secret are not configured", () => {
  assert.throws(() => getOlistOAuthAppConfig("catalogo", "staging", {}), /OLIST_OAUTH_APP_NOT_CONFIGURED/);
});

test("buildOlistAuthorizationUrl includes client_id, redirect_uri, response_type and state", () => {
  const url = buildOlistAuthorizationUrl({
    config: { clientId: "abc", clientSecret: "s", redirectUri: "https://staging.persimateriais.com.br/api/admin/olist/oauth/callback" },
    state: "the-state",
  });
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "the-state");
  assert.equal(url.searchParams.get("redirect_uri"), "https://staging.persimateriais.com.br/api/admin/olist/oauth/callback");
});

test("exchangeOlistAuthorizationCode throws OLIST_OAUTH_TOKEN_EXCHANGE_FAILED on a non-ok response", async () => {
  await assert.rejects(
    () =>
      exchangeOlistAuthorizationCode(
        { app: "catalogo", environment: "staging", code: "c", config: { clientId: "a", clientSecret: "b", redirectUri: "r" } },
        { fetchImplementation: fakeFetch([{ ok: false, body: {} }]) },
      ),
    /OLIST_OAUTH_TOKEN_EXCHANGE_FAILED/,
  );
});

const context = { provider: "olist", app: "catalogo", environment: "staging" };

// getValidOlistAccessToken's refresh path calls getOlistOAuthAppConfig,
// which reads real client credentials from process.env -- set fixtures for
// the duration of this file's suite and restore whatever was there before.
const ORIGINAL_CLIENT_ID = process.env.OLIST_SYNC_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.OLIST_SYNC_CLIENT_SECRET;
before(() => {
  process.env.OLIST_SYNC_CLIENT_ID = "test-client-id";
  process.env.OLIST_SYNC_CLIENT_SECRET = "test-client-secret";
});
after(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env.OLIST_SYNC_CLIENT_ID;
  else process.env.OLIST_SYNC_CLIENT_ID = ORIGINAL_CLIENT_ID;
  if (ORIGINAL_CLIENT_SECRET === undefined) delete process.env.OLIST_SYNC_CLIENT_SECRET;
  else process.env.OLIST_SYNC_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
});

test("getValidOlistAccessToken returns the current token without refreshing when it is not near expiry", async () => {
  const access = encryptedToken("current-access", "access", context);
  const refresh = encryptedToken("current-refresh", "refresh", context);
  let readCalls = 0;
  const store = {
    read: async () => {
      readCalls += 1;
      return {
        accessCiphertext: access.ciphertext, accessIv: access.iv, accessAuthTag: access.authTag, accessKeyId: access.keyId,
        accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        refreshCiphertext: refresh.ciphertext, refreshIv: refresh.iv, refreshAuthTag: refresh.authTag, refreshKeyId: refresh.keyId,
        refreshExpiresAt: null, envelopeVersion: 1, refreshClaimedBy: null, refreshClaimedAt: null, version: 1n, lastRefreshedAt: null,
      };
    },
    claim: async () => { throw new Error("should not claim"); },
    write: async () => { throw new Error("should not write"); },
    release: async () => { throw new Error("should not release"); },
  };
  const token = await getValidOlistAccessToken({ role: "persi_app", app: "catalogo", environment: "staging", store, keys: testKeys() });
  assert.equal(token, "current-access");
  assert.equal(readCalls, 1);
});

test("getValidOlistAccessToken refreshes when near expiry, claims, calls Olist, and writes the result", async () => {
  const access = encryptedToken("stale-access", "access", context);
  const refresh = encryptedToken("real-refresh-token", "refresh", context);
  const row = {
    accessCiphertext: access.ciphertext, accessIv: access.iv, accessAuthTag: access.authTag, accessKeyId: access.keyId,
    accessExpiresAt: new Date(Date.now() + 30 * 1000).toISOString(), // inside the 5-minute margin
    refreshCiphertext: refresh.ciphertext, refreshIv: refresh.iv, refreshAuthTag: refresh.authTag, refreshKeyId: refresh.keyId,
    refreshExpiresAt: null, envelopeVersion: 1, refreshClaimedBy: null, refreshClaimedAt: null, version: 1n, lastRefreshedAt: null,
  };
  let writeInput = null;
  const store = {
    read: async () => row,
    claim: async () => true,
    write: async (_role, _app, _env, _claimant, input) => {
      writeInput = input;
      return true;
    },
    release: async () => { throw new Error("should not release on success"); },
  };
  const token = await getValidOlistAccessToken({
    role: "persi_app",
    app: "catalogo",
    environment: "staging",
    store,
    keys: testKeys(),
    fetchImplementation: fakeFetch([{ body: { access_token: "brand-new-access", refresh_token: "brand-new-refresh", expires_in: 14400 } }]),
  });
  assert.equal(token, "brand-new-access");
  assert.ok(writeInput, "expected write to be called");
});

test("getValidOlistAccessToken releases the claim and rethrows when the Olist call fails", async () => {
  const access = encryptedToken("stale-access", "access", context);
  const refresh = encryptedToken("real-refresh-token", "refresh", context);
  const row = {
    accessCiphertext: access.ciphertext, accessIv: access.iv, accessAuthTag: access.authTag, accessKeyId: access.keyId,
    accessExpiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    refreshCiphertext: refresh.ciphertext, refreshIv: refresh.iv, refreshAuthTag: refresh.authTag, refreshKeyId: refresh.keyId,
    refreshExpiresAt: null, envelopeVersion: 1, refreshClaimedBy: null, refreshClaimedAt: null, version: 1n, lastRefreshedAt: null,
  };
  let released = false;
  const store = {
    read: async () => row,
    claim: async () => true,
    write: async () => { throw new Error("should not write"); },
    release: async () => { released = true; },
  };
  await assert.rejects(
    () =>
      getValidOlistAccessToken({
        role: "persi_app", app: "catalogo", environment: "staging", store, keys: testKeys(),
        fetchImplementation: fakeFetch([{ ok: false, body: {} }]),
      }),
    /OLIST_OAUTH_TOKEN_EXCHANGE_FAILED/,
  );
  assert.equal(released, true);
});

test("getValidOlistAccessToken, when the claim is lost, falls back to re-reading instead of using its own discarded result", async () => {
  const staleAccess = encryptedToken("stale-access", "access", context);
  const staleRefresh = encryptedToken("stale-refresh", "refresh", context);
  const winnerAccess = encryptedToken("winner-access", "access", context);
  const staleRow = {
    accessCiphertext: staleAccess.ciphertext, accessIv: staleAccess.iv, accessAuthTag: staleAccess.authTag, accessKeyId: staleAccess.keyId,
    accessExpiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    refreshCiphertext: staleRefresh.ciphertext, refreshIv: staleRefresh.iv, refreshAuthTag: staleRefresh.authTag, refreshKeyId: staleRefresh.keyId,
    refreshExpiresAt: null, envelopeVersion: 1, refreshClaimedBy: null, refreshClaimedAt: null, version: 1n, lastRefreshedAt: null,
  };
  const winnerRow = {
    ...staleRow,
    accessCiphertext: winnerAccess.ciphertext, accessIv: winnerAccess.iv, accessAuthTag: winnerAccess.authTag, accessKeyId: winnerAccess.keyId,
    accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  let readCalls = 0;
  const store = {
    read: async () => {
      readCalls += 1;
      return readCalls === 1 ? staleRow : winnerRow;
    },
    claim: async () => true,
    write: async () => false, // lost the claim
    release: async () => { throw new Error("should not release -- write path handles this, not the catch block"); },
  };
  const token = await getValidOlistAccessToken({
    role: "persi_app", app: "catalogo", environment: "staging", store, keys: testKeys(),
    fetchImplementation: fakeFetch([{ body: { access_token: "discarded", refresh_token: "discarded", expires_in: 14400 } }]),
  });
  assert.equal(token, "winner-access");
});
