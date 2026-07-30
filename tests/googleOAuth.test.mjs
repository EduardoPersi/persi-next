import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildGoogleAuthorizationUrl,
  createGooglePkce,
  exchangeGoogleAuthorizationCode,
  generateGoogleOAuthValue,
  getGoogleOAuthConfig,
  getGoogleOAuthCookieOptions,
  getGoogleOAuthErrorOrigin,
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_OAUTH_CALLBACK_PATH,
  resetGoogleJwksCacheForTests,
  safeGoogleOAuthEqual,
  validateGoogleOAuthCallbackInput,
  validateGoogleIdToken,
} from "../lib/account/googleOAuth.ts";
import { getGoogleStartConfigurationCodes } from "../lib/account/googleStartDiagnostics.ts";
import { createGoogleAccountSession } from "../services/account/googleAuth.ts";

const config = {
  clientId: "google-client-id.apps.googleusercontent.com",
  clientSecret: "test-only-client-secret",
  redirectUri:
    "https://app.persimateriais.com.br/api/auth/google/callback",
};
const accountConfig = {
  endpoint: "https://persimateriais.com.br/wp-json/persi-account/v1",
  keyId: "primary",
  origin: "https://app.persimateriais.com.br",
  secret: "test-only-account-secret",
};
const sessionToken = "S".repeat(43);
const now = Date.UTC(2030, 0, 1);
const nowSeconds = Math.floor(now / 1000);
const nonce = "N".repeat(43);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: "test-key",
  use: "sig",
};

