import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildFacebookAuthorizationUrl,
  exchangeFacebookAuthorizationCode,
  getFacebookUser,
  normalizeFacebookUser,
} from "../lib/account/oauth/facebook.ts";
import {
  getOAuthCookieNames,
  getOAuthCookieOptions,
} from "../lib/account/oauth/cookies.ts";
import { getOAuthProvider } from "../lib/account/oauth/provider.ts";
import {
  createOAuthPkce,
  generateOAuthValue,
  validateOAuthCallbackInput,
} from "../lib/account/oauth/state.ts";

const facebookConfig = {
  clientId: "facebook-client-id",
  clientSecret: "test-only-facebook-secret",
  graphApiVersion: "v23.0",
  redirectUri:
    "https://app.persimateriais.com.br/api/auth/facebook/callback",
};

test("providers Google e Facebook compartilham contrato comum", () => {
  const google = getOAuthProvider("google");
  const facebook = getOAuthProvider("facebook");

  for (const provider of [google, facebook]) {
    assert.equal(typeof provider.buildAuthorizationUrl, "function");
    assert.equal(typeof provider.exchangeCode, "function");
    assert.equal(typeof provider.getUser, "function");
    assert.equal(typeof provider.normalizeUser, "function");
  }
  assert.equal(google.name, "google");
  assert.equal(facebook.name, "facebook");
});

test("estado, nonce, PKCE e validação são independentes do provider", () => {
  const state = generateOAuthValue();
  const nonce = generateOAuthValue();
  const pkce = createOAuthPkce();

  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotThrow(() =>
    validateOAuthCallbackInput({
      code: "authorization-code",
      codeVerifier: pkce.codeVerifier,
      expectedState: state,
      nonce,
      state,
    }),
  );
});

test("cookies preservam nomes Google e isolam provider Facebook", () => {
  assert.deepEqual(getOAuthCookieNames("google"), {
    state: "persi_google_oauth_state",
    nonce: "persi_google_oauth_nonce",
    verifier: "persi_google_oauth_verifier",
  });
  assert.deepEqual(getOAuthCookieNames("facebook"), {
    state: "persi_facebook_oauth_state",
    nonce: "persi_facebook_oauth_nonce",
    verifier: "persi_facebook_oauth_verifier",
  });
  assert.deepEqual(getOAuthCookieOptions("google", true), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
});

test("provider Facebook prepara URL, token e usuário normalizado sem vazar token", async () => {
  const authorizationUrl = buildFacebookAuthorizationUrl({
    codeChallenge: "challenge",
    config: facebookConfig,
    nonce: "N".repeat(43),
    state: "S".repeat(43),
  });
  assert.equal(authorizationUrl.searchParams.get("scope"), "email,public_profile");
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), "challenge");

  const token = await exchangeFacebookAuthorizationCode(
    {
      code: "authorization-code",
      codeVerifier: "V".repeat(64),
      config: facebookConfig,
    },
    {
      fetchImplementation: async (_url, init) => {
        const body = new URLSearchParams(String(init.body));
        assert.equal(body.get("code_verifier"), "V".repeat(64));
        return Response.json({ access_token: "private-facebook-token" });
      },
    },
  );

  const user = await getFacebookUser(
    token,
    { config: facebookConfig, nonce: "N".repeat(43) },
    {
      fetchImplementation: async (_url, init) => {
        assert.equal(
          init.headers.Authorization,
          "Bearer private-facebook-token",
        );
        return Response.json({
          id: "facebook-user-id",
          email: "cliente@example.test",
          first_name: "Ana",
          last_name: "Cliente",
          name: "Ana Cliente",
          picture: { data: { url: "https://example.test/avatar.jpg" } },
        });
      },
    },
  );

  assert.deepEqual(normalizeFacebookUser(user), {
    provider: "facebook",
    providerId: "facebook-user-id",
    email: "cliente@example.test",
    name: "Ana Cliente",
    avatar: "https://example.test/avatar.jpg",
    verifiedEmail: true,
  });
  assert.equal("accessToken" in user, false);
});

test("rotas Facebook terminam na sessão JWT comum", async () => {
  const routes = await Promise.all(
    [
      "../app/api/auth/facebook/start/route.ts",
      "../app/api/auth/facebook/callback/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(routes[0], /getOAuthProvider\("facebook"\)/);
  assert.match(routes[0], /setOAuthTransactionCookies/);
  assert.match(routes[1], /validateOAuthCallbackInput/);
  assert.match(routes[1], /authenticateWithSocialToken/);
  assert.match(routes[1], /AUTH_COOKIE_NAME/);
  for (const route of routes) {
    assert.equal(route.includes("FACEBOOK_CLIENT_SECRET"), false);
    assert.equal(route.includes("access_token"), false);
  }
});

test("OAuth usa o mesmo cookie JWT sem sessão paralela", async () => {
  const cookie = await readFile(new URL("../lib/auth/cookies.ts", import.meta.url), "utf8");
  assert.match(cookie, /__Host-persi_jwt_session/);
  assert.equal(cookie.includes("provider"), false);
});
