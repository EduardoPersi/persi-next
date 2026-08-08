"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentValue,
} from "@/lib/consent/cookieConsent";
import { updateGoogleConsent } from "@/lib/analytics/consentMode";

interface CookieConsentContextValue {
  consent: CookieConsentValue | null;
  bannerVisible: boolean;
  accept(): void;
  decline(): void;
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<CookieConsentValue | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    const stored = readCookieConsent();
    if (stored) {
      setConsent(stored);
      updateGoogleConsent(stored);
      return;
    }
    setBannerVisible(true);
  }, []);

  const accept = useCallback(() => {
    writeCookieConsent("accepted");
    setConsent("accepted");
    setBannerVisible(false);
    updateGoogleConsent("accepted");
  }, []);

  const decline = useCallback(() => {
    writeCookieConsent("declined");
    setConsent("declined");
    setBannerVisible(false);
    updateGoogleConsent("declined");
  }, []);

  const value = useMemo(
    () => ({ consent, bannerVisible, accept, decline }),
    [accept, bannerVisible, consent, decline],
  );

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent(): CookieConsentContextValue {
  const context = useContext(CookieConsentContext);
  if (!context) {
    throw new Error("useCookieConsent must be used inside CookieConsentProvider");
  }
  return context;
}
