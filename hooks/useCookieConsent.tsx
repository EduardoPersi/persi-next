"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
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
const consentListeners = new Set<() => void>();

function subscribeToConsent(listener: () => void) {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

function notifyConsentChanged() {
  consentListeners.forEach((listener) => listener());
}

function subscribeToHydration() {
  return () => {};
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const lastAppliedConsent = useRef<CookieConsentValue | null>(null);
  const consent = useSyncExternalStore(
    subscribeToConsent,
    readCookieConsent,
    () => null,
  );
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const bannerVisible = hydrated && consent === null;

  useEffect(() => {
    if (consent && lastAppliedConsent.current !== consent) {
      updateGoogleConsent(consent);
      lastAppliedConsent.current = consent;
    }
  }, [consent]);

  const accept = useCallback(() => {
    writeCookieConsent("accepted");
    notifyConsentChanged();
    updateGoogleConsent("accepted");
    lastAppliedConsent.current = "accepted";
  }, []);

  const decline = useCallback(() => {
    writeCookieConsent("declined");
    notifyConsentChanged();
    updateGoogleConsent("declined");
    lastAppliedConsent.current = "declined";
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
