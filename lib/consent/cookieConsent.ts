export const COOKIE_CONSENT_COOKIE_NAME = "persi_cookie_consent";
const COOKIE_CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

export type CookieConsentValue = "accepted" | "declined";

function isCookieConsentValue(value: string): value is CookieConsentValue {
  return value === "accepted" || value === "declined";
}

export function readCookieConsent(): CookieConsentValue | null {
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${COOKIE_CONSENT_COOKIE_NAME}=`));
  const value = match?.slice(COOKIE_CONSENT_COOKIE_NAME.length + 1) ?? "";
  return isCookieConsentValue(value) ? value : null;
}

export function writeCookieConsent(value: CookieConsentValue): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
}
