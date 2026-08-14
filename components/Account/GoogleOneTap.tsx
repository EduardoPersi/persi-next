"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/hooks/useAccount";
import type { AccountSessionResult } from "@/lib/account/validation";

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        nonce: string;
        auto_select?: boolean;
        itp_support?: boolean;
        use_fedcm_for_prompt?: boolean;
      }) => void;
      prompt: () => void;
      cancel: () => void;
    };
  };
}

function getGoogleIdentityServices(): GoogleIdentityServices | undefined {
  return (window as unknown as { google?: GoogleIdentityServices }).google;
}

const HIDDEN_PATH_PREFIXES = [
  "/entrar",
  "/criar-conta",
  "/esqueci-minha-senha",
  "/redefinir-senha",
  "/checkout",
  "/minha-conta",
];

export function GoogleOneTap() {
  const { status, applySession } = useAccount();
  const pathname = usePathname();
  const [scriptReady, setScriptReady] = useState(false);
  const initialized = useRef(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const eligible =
    Boolean(clientId) &&
    status === "anonymous" &&
    !HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      try {
        const result = await fetch("/api/auth/google/one-tap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
          cache: "no-store",
          credentials: "same-origin",
        });
        const body = (await result.json().catch(() => null)) as AccountSessionResult | null;
        if (result.ok && body?.authenticated) applySession(body);
      } catch {
        // Falha silenciosa: o One Tap é um atalho, não deve interromper a navegação.
      }
    },
    [applySession],
  );

  useEffect(() => {
    if (!eligible || !scriptReady || initialized.current || !clientId) return;

    let cancelled = false;
    initialized.current = true;

    void fetch("/api/auth/google/one-tap/nonce", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json())
      .then((body: { nonce?: string }) => {
        const google = getGoogleIdentityServices();
        if (cancelled || !body.nonce || !google) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          nonce: body.nonce,
          auto_select: false,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        google.accounts.id.prompt();
      })
      .catch(() => {
        initialized.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, eligible, handleCredentialResponse, scriptReady]);

  if (!clientId) return null;

  return (
    <Script
      src="https://accounts.google.com/gsi/client"
      strategy="lazyOnload"
      onReady={() => setScriptReady(true)}
    />
  );
}
