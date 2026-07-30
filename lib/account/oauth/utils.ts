export function isOAuthRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getOAuthString(
  value: unknown,
  maxLength: number,
): string {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : "";
}

export function getSafeHttpsUrl(value: unknown): string {
  const candidate = getOAuthString(value, 2_048);
  if (!candidate) return "";

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildOAuthUrl(
  endpoint: string,
  parameters: Record<string, string>,
): URL {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(parameters).toString();
  return url;
}

export function getSafeOAuthOrigin(
  redirectUri: string | undefined,
  allowedRedirectUris: readonly string[],
): string {
  const candidate = redirectUri?.trim() ?? "";
  return allowedRedirectUris.includes(candidate)
    ? new URL(candidate).origin
    : new URL(allowedRedirectUris[0]).origin;
}
