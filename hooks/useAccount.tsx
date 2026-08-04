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
import type {
  AccountCustomer,
  AccountLoginPayload,
  AccountSessionResult,
} from "@/lib/account/validation";

type AccountStatus = "loading" | "authenticated" | "anonymous";

interface AccountContextValue {
  status: AccountStatus;
  customer: AccountCustomer | null;
  login(payload: AccountLoginPayload): Promise<void>;
  logout(): Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);
const AUTH_CHANNEL = "persi-auth";

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function AccountProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession?: AccountSessionResult;
}) {
  const [status, setStatus] = useState<AccountStatus>(
    initialSession?.authenticated
      ? "authenticated"
      : initialSession
        ? "anonymous"
        : "loading",
  );
  const [customer, setCustomer] = useState<AccountCustomer | null>(
    initialSession?.authenticated ? initialSession.customer : null,
  );

  useEffect(() => {
    if (initialSession) return;
    const controller = new AbortController();
    void fetch("/api/account/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await readResponse(response)) as unknown as AccountSessionResult;
        if (response.ok && body.authenticated) {
          setCustomer(body.customer);
          setStatus("authenticated");
          return;
        }
        setCustomer(null);
        setStatus("anonymous");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("anonymous");
      });
    return () => controller.abort();
  }, [initialSession]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (event.data !== "logout") return;
      setCustomer(null);
      setStatus("anonymous");
      if (window.location.pathname.startsWith("/minha-conta") || window.location.pathname.startsWith("/checkout")) {
        window.location.replace("/entrar");
      }
    });
    return () => channel.close();
  }, []);

  const login = useCallback(async (payload: AccountLoginPayload) => {
    const response = await fetch("/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await readResponse(response);
    if (!response.ok || body.authenticated !== true) {
      throw new Error(
        typeof body.message === "string"
          ? body.message
          : "Não foi possível entrar com os dados informados.",
      );
    }
    const result = body as unknown as AccountSessionResult;
    if (!result.authenticated) throw new Error("Resposta de sessão inválida.");
    setCustomer(result.customer);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/account/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
    } finally {
      setCustomer(null);
      setStatus("anonymous");
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(AUTH_CHANNEL);
        channel.postMessage("logout");
        channel.close();
      }
      window.location.replace("/entrar");
    }
  }, []);

  const value = useMemo(
    () => ({ status, customer, login, logout }),
    [customer, login, logout, status],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccount must be used inside AccountProvider");
  return context;
}
