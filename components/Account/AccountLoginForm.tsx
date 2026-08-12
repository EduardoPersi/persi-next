"use client";

import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/UI/Button";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
import { RecaptchaNotice } from "@/components/UI/RecaptchaNotice";
import Link from "next/link";
import { useAccount } from "@/hooks/useAccount";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { useRouteTransition } from "@/hooks/useRouteTransition";

const inputClassName =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20";

export function AccountLoginForm({
  callbackPath = "/minha-conta",
  onSuccess,
  variant = "page",
}: {
  callbackPath?: string;
  onSuccess?: () => void;
  variant?: "page" | "drawer";
}) {
  const router = useRouter();
  const { navigate } = useRouteTransition();
  const { login } = useAccount();
  const { getRecaptchaToken } = useRecaptcha();
  const messageId = useId();
  const identifierId = useId();
  const passwordId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get("identifier") ?? "");
    const password = String(form.get("password") ?? "");
    const remember = form.get("remember") === "on";

    setLoading(true);
    setMessage("");
    try {
      const recaptchaToken = (await getRecaptchaToken("account_login")) ?? "";
      await login({ identifier, password, remember, recaptchaToken });
      onSuccess?.();
      navigate(callbackPath === "/minha-conta" ? callbackPath : "/minha-conta");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível entrar com os dados informados.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor={identifierId} className="mb-2 block text-sm font-medium">
          E-mail ou usuário
        </label>
        <EmailAutocompleteInput
          id={identifierId}
          name="identifier"
          type="text"
          autoComplete="username"
          required
          maxLength={320}
          className={inputClassName}
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor={passwordId} className="mb-2 block text-sm font-medium">
          Senha
        </label>
        <div className="relative">
          <input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={4096}
            className={`${inputClassName} pr-12`}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            disabled={loading}
          >
            {showPassword ? (
              <EyeOff size={20} aria-hidden="true" />
            ) : (
              <Eye size={20} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {variant === "page" ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            name="remember"
            type="checkbox"
            className="h-4 w-4 accent-[#0c2d72]"
            disabled={loading}
          />
          Lembrar de mim
        </label>
      ) : null}

      {message ? (
        <p id={messageId} role="alert" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={loading}
        aria-describedby={message ? messageId : undefined}
      >
        {loading ? "Entrando..." : "Entrar"}
      </Button>
      <RecaptchaNotice className="text-center" />

      {variant === "drawer" ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-slate-700">
            <input
              name="remember"
              type="checkbox"
              className="h-4 w-4 accent-[#0c2d72]"
              disabled={loading}
            />
            Lembrar sua senha
          </label>
          <Link
            href="/esqueci-minha-senha"
            className="shrink-0 font-medium text-[#0c2d72] hover:underline"
          >
            Perdeu a sua senha?
          </Link>
        </div>
      ) : (
        <div className="space-y-2 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
          <p><Link href="/criar-conta" className="font-semibold text-[#0c2d72] hover:underline">Criar conta</Link></p>
          <p><Link href="/esqueci-minha-senha" className="font-semibold text-[#0c2d72] hover:underline">Esqueci minha senha</Link></p>
        </div>
      )}
    </form>
  );
}
