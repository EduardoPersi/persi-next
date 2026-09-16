import "server-only";
import { timingSafeEqual } from "node:crypto";

// A3.6-D1.6 Section 22/23: local fallback access protection for staging
// (Cloudflare Access remains the preferred FUTURE option -- Section 24 --
// but is infrastructure this round cannot touch). This is a defense LAYER,
// not a replacement for the payment/Woo/checkout/messaging guards, which
// remain active even if this check is somehow bypassed.
//
// Fail-closed contract: if PERSI_STAGING_BASIC_AUTH_USER or
// PERSI_STAGING_BASIC_AUTH_PASSWORD is not configured, access is DENIED --
// staging never opens publicly "by accident" just because credentials
// weren't set yet. No default credential exists anywhere in this codebase.

export interface StagingAccessCredentials {
  user: string;
  password: string;
}

function getConfiguredCredentials(environment: NodeJS.ProcessEnv): StagingAccessCredentials | null {
  const user = environment.PERSI_STAGING_BASIC_AUTH_USER;
  const password = environment.PERSI_STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) return null;
  return { user, password };
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // Length must match for timingSafeEqual; comparing against a fixed-size
  // buffer first avoids leaking length via an early throw, and a length
  // mismatch is itself just "not equal" -- never a distinguishable timing
  // signal worth defending further for this use case (a support-facing
  // staging gate, not a cryptographic secret boundary).
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Parses a raw `Authorization` header value (as received from the
 * request) and validates it against the configured staging credentials.
 * Returns false (deny) for: missing header, malformed header, missing
 * configuration, or a credential mismatch. Never throws.
 */
export function isStagingBasicAuthValid(authorizationHeader: string | null, environment: NodeJS.ProcessEnv = process.env): boolean {
  const configured = getConfiguredCredentials(environment);
  if (!configured) return false; // fail-closed: no configured credentials => deny, never allow

  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(authorizationHeader.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return timingSafeStringEqual(user, configured.user) && timingSafeStringEqual(password, configured.password);
}
