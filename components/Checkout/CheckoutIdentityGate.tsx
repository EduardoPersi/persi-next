"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/hooks/useAccount";
import { maskCheckoutEmail, normalizeCheckoutEmail } from "@/lib/checkout-auth/validation";
import { parseAccountSession } from "@/lib/account/validation";
import type { PublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";
import { CheckoutPageClient } from "./CheckoutPageClient";
import { CheckoutEmailStep } from "./CheckoutEmailStep";
import { CheckoutPasswordStep } from "./CheckoutPasswordStep";
import { CheckoutOtpStep } from "./CheckoutOtpStep";

type IdentityState = "email" | "password" | "otp" | "guest";
const OTP_STORAGE_KEY = "persi_checkout_identity_otp";

interface CheckoutIdentityGateProps {
  capabilities: PublicCheckoutCapabilities;
}

async function post(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, result };
}

export function CheckoutIdentityGate({ capabilities }: CheckoutIdentityGateProps) {
  const router = useRouter();
  const account = useAccount();
  const [state, setState] = useState<IdentityState>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    const raw = window.sessionStorage.getItem(OTP_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { email?: unknown; cooldownUntil?: unknown };
      if (typeof saved.email !== "string") return;
      const normalized = normalizeCheckoutEmail(saved.email);
      if (!normalized) return;
      queueMicrotask(() => {
        setEmail(normalized);
        setCooldownUntil(typeof saved.cooldownUntil === "number" ? saved.cooldownUntil : 0);
        setState("otp");
      });
    } catch {
      window.sessionStorage.removeItem(OTP_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function message(result: Record<string, unknown>, fallback: string) {
    return typeof result.message === "string" ? result.message : fallback;
  }

  async function identify() {
    const normalized = normalizeCheckoutEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Informe um e-mail válido para continuar.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { response, result } = await post("/api/checkout-auth/identify", { email: normalized });
      if (!response.ok) throw new Error(message(result, "Não foi possível verificar o e-mail."));
      setEmail(normalized);
      setState(result.exists === true ? "password" : "guest");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível verificar o e-mail.");
    } finally {
      setLoading(false);
    }
  }

  async function authenticate(path: string, body: Record<string, string>) {
    setLoading(true);
    setError("");
    try {
      const { response, result } = await post(path, body);
      if (!response.ok) throw new Error(message(result, "Não foi possível entrar."));
      const session = parseAccountSession(result);
      if (!session.authenticated) throw new Error("A sessão não foi iniciada.");
      account.applySession(session);
      window.sessionStorage.removeItem(OTP_STORAGE_KEY);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function requestCode() {
    setLoading(true);
    setError("");
    try {
      const { response, result } = await post("/api/checkout-auth/code/request", { email });
      if (!response.ok) {
        const retryAfter = typeof result.retryAfter === "number" ? result.retryAfter : 0;
        if (response.status === 429 && retryAfter > 0) {
          setCooldownUntil(Date.now() + retryAfter * 1000);
        }
        throw new Error(message(result, "Não foi possível enviar o código."));
      }
      const seconds = typeof result.cooldown === "number" ? result.cooldown : 60;
      const nextCooldown = Date.now() + seconds * 1000;
      setCooldownUntil(nextCooldown);
      setNow(Date.now());
      setDigits(["", "", "", "", "", ""]);
      setState("otp");
      window.sessionStorage.setItem(OTP_STORAGE_KEY, JSON.stringify({ email, cooldownUntil: nextCooldown }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível enviar o código.");
    } finally {
      setLoading(false);
    }
  }

  if (state === "guest") {
    return (
      <CheckoutPageClient
        initialProfile={null}
        initialAddresses={[]}
        initialGuestEmail={email}
        capabilities={capabilities}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-[540px] max-w-3xl flex-col items-center justify-start px-1 py-10 sm:justify-center sm:py-14">
      {state === "email" ? (
        <CheckoutEmailStep email={email} error={error} loading={loading} onChange={(value) => { setEmail(value); setError(""); }} onSubmit={() => void identify()} />
      ) : null}
      {state === "password" ? (
        <CheckoutPasswordStep email={email} password={password} error={error} loading={loading} onChange={(value) => { setPassword(value); setError(""); }} onSubmit={() => void authenticate("/api/checkout-auth/password", { email, password })} onRequestCode={() => void requestCode()} onBack={() => { setState("email"); setPassword(""); setError(""); }} />
      ) : null}
      {state === "otp" ? (
        <CheckoutOtpStep maskedEmail={maskCheckoutEmail(email)} digits={digits} cooldown={cooldown} error={error} loading={loading} onChange={(value) => { setDigits(value); setError(""); }} onSubmit={() => void authenticate("/api/checkout-auth/code/verify", { email, code: digits.join("") })} onResend={() => void requestCode()} onBack={() => { window.sessionStorage.removeItem(OTP_STORAGE_KEY); setState("password"); setDigits(["", "", "", "", "", ""]); setError(""); }} />
      ) : null}

      <p id="checkout-identity-status" className="mt-4 min-h-6 text-center text-sm font-medium text-red-700" role="alert" aria-live="polite">
        {error}
      </p>

      <aside className="mt-7 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm sm:p-7">
        <h2 className="font-semibold text-green-800">Usamos seu e-mail de forma segura para:</h2>
        <ul className="mt-4 space-y-3 text-sm text-slate-600">
          {["Identificar seu perfil", "Enviar atualizações do pedido", "Recuperar seu carrinho", "Agilizar o preenchimento dos dados"].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
