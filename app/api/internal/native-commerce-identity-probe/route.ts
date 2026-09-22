import { NextResponse } from "next/server";
import { runNativeCommerceIdentityProbe } from "@/lib/runtime/native-commerce-identity-probe";
import { isStagingRuntime } from "@/lib/runtime/runtime-environment";
import { isStagingBasicAuthValid } from "@/lib/runtime/staging-access-guard";

// TEMPORARY_STAGING_PROBE=YES.
//
// Purpose: prove, from the REAL Hostinger staging process, that
// NATIVE_APP_DATABASE_URL / NATIVE_WORKER_DATABASE_URL actually authenticate
// as persi_app_login / persi_worker_login and can SET LOCAL ROLE
// persi_app / persi_worker -- using the exact production withPersiRole()
// helper (lib/db/nativeCommerceAuthority.ts, via lib/runtime/
// native-commerce-identity-probe.ts), never a parallel implementation.
// This route is NOT permanent functionality: delete this file, the helper
// module it wraps, and their tests once that qualification is done -- see
// scratchpad/native_commerce_hostinger_identity_probe.json for the exact
// removal list.
//
// Guarantees:
//  - GET only, no request body, no query parameters read at all -- role,
//    SQL and database are 100% hardcoded, never selected by a caller.
//  - Fail-closed staging guard: any PERSI_RUNTIME_ENV other than exactly
//    "staging" (including undefined/empty/"production"/"development") is a
//    404, before anything else runs -- including before the Basic Auth
//    check, so a probe request against production shape reveals nothing.
//  - Reuses the site's existing staging Basic Auth helpers verbatim
//    (isStagingRuntime / isStagingBasicAuthValid from lib/runtime) as a
//    second, route-local check -- defense in depth alongside proxy.ts's own
//    site-wide gate, not a replacement for it, and not a reimplementation of
//    the credential comparison itself.
//  - The only query ever executed (in the wrapped helper) is the fixed
//    `select current_user, session_user` -- no business table, no domain
//    function, no commerce side effect of any kind.
//  - Response never contains a URL, password, host, project ref, a raw
//    current_user/session_user value, or a raw SQL/driver error -- only a
//    `stage` classification plus two nullable booleans per side.
//  - APP (R3): isolates the dedicated NATIVE_APP_DATABASE_URL connection's
//    own login identity from SET LOCAL ROLE activation -- stages are
//    ok | env_missing | connection_error | login_identity_mismatch |
//    role_activation_error | role_identity_mismatch (see lib/runtime/
//    native-commerce-identity-probe.ts's file-level comment for why R2's
//    single combined connection_or_activation_error stage wasn't granular
//    enough).
//  - WORKER: unchanged control path from R2 (already proven working live),
//    stages are ok | env_missing | connection_or_activation_error |
//    identity_mismatch.

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="staging"', ...NO_STORE_HEADERS },
  });
}

export async function GET(request: Request) {
  if (!isStagingRuntime()) {
    return new NextResponse(null, { status: 404, headers: NO_STORE_HEADERS });
  }

  if (!isStagingBasicAuthValid(request.headers.get("authorization"))) {
    return unauthorizedResponse();
  }

  const { app, worker } = await runNativeCommerceIdentityProbe();

  return NextResponse.json(
    {
      app: { ok: app.ok, stage: app.stage, loginIdentityMatch: app.loginIdentityMatch, roleActivationMatch: app.roleActivationMatch },
      worker: { ok: worker.ok, stage: worker.stage, currentUserMatch: worker.currentUserMatch, sessionUserMatch: worker.sessionUserMatch },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
