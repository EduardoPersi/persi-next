import { GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS } from "./googleOAuth.ts";

export const GOOGLE_START_DIAGNOSTIC_CODES = [
  "GOOGLE_START_CONFIG_MISSING",
  "GOOGLE_START_CLIENT_ID_MISSING",
  "GOOGLE_START_SECRET_MISSING",
  "GOOGLE_START_REDIRECT_URI_MISSING",
  "GOOGLE_START_REDIRECT_URI_INVALID",
  "GOOGLE_START_STATE_FAILED",
  "GOOGLE_START_PKCE_FAILED",
  "GOOGLE_START_COOKIE_FAILED",
  "GOOGLE_START_URL_CREATED",
] as const;

export type GoogleStartDiagnosticCode =
  (typeof GOOGLE_START_DIAGNOSTIC_CODES)[number];

export function getGoogleStartConfigurationCodes(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleStartDiagnosticCode[] {
  const missing: GoogleStartDiagnosticCode[] = [];
  if (!environment.GOOGLE_CLIENT_ID?.trim()) {
    missing.push("GOOGLE_START_CLIENT_ID_MISSING");
  }
  if (!environment.GOOGLE_CLIENT_SECRET?.trim()) {
    missing.push("GOOGLE_START_SECRET_MISSING");
  }
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) {
    missing.push("GOOGLE_START_REDIRECT_URI_MISSING");
  }
  if (missing.length > 0) {
    return ["GOOGLE_START_CONFIG_MISSING", ...missing];
  }
  if (
    !GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS.includes(
      redirectUri as (typeof GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS)[number],
    )
  ) {
    return ["GOOGLE_START_REDIRECT_URI_INVALID"];
  }
  return [];
}

export function writeGoogleStartDiagnostic(
  code: GoogleStartDiagnosticCode,
): void {
  const message = JSON.stringify({
    source: "persi-google-start",
    code,
  });
  if (code === "GOOGLE_START_URL_CREATED") {
    console.info(message);
    return;
  }
  console.error(message);
}