function jwt(claimOverrides = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: config.clientId,
      exp: nowSeconds + 600,
      iat: nowSeconds,
      nonce,
      sub: "google-subject-123",
      email: "ana@example.test",
      email_verified: true,
      given_name: "Ana",
      family_name: "Cliente",
      name: "Ana Cliente",
      picture: "https://example.test/avatar.jpg",
      ...claimOverrides,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function jwksFetch() {
  return async () =>
    Response.json(
      { keys: [jwk] },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
}

test("state, nonce e PKCE usam valores aleatórios base64url", () => {
  const first = generateGoogleOAuthValue();
  const second = generateGoogleOAuthValue();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const pkce = createGooglePkce();
  assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{64}$/);
  assert.match(pkce.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(pkce.codeChallenge, pkce.codeVerifier);
  assert.equal(safeGoogleOAuthEqual(first, first), true);
  assert.equal(safeGoogleOAuthEqual(first, second), false);
});

test("redirect Google usa callback exato, PKCE e somente escopos mínimos", () => {
  const url = buildGoogleAuthorizationUrl({
    codeChallenge: "challenge",
    config,
    nonce,
    state: "state",
  });
  assert.equal(url.origin + url.pathname, GOOGLE_AUTHORIZATION_ENDPOINT);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.has("access_type"), false);
  assert.equal(url.searchParams.has("include_granted_scopes"), false);
});

test("configuração aceita somente callbacks fixos e exige segredo privado", () => {
  assert.deepEqual(
    getGoogleOAuthConfig({
      GOOGLE_CLIENT_ID: config.clientId,
      GOOGLE_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: config.redirectUri,
    }),
    config,
  );
  assert.throws(() =>
    getGoogleOAuthConfig({
      GOOGLE_CLIENT_ID: config.clientId,
      GOOGLE_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: "https://evil.test/callback",
    }),
  );
  assert.throws(() =>
    getGoogleOAuthConfig({
      GOOGLE_CLIENT_ID: config.clientId,
      GOOGLE_OAUTH_REDIRECT_URI: config.redirectUri,
    }),
  );
  assert.equal(
    getGoogleOAuthErrorOrigin({
      GOOGLE_OAUTH_REDIRECT_URI:
        "https://persimateriais.com.br/api/auth/google/callback",
    }),
    "https://persimateriais.com.br",
  );
  assert.equal(
    getGoogleOAuthErrorOrigin({
      GOOGLE_OAUTH_REDIRECT_URI: "https://evil.test/callback",
    }),
    "https://app.persimateriais.com.br",
  );
});

test("cookies OAuth são HttpOnly, Lax, curtos e restritos às rotas Google", () => {
  const options = getGoogleOAuthCookieOptions(true);
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/api/auth/google");
  assert.equal(options.maxAge, 600);
});

test("callback rejeita code ausente e state inválido", () => {
  const valid = {
    code: "authorization-code",
    codeVerifier: "V".repeat(64),
    expectedState: "S".repeat(43),
    nonce,
    state: "S".repeat(43),
  };
  assert.doesNotThrow(() => validateGoogleOAuthCallbackInput(valid));
  assert.throws(() =>
    validateGoogleOAuthCallbackInput({ ...valid, code: "" }),
  );
  assert.throws(() =>
    validateGoogleOAuthCallbackInput({ ...valid, state: "X".repeat(43) }),
  );
});

test("troca do code envia redirect URI e verifier exatos sem pedir refresh token", async () => {
  let requestBody;
  const idToken = jwt();
  const result = await exchangeGoogleAuthorizationCode(
    { code: "authorization-code", codeVerifier: "V".repeat(64), config },
    {
      fetchImplementation: async (_url, init) => {
        requestBody = new URLSearchParams(String(init.body));
        return Response.json({
          access_token: "not-returned",
          id_token: idToken,
          token_type: "Bearer",
        });
      },
    },
  );
  assert.equal(result, idToken);
  assert.equal(requestBody.get("redirect_uri"), config.redirectUri);
  assert.equal(requestBody.get("code_verifier"), "V".repeat(64));
  assert.equal(requestBody.get("grant_type"), "authorization_code");
  assert.equal(requestBody.has("refresh_token"), false);
});

test("ID Token válido verifica assinatura e retorna somente identidade", async () => {
  resetGoogleJwksCacheForTests();
  const identity = await validateGoogleIdToken(
    jwt(),
    { clientId: config.clientId, nonce },
    { fetchImplementation: jwksFetch(), now },
  );
  assert.deepEqual(identity, {
    provider: "google",
    subject: "google-subject-123",
    email: "ana@example.test",
    emailVerified: true,
    firstName: "Ana",
    lastName: "Cliente",
    displayName: "Ana Cliente",
    picture: "https://example.test/avatar.jpg",
  });
  assert.equal("access_token" in identity, false);
  assert.equal("id_token" in identity, false);
});

for (const [name, claims] of [
  ["nonce inválido", { nonce: "outro" }],
  ["issuer inválido", { iss: "https://evil.test" }],
  ["audience inválida", { aud: "outro-client" }],
  ["token expirado", { exp: nowSeconds - 1 }],
  ["e-mail não verificado", { email_verified: false }],
]) {
  test(`ID Token rejeita ${name}`, async () => {
    resetGoogleJwksCacheForTests();
    await assert.rejects(
      validateGoogleIdToken(
        jwt(claims),
        { clientId: config.clientId, nonce },
        { fetchImplementation: jwksFetch(), now },
      ),
    );
  });
}

test("ID Token rejeita assinatura adulterada", async () => {
  resetGoogleJwksCacheForTests();
  const token = jwt();
  const [header, payload, signature] = token.split(".");
  const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  const tampered = `${header}.${payload}.${tamperedSignature}`;
  await assert.rejects(
    validateGoogleIdToken(
      tampered,
      { clientId: config.clientId, nonce },
      { fetchImplementation: jwksFetch(), now },
    ),
  );
});

test("sessão Google usa endpoint HMAC, preserva token só internamente", async () => {
  let sentBody;
  const session = await createGoogleAccountSession(
    {
      provider: "google",
      subject: "google-subject-123",
      email: "ana@example.test",
      emailVerified: true,
      firstName: "Ana",
      lastName: "Cliente",
      displayName: "Ana Cliente",
      picture: "",
    },
    {
      config: accountConfig,
      fetchImplementation: async (url, init) => {
        assert.equal(
          url,
          "https://persimateriais.com.br/wp-json/persi-account/v1/google-login",
        );
        assert.match(init.headers["X-Persi-Signature"], /^v1=[a-f0-9]{64}$/);
        sentBody = JSON.parse(String(init.body));
        return Response.json({
          authenticated: true,
          sessionToken,
          expiresAt: "2030-01-01T01:00:00+00:00",
          customer: {
            firstName: "Ana",
            displayName: "Ana Cliente",
            email: "ana@example.test",
          },
        });
      },
    },
  );
  assert.equal(session.sessionToken, sessionToken);
  assert.equal(sentBody.provider, "google");
  assert.equal("accessToken" in sentBody, false);
  assert.equal("idToken" in sentBody, false);
});

test("rotas consomem cookies, não expõem tokens e usam erro público seguro", async () => {
  const startRoute = await readFile(
    new URL("../app/api/auth/google/start/route.ts", import.meta.url),
    "utf8",
  );
  const callbackRoute = await readFile(
    new URL("../app/api/auth/google/callback/route.ts", import.meta.url),
    "utf8",
  );
  const loginPage = await readFile(
    new URL("../app/(institutional)/entrar/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(startRoute, /setOAuthTransactionCookies/);
  assert.match(callbackRoute, /getOAuthCookieNames\("google"\)/);
  assert.match(callbackRoute, /clearOAuthTransactionCookies/);
  assert.match(callbackRoute, /ACCOUNT_SESSION_COOKIE/);
  assert.match(callbackRoute, /replaceOAuthAccountSession/);
  assert.match(startRoute, /getOAuthProvider\("google"\)/);
  assert.match(callbackRoute, /getOAuthProvider\("google"\)/);
  assert.match(callbackRoute, /GOOGLE_SESSION_COOKIE_UPDATED/);
  assert.match(callbackRoute, /GOOGLE_SESSION_REUSED/);
  assert.equal(callbackRoute.includes("access_token"), false);
  assert.equal(callbackRoute.includes("refresh_token"), false);
  assert.equal(callbackRoute.includes("id_token"), false);
  assert.match(loginPage, /Não foi possível entrar com o Google/);
  assert.equal(GOOGLE_OAUTH_CALLBACK_PATH, "/api/auth/google/callback");
});

test("start diferencia variáveis ausentes e redirect URI inválida", () => {
  assert.deepEqual(getGoogleStartConfigurationCodes({}), [
    "GOOGLE_START_CONFIG_MISSING",
    "GOOGLE_START_CLIENT_ID_MISSING",
    "GOOGLE_START_SECRET_MISSING",
    "GOOGLE_START_REDIRECT_URI_MISSING",
  ]);
  assert.deepEqual(
    getGoogleStartConfigurationCodes({
      GOOGLE_CLIENT_ID: config.clientId,
      GOOGLE_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: "https://evil.test/callback",
    }),
    ["GOOGLE_START_REDIRECT_URI_INVALID"],
  );
  assert.deepEqual(
    getGoogleStartConfigurationCodes({
      GOOGLE_CLIENT_ID: config.clientId,
      GOOGLE_CLIENT_SECRET: config.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: config.redirectUri,
    }),
    [],
  );
});

test("start registra somente códigos e mantém redirect de erro explícito", async () => {
  const diagnostics = await readFile(
    new URL("../lib/account/googleStartDiagnostics.ts", import.meta.url),
    "utf8",
  );
  const startRoute = await readFile(
    new URL("../app/api/auth/google/start/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(diagnostics, /source: "persi-google-start"/);
  assert.equal(diagnostics.includes("clientSecret"), false);
  assert.equal(diagnostics.includes("state,"), false);
  assert.equal(diagnostics.includes("codeVerifier"), false);
  assert.match(startRoute, /GOOGLE_START_STATE_FAILED/);
  assert.match(startRoute, /GOOGLE_START_PKCE_FAILED/);
  assert.match(startRoute, /GOOGLE_START_URL_CREATED/);
  assert.match(startRoute, /createOAuthRedirect/);
  assert.match(startRoute, /"\/entrar\?erro=google"/);
});
