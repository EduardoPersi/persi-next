import type { CookieConsentValue } from "@/lib/consent/cookieConsent";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function updateGoogleConsent(value: CookieConsentValue): void {
  const state = value === "accepted" ? "granted" : "denied";
  window.gtag?.("consent", "update", {
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
    analytics_storage: state,
  });
}
