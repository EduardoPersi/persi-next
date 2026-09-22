import "server-only";

import { sql } from "drizzle-orm";
import { getPersiRolePoolForDiagnostics, withPersiRole, type PersiRole } from "@/lib/db/nativeCommerceAuthority";

// TEMPORARY_STAGING_PROBE=YES.
//
// Decision/DB logic for app/api/internal/native-commerce-identity-probe/route.ts,
// kept in a file that does NOT import "next/server" so it can be imported
// and unit-tested directly under the plain Node test runner (route.ts itself
// cannot be, per this codebase's own established convention -- see
// tests/nativeCheckoutHttpBoundary.test.mjs's file-level comment).
//
// This is NOT permanent functionality. Delete this file, the route file,
// their tests, and lib/db/nativeCommerceAuthority.ts's
// getPersiRolePoolForDiagnostics export once the real Hostinger runtime
// identity qualification is done -- see scratchpad/native_commerce_hostinger_identity_probe.json.
//
// R3 (APP connection/activation isolation): R2's `connection_or_activation_error`
// stage collapsed two genuinely different failure layers for APP -- (a) the
// dedicated NATIVE_APP_DATABASE_URL connection/authentication itself, and
// (b) SET LOCAL ROLE persi_app once connected. A real staging run kept
// returning that combined stage even after rotating persi_app_login's
// password and rebuilding the URL, so finer isolation was needed to know
// which layer actually fails. checkAppIdentityDetailed() below runs two
// SEPARATE, SEQUENTIAL steps against APP: first a bare query on the
// dedicated pool (via getPersiRolePoolForDiagnostics, never through
// withPersiRole) to prove the connection's own login identity BEFORE any
// role activation, then -- only if that passes -- the REAL withPersiRole()
// to prove SET LOCAL ROLE. WORKER is left on the original, already-proven
// checkIdentity()/evaluateIdentityRow() path unchanged, as a control.

export type RoleEnvVarName = "NATIVE_APP_DATABASE_URL" | "NATIVE_WORKER_DATABASE_URL";
export type IdentityRow = { current_user: string; session_user: string };

// The one and only query text used anywhere in this module, for both the
// bare-connection check and the role-activation check.
const IDENTITY_QUERY = sql`select current_user, session_user`;

// ---------- WORKER: unchanged control path (R2), not redesigned this round ----------

export type ProbeStage = "ok" | "env_missing" | "connection_or_activation_error" | "identity_mismatch";

export type IdentityCheckResult = {
  ok: boolean;
  stage: ProbeStage;
  currentUserMatch: boolean | null;
  sessionUserMatch: boolean | null;
};

// Generic pure decision logic (role/expected-login parameterized). Today
// only the worker path calls this for real -- APP moved to the two-step
// model below after R2 proved this single-shot model can't distinguish
// connection failure from role-activation failure.
export function evaluateIdentityRow(role: PersiRole, expectedSessionUser: string, row: IdentityRow | undefined): IdentityCheckResult {
  if (!row) {
    return { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null };
  }
  const currentUserMatch = row.current_user === role;
  const sessionUserMatch = row.session_user === expectedSessionUser;
  if (currentUserMatch && sessionUserMatch) {
    return { ok: true, stage: "ok", currentUserMatch: true, sessionUserMatch: true };
  }
  return { ok: false, stage: "identity_mismatch", currentUserMatch, sessionUserMatch };
}

export async function checkIdentity(role: PersiRole, envVarName: RoleEnvVarName, expectedSessionUser: string): Promise<IdentityCheckResult> {
  if (!process.env[envVarName]?.trim()) {
    return { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null };
  }
  try {
    const rows = await withPersiRole(role, (db) => db.execute<IdentityRow>(IDENTITY_QUERY));
    return evaluateIdentityRow(role, expectedSessionUser, rows[0]);
  } catch {
    return { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null };
  }
}

// ---------- APP: R3 two-step connection/activation isolation ----------

