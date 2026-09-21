import "server-only";

import { sql } from "drizzle-orm";
import { withPersiRole, type PersiRole } from "@/lib/db/nativeCommerceAuthority";

// TEMPORARY_STAGING_PROBE=YES.
//
// Decision/DB logic for app/api/internal/native-commerce-identity-probe/route.ts,
// kept in a file that does NOT import "next/server" so it can be imported
// and unit-tested directly under the plain Node test runner (route.ts itself
// cannot be, per this codebase's own established convention -- see
// tests/nativeCheckoutHttpBoundary.test.mjs's file-level comment).
//
// This is NOT permanent functionality. Delete this file, the route file,
// and their tests once the real Hostinger runtime identity qualification is
// done -- see scratchpad/native_commerce_hostinger_identity_probe.json.

export type RoleEnvVarName = "NATIVE_APP_DATABASE_URL" | "NATIVE_WORKER_DATABASE_URL";
export type IdentityRow = { current_user: string; session_user: string };
export type IdentityCheckResult = { ok: boolean; activatedAs: PersiRole };

// Pure decision logic: given what the fixed query actually returned, decide
// pass/fail. No DB, no env access -- directly unit-testable with fabricated
// rows.
export function evaluateIdentityRow(role: PersiRole, expectedSessionUser: string, row: IdentityRow | undefined): IdentityCheckResult {
  if (!row) return { ok: false, activatedAs: role };
  const currentUserOk = row.current_user === role;
  const sessionUserOk = row.session_user === expectedSessionUser;
  return { ok: currentUserOk && sessionUserOk, activatedAs: role };
}

// Exercises the REAL production withPersiRole() helper (lib/db/
// nativeCommerceAuthority.ts) -- never a parallel SET ROLE implementation.
// Presence of the role's env var is checked explicitly BEFORE calling
// withPersiRole: that function silently falls back to the ambient
// DATABASE_URL identity when its own env var is unset, and that fallback
// must never be able to read as a pass here.
export async function checkIdentity(role: PersiRole, envVarName: RoleEnvVarName, expectedSessionUser: string): Promise<IdentityCheckResult> {
  if (!process.env[envVarName]?.trim()) {
    return { ok: false, activatedAs: role };
  }

  try {
    const rows = await withPersiRole(role, (db) => db.execute<IdentityRow>(sql`select current_user, session_user`));
    return evaluateIdentityRow(role, expectedSessionUser, rows[0]);
  } catch {
    // Sanitized on purpose -- the raw error could carry connection details.
    return { ok: false, activatedAs: role };
  }
}

export async function runNativeCommerceIdentityProbe(): Promise<{ app: IdentityCheckResult; worker: IdentityCheckResult }> {
  const [app, worker] = await Promise.all([
    checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login"),
    checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login"),
  ]);
  return { app, worker };
}
