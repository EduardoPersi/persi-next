import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isJwtFormat } from "../lib/auth/token.ts";
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from "../lib/auth/cookies.ts";

test("cookie JWT é único e protegido", () => {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const options = getAuthCookieOptions(expiresAt);
  assert.equal(AUTH_COOKIE_NAME, "__Host-persi_jwt_session");
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.expires.toISOString(), expiresAt);
  assert.equal(isJwtFormat("header.payload.signature"), true);
  assert.equal(isJwtFormat("not-a-jwt"), false);
});

test("plugin Persi delega emissão e validação ao plugin JWT oficial", async () => {
  const [plugin, social, adapter, bearer, tokenRuntime] = await Promise.all([
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Plugin.php", import.meta.url), "utf8"),
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Api/SocialJwtController.php", import.meta.url), "utf8"),
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Auth/OfficialJwtAdapter.php", import.meta.url), "utf8"),
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Auth/BearerAuthorization.php", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/token.ts", import.meta.url), "utf8"),
  ]);
  const combined = `${plugin}\n${social}\n${adapter}\n${bearer}`;
  assert.doesNotMatch(combined, /Firebase\\JWT|JWT::encode|JWT::decode|JwtIssuer|RevokedTokenStore/);
  assert.match(adapter, /\/jwt-auth\/v1\/token/);
  assert.match(adapter, /rest_do_request/);
  assert.match(adapter, /user_email/);
  assert.match(adapter, /jwt_auth_token_before_sign/);
  assert.match(adapter, /issued_user_id.*user->ID/s);
  assert.match(social, /OfficialJwtAdapter/);
  assert.match(social, /GoogleTokenVerifier/);
  assert.match(social, /MetaTokenVerifier/);
  assert.match(bearer, /wp_get_current_user/);
  assert.doesNotMatch(tokenRuntime, /JSON\.parse|Buffer\.from|decode/);
});

test("callbacks sociais recusam JWT de outro e-mail", async () => {
  const [google, facebook, identities] = await Promise.all([
    readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/facebook/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Auth/OAuthIdentityService.php", import.meta.url), "utf8"),
  ]);
  assert.match(google, /jwt\.userEmail.*googleUser\.email/);
  assert.match(facebook, /jwt\.userEmail.*facebookUser\.email/);
  assert.match(google, /getAuthenticatedUser\(jwt\.token\)/);
  assert.match(google, /authenticatedUser\.email.*googleUser\.email/);
  assert.match(facebook, /getAuthenticatedUser\(jwt\.token\)/);
  assert.match(facebook, /authenticatedUser\.email.*facebookUser\.email/);
  assert.match(identities, /email_matches/);
});

test("arquitetura usa somente JWT Bearer", async () => {
  const [pkg, client, login] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../services/account/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/login/route.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(pkg.includes("next-auth"), false);
  assert.equal(client.includes("X-Persi-Session"), false);
  assert.equal(client.includes("X-Persi-Signature"), false);
  assert.match(client, /Authorization = `Bearer/);
  assert.match(login, /authenticateWithCredentials/);
});

test("health reporta dependências sem expor secrets", async () => {
  const [plugin, health] = await Promise.all([
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Plugin.php", import.meta.url), "utf8"),
    readFile(new URL("../wordpress-plugin/persi-headless-account/src/Api/HealthController.php", import.meta.url), "utf8"),
  ]);
  assert.match(plugin, /HealthController/);
  assert.match(health, /\/health/);
  assert.match(health, /\/jwt-auth\/v1\/token/);
  assert.match(health, /Cache-Control/);
  assert.match(health, /'php'/);
  assert.match(health, /'wordpress'/);
  assert.match(health, /'jwt_plugin'/);
  assert.doesNotMatch(health, /constant\(.*SECRET|facebook_app_secret\(\).*['"]\s*=>/);
});
