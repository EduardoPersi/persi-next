import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withPersiRole, getPersiRolePoolForDiagnostics } from "../lib/db/nativeCommerceAuthority.ts";
import { closeDatabaseForTests } from "../lib/db/connection.ts";

const source = readFileSync("lib/db/nativeCommerceAuthority.ts", "utf8");

// ---------- fallback path: real behavioral test (no Postgres needed) ----------
// Every environment today (local dev, every existing script/test, CI) has
// neither NATIVE_APP_DATABASE_URL nor NATIVE_WORKER_DATABASE_URL set --
// this is the path every current caller actually exercises. It's fully
// testable without a live Postgres connection since it never opens one:
// withPersiRole degrades to `callback(getDatabase())`, and getDatabase()
// itself is lazy (only connects on first .execute() call).

// getDatabase() (lib/db/connection.ts) requires DATABASE_URL to be set to
// even construct its (lazy -- it doesn't connect until the first real
// query) client, and this test suite must not depend on the running
// machine happening to have one exported. A syntactically-valid placeholder
// is enough: neither this test nor withPersiRole's fallback branch ever
// calls .execute() on the handle, so no real network connection is
// attempted.
const PLACEHOLDER_DATABASE_URL = "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";

test("fallback path: withPersiRole calls back with the ambient database when no role env var is configured", async () => {
  assert.equal(process.env.NATIVE_APP_DATABASE_URL, undefined);
  assert.equal(process.env.NATIVE_WORKER_DATABASE_URL, undefined);
  const hadDatabaseUrl = "DATABASE_URL" in process.env;
  const previous = process.env.DATABASE_URL;
  if (!hadDatabaseUrl) process.env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
  try {
    let received;
    const sentinel = { ok: true };
    const result = await withPersiRole("persi_app", async (db) => {
      received = db;
      return sentinel;
    });
    assert.equal(result, sentinel);
    assert.ok(received, "callback must receive a database handle");
    assert.equal(typeof received.execute, "function", "fallback handle must be a usable database (has .execute)");
  } finally {
    if (!hadDatabaseUrl) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("fallback path never opens a transaction or issues SET LOCAL ROLE", async () => {
  // Same assertion made structurally: the fallback branch in the source
  // returns callback(getDatabase()) directly, with no .transaction(...)
  // wrapping -- confirmed by a live call above never needing a real
  // Postgres connection to succeed (if it opened a transaction against an
  // unconfigured/absent pool, it would throw).
  const hadDatabaseUrl = "DATABASE_URL" in process.env;
  const previous = process.env.DATABASE_URL;
  if (!hadDatabaseUrl) process.env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
  try {
    await withPersiRole("persi_worker", async () => "no-op");
  } finally {
    if (!hadDatabaseUrl) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

await closeDatabaseForTests();

// ---------- static source assertions for the activated path (real-Postgres proof lives in scripts/database/native-execution-identity-qualification-disposable.mjs) ----------

test("activated path issues SET LOCAL ROLE from a closed, hardcoded role literal -- never interpolated from external input", () => {
  assert.match(source, /function activationStatement\(role: PersiRole\)/);
  assert.match(source, /sql\.raw\(`set local role \$\{role\}`\)/);
  assert.match(source, /export type PersiRole = "persi_app" \| "persi_worker";/);
});

test("activated path opens a transaction and activates the role before invoking the callback", () => {
  const fnBody = source.slice(source.indexOf("export async function withPersiRole"));
  assert.match(fnBody, /pool\.db\.transaction\(async \(tx\) => \{/);
  const transactionBody = fnBody.slice(fnBody.indexOf("pool.db.transaction"));
  const activateIndex = transactionBody.indexOf("activationStatement(role)");
  const callbackIndex = transactionBody.indexOf("callback(tx");
  assert.ok(activateIndex > -1 && callbackIndex > activateIndex, "role must be activated before the callback runs");
});

test("two distinct login credentials are used, never one shared login for both roles", () => {
  assert.match(source, /return role === "persi_app" \? "NATIVE_APP_DATABASE_URL" : "NATIVE_WORKER_DATABASE_URL";/);
  const poolFnBody = source.slice(source.indexOf("function getRolePool"), source.indexOf("function activationStatement"));
  // Each role resolves its OWN env var via roleEnvVarName(role) -- there is
  // no single shared variable name either role could read.
  assert.match(poolFnBody, /roleEnvVarName\(role\)/);
});

test("pools are lazily created and cached, not reconstructed per call", () => {
  assert.match(source, /function getRolePool/);
  assert.match(source, /if \(state\[key\]\) return state\[key\]!;/);
});

// ---------- R3 diagnostic export (scratchpad/native_commerce_hostinger_identity_probe.json) ----------
// getPersiRolePoolForDiagnostics is additive: it exists solely for the
// temporary staging identity probe (lib/runtime/native-commerce-identity-probe.ts)
// to test a dedicated role's own connection identity BEFORE role
// activation. It must reuse getRolePool exactly, never open a transaction,
// and behave identically-null under the same fallback condition as
// withPersiRole.

test("getPersiRolePoolForDiagnostics returns null when the role's env var is unset, same fallback condition as withPersiRole", () => {
  assert.equal(process.env.NATIVE_APP_DATABASE_URL, undefined);
  assert.equal(process.env.NATIVE_WORKER_DATABASE_URL, undefined);
  assert.equal(getPersiRolePoolForDiagnostics("persi_app"), null);
  assert.equal(getPersiRolePoolForDiagnostics("persi_worker"), null);
});

test("getPersiRolePoolForDiagnostics reuses getRolePool exactly -- no parallel pool/transaction/activation logic", () => {
  const fnBody = source.slice(source.indexOf("export function getPersiRolePoolForDiagnostics"), source.indexOf("export async function closeNativeCommerceAuthorityForTests"));
  assert.match(fnBody, /getRolePool\(role\)/);
  assert.doesNotMatch(fnBody, /new postgres\(|drizzle\(|\.transaction\(|activationStatement/);
});