export type AppProbeStage =
  | "ok"
  | "env_missing"
  | "connection_error"
  | "login_identity_mismatch"
  | "role_activation_error"
  | "role_identity_mismatch";

export type AppIdentityCheckResult = {
  ok: boolean;
  stage: AppProbeStage;
  loginIdentityMatch: boolean | null;
  roleActivationMatch: boolean | null;
};

const APP_LOGIN = "persi_app_login";
const APP_ROLE: PersiRole = "persi_app";

type StepOutcome = { proceed: true } | { proceed: false; result: AppIdentityCheckResult };

// STEP 1, pure: given what the bare (pre-activation) connection actually
// returned (or undefined, meaning the query/connection itself failed),
// decide whether to proceed to role activation. Directly unit-testable
// with fabricated rows, no live Postgres needed.
export function evaluateAppBareConnection(row: IdentityRow | undefined): StepOutcome {
  if (!row) {
    return { proceed: false, result: { ok: false, stage: "connection_error", loginIdentityMatch: null, roleActivationMatch: null } };
  }
  const loginIdentityMatch = row.current_user === APP_LOGIN && row.session_user === APP_LOGIN;
  if (!loginIdentityMatch) {
    return { proceed: false, result: { ok: false, stage: "login_identity_mismatch", loginIdentityMatch: false, roleActivationMatch: null } };
  }
  return { proceed: true };
}

// STEP 2, pure: given what the activated (post SET LOCAL ROLE) connection
// actually returned (or undefined, meaning that query/activation itself
// failed), decide the final result. Only ever called after STEP 1 already
// proved the dedicated login's own identity.
export function evaluateAppRoleActivation(row: IdentityRow | undefined): AppIdentityCheckResult {
  if (!row) {
    return { ok: false, stage: "role_activation_error", loginIdentityMatch: true, roleActivationMatch: null };
  }
  const roleActivationMatch = row.current_user === APP_ROLE && row.session_user === APP_LOGIN;
  if (!roleActivationMatch) {
    return { ok: false, stage: "role_identity_mismatch", loginIdentityMatch: true, roleActivationMatch: false };
  }
  return { ok: true, stage: "ok", loginIdentityMatch: true, roleActivationMatch: true };
}

export async function checkAppIdentityDetailed(): Promise<AppIdentityCheckResult> {
  if (!process.env.NATIVE_APP_DATABASE_URL?.trim()) {
    return { ok: false, stage: "env_missing", loginIdentityMatch: null, roleActivationMatch: null };
  }

  // Same lazily-created, cached pool withPersiRole uses -- never a parallel
  // connection mechanism. Null here would mean the env var above was
  // somehow unset by now; treated as env_missing defensively.
  const bareDb = getPersiRolePoolForDiagnostics(APP_ROLE);
  if (!bareDb) {
    return { ok: false, stage: "env_missing", loginIdentityMatch: null, roleActivationMatch: null };
  }

  // STEP 1: dedicated connection, BEFORE any role activation.
  let bareRow: IdentityRow | undefined;
  try {
    bareRow = (await bareDb.execute<IdentityRow>(IDENTITY_QUERY))[0];
  } catch {
    bareRow = undefined;
  }

  const step1 = evaluateAppBareConnection(bareRow);
  if (!step1.proceed) return step1.result;

  // STEP 2: only reached once STEP 1 proved the dedicated login's own
  // identity. Uses the REAL withPersiRole() -- never a parallel SET ROLE
  // implementation.
  let activatedRow: IdentityRow | undefined;
  try {
    activatedRow = (await withPersiRole(APP_ROLE, (db) => db.execute<IdentityRow>(IDENTITY_QUERY)))[0];
  } catch {
    activatedRow = undefined;
  }

  return evaluateAppRoleActivation(activatedRow);
}

export async function runNativeCommerceIdentityProbe(): Promise<{ app: AppIdentityCheckResult; worker: IdentityCheckResult }> {
  const [app, worker] = await Promise.all([
    checkAppIdentityDetailed(),
    checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login"),
  ]);
  return { app, worker };
}
