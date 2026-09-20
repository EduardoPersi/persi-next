import "server-only";

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getDatabase, type PersiDatabase } from "./connection";
import * as schema from "./schema";

// ACCELERATED ROUND — Native Commerce DB Execution Identity.
//
// Closes the gap docs/database/87 (Section 3) flagged: persi_app/persi_worker
// are NOLOGIN privilege-group roles with no wired runtime identity. A prior
// round (scripts/database/runtime-identity-disposable.mjs,
// runtime-identity-pool-stress.mjs -- frozen, not modified by this round)
// already designed and proved the exact mechanism in a disposable container,
// but never wired it into any real application code: a dedicated LOGIN role
// per authority (persi_app_login / persi_worker_login), NOINHERIT, granted
// membership in the matching NOLOGIN privilege role with
// `admin false, inherit false, set true` -- meaning the login has ZERO
// ambient privilege of its own and must explicitly `SET LOCAL ROLE` inside
// a transaction to activate it, which Postgres automatically reverts at
// COMMIT or ROLLBACK. Proven properties (re-verified this round for this
// engagement's own new functions in
// scripts/database/native-execution-identity-qualification-disposable.mjs):
// bare login has zero privilege; cross-role assumption is denied (42501);
// an invalid role name is denied (22023); identity never leaks across
// pooled-connection reuse; concurrent app/worker transactions never
// cross-contaminate.
//
// FALLBACK BY DESIGN: when the two env vars below aren't configured (true
// for every existing script, test, and local dev flow today -- neither
// appears in .env.example with a value, nor in any CI config), every call
// through withPersiRole behaves EXACTLY as it did before this round:
// getDatabase()'s single ambient identity, unchanged. This is the same
// "prepared but inert by default" idiom as
// lib/runtime/native-checkout-mode.ts's isNativeCheckoutRuntimeEnabled() --
// nothing about existing behavior changes until a deployment explicitly
// provisions the two login roles and sets these two env vars.

export type PersiRole = "persi_app" | "persi_worker";

type AuthorityState = {
  app?: { client: Sql; db: PostgresJsDatabase<typeof schema> };
  worker?: { client: Sql; db: PostgresJsDatabase<typeof schema> };
};

const globalAuthority = globalThis as typeof globalThis & {
  __persiCommerceAuthority?: AuthorityState;
};

function roleEnvVarName(role: PersiRole): "NATIVE_APP_DATABASE_URL" | "NATIVE_WORKER_DATABASE_URL" {
  return role === "persi_app" ? "NATIVE_APP_DATABASE_URL" : "NATIVE_WORKER_DATABASE_URL";
}

function getRolePool(role: PersiRole): { client: Sql; db: PostgresJsDatabase<typeof schema> } | null {
  const state = (globalAuthority.__persiCommerceAuthority ??= {});
  const key = role === "persi_app" ? "app" : "worker";
  if (state[key]) return state[key]!;

  const url = process.env[roleEnvVarName(role)]?.trim();
  if (!url) return null;

  const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false });
  const db = drizzle(client, { schema });
  state[key] = { client, db };
  return state[key]!;
}

// Role name is one of exactly two hardcoded literals declared in this
// module's own type -- never derived from a request, a database row, or any
// other external input, so building the SQL statement by concatenation
// here (Postgres doesn't accept `SET LOCAL ROLE` as a bind parameter) can't
// be an injection vector. Mirrors runtime-identity-disposable.mjs's own
// `tx.unsafe("set local role persi_app")` verbatim.
function activationStatement(role: PersiRole) {
  return sql.raw(`set local role ${role}`);
}

/**
 * Runs `callback` against the database identity appropriate for `role`.
 *
 * When NATIVE_APP_DATABASE_URL / NATIVE_WORKER_DATABASE_URL are configured
 * (a real deployment that has provisioned persi_app_login/persi_worker_login
 * -- see docs/database/88), opens a transaction on the matching dedicated
 * pool and activates the role via SET LOCAL ROLE before invoking `callback`;
 * the activation and its privileges are scoped to that transaction only.
 *
 * When unconfigured (every environment today), falls back to getDatabase()
 * unchanged -- no transaction wrapping, no role activation, identical to
 * this function not existing at all.
 */
export async function withPersiRole<T>(role: PersiRole, callback: (db: PersiDatabase) => Promise<T>): Promise<T> {
  const pool = getRolePool(role);
  if (!pool) return callback(getDatabase());
  return pool.db.transaction(async (tx) => {
    await tx.execute(activationStatement(role));
    return callback(tx as unknown as PersiDatabase);
  });
}

export async function closeNativeCommerceAuthorityForTests(): Promise<void> {
  const state = globalAuthority.__persiCommerceAuthority;
  await Promise.all([
    state?.app?.client.end({ timeout: 5 }),
    state?.worker?.client.end({ timeout: 5 }),
  ]);
  globalAuthority.__persiCommerceAuthority = undefined;
}
