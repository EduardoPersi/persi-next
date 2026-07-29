"use client";

import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  createOverlayRegistry,
  type OverlayRegistration,
} from "@/lib/ui/overlayRegistry";

export interface OverlayManagerValue {
  activate(id: string): void;
  deactivate(id: string): void;
  register(id: string, registration: OverlayRegistration): () => void;
}

export const OverlayManagerContext =
  createContext<OverlayManagerValue | null>(null);

export function OverlayManagerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const registryRef = useRef(createOverlayRegistry());

  const register = useCallback(
    (id: string, registration: OverlayRegistration) => {
      return registryRef.current.register(id, registration);
    },
    [],
  );

  const activate = useCallback((id: string) => {
    registryRef.current.activate(id);
  }, []);

  const deactivate = useCallback((id: string) => {
    registryRef.current.deactivate(id);
  }, []);

  const value = useMemo(
    () => ({ activate, deactivate, register }),
    [activate, deactivate, register],
  );

  return (
    <OverlayManagerContext.Provider value={value}>
      {children}
    </OverlayManagerContext.Provider>
  );
}
