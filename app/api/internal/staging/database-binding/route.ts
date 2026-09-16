import { NextResponse } from "next/server";
import { isStagingRuntime } from "@/lib/runtime/runtime-environment";
import { isStagingBasicAuthValid } from "@/lib/runtime/staging-access-guard";
import { checkDatabaseBinding, classifyDatabaseBinding } from "@/lib/pim/publication-runtime-preflight";

// A3.6-D1.8-R3: temporary, tightly-scoped diagnostic route -- its only
// purpose is to prove STAGING_DATABASE_BINDING against the real deployed
// staging process, since no other live channel exists today (see
// lib/pim/publication-runtime-preflight.ts for the full rationale). Remove
// this route once that live proof is captured (docs/pim/18, "Plano de
// prova ao vivo"); do not extend its scope or add fields to the response.
//
// Fail-closed order (must not be reordered):
//   1. wrong runtime -> 404 (route must appear not to exist outside staging)
//   2. missing/invalid Basic Auth -> 401 (redundant with proxy.ts's
//      site-wide staging gate, kept here so this route is fail-closed even
//      in isolation -- e.g. if the proxy matcher is ever changed)
//   3. checkDatabaseBinding() failure/exception -> UNKNOWN, never a crash,
//      never a default MATCH
// Response body is ALWAYS exactly one field: { databaseBinding: "MATCH" | "WRONG" | "UNKNOWN" }.
// No project ref, no DATABASE_URL, no host/port/user/password, no stack trace, ever.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!isStagingRuntime()) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  if (!isStagingBasicAuthValid(request.headers.get("authorization"))) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="staging"' } },
    );
  }

  let databaseBinding: "MATCH" | "WRONG" | "UNKNOWN";
  try {
    databaseBinding = classifyDatabaseBinding(checkDatabaseBinding());
  } catch {
    databaseBinding = "UNKNOWN";
  }

  return NextResponse.json({ databaseBinding }, { headers: { "Cache-Control": "private, no-store" } });
}
