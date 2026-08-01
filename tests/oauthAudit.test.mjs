import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controllerPath = new URL(
  "../wordpress-plugin/persi-headless-account/src/Api/OAuthAuditController.php",
  import.meta.url,
);
const servicePath = new URL(
  "../wordpress-plugin/persi-headless-account/src/Diagnostics/OAuthAuditService.php",
  import.meta.url,
);

test("auditoria OAuth exige HMAC, nonce e administrador", async () => {
  const controller = await readFile(controllerPath, "utf8");
  assert.match(controller, /RequestAuthenticator/);
  assert.match(controller, /x-persi-timestamp/);
  assert.match(controller, /x-persi-nonce/);
  assert.match(controller, /x-persi-signature/);
  assert.match(controller, /current_user_can\( 'manage_options' \)/);
  assert.match(controller, /'Forbidden' \), 403/);
  assert.match(controller, /private, no-store|Response::json/);
});

test("relatório não serializa credenciais nem identificadores OAuth", async () => {
  const service = await readFile(servicePath, "utf8");
  const returnedFields = [...service.matchAll(/'([A-Za-z][A-Za-z0-9]+)'\s*=>/g)]
    .map((match) => match[1].toLowerCase());
  for (const forbidden of [
    "email",
    "emailhash",
    "providersubjecthash",
    "providerid",
    "token",
    "tokenhash",
    "cookie",
    "secret",
  ]) {
    assert.equal(returnedFields.includes(forbidden), false, forbidden);
  }
  assert.match(service, /emailConsistency/);
  assert.match(service, /EMAIL_HASH_MISMATCH/);
  assert.match(service, /hash_equals/);
});

test("auditoria cobre identidades, sessões, plugins e tabelas ausentes", async () => {
  const service = await readFile(servicePath, "utf8");
  for (const expected of [
    "invalidProviders",
    "orphanIdentities",
    "duplicateProviderSubjectGroups",
    "duplicateEmailHashGroups",
    "usersWithMultipleProviders",
    "orphanSessions",
    "expiredSessions",
    "duplicateTokenHashGroups",
    "installations",
    "MISSING",
  ]) {
    assert.match(service, new RegExp(expected));
  }
});

test("auditoria localiza divergência em cada etapa da resolução de login", async () => {
  const service = await readFile(servicePath, "utf8");
  for (const expected of [
    "OAUTH_IDENTITY_USER_MISMATCH",
    "SESSION_PROFILE_MISMATCH",
    "identityUserId",
    "sessionUserId",
    "accountApiUserId",
    "profileApiUserId",
    "loginResolution",
  ]) {
    assert.match(service, new RegExp(expected));
  }
});

test("auto-reparo permanece apenas indicativo e exige correspondência inequívoca", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /autoRepairPossible/);
  assert.match(service, /UNIQUE_EMAIL_HASH_MATCH/);
  assert.match(service, /DUPLICATE_PROVIDER_SUBJECT/);
  assert.match(service, /TARGET_PROVIDER_ALREADY_LINKED/);
  assert.doesNotMatch(service, /UPDATE\s+\{\$identity_table\}/);
  assert.doesNotMatch(service, /DELETE\s+FROM\s+\{\$identity_table\}/);
});
