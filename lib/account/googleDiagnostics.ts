export const GOOGLE_DIAGNOSTIC_CODES = [
  "GOOGLE_EMAIL_RECEIVED",
  "GOOGLE_USER_FOUND",
  "GOOGLE_USER_CREATED",
  "GOOGLE_SESSION_CREATED",
  "GOOGLE_SESSION_COOKIE_UPDATED",
  "GOOGLE_SESSION_REUSED",
] as const;

export type GoogleDiagnosticCode =
  (typeof GOOGLE_DIAGNOSTIC_CODES)[number];

export function writeGoogleDiagnostic(code: GoogleDiagnosticCode): void {
  console.info(code);
}
