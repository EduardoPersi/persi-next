"use client";

import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/UI/Button";
import Link from "next/link";
import { useAccount } from "@/hooks/useAccount";

const inputClassName =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20";

export function AccountLoginForm({
  callbackPath = "/minha-conta",
  onSuccess,
}: {
  callbackPath?: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const { login } = useAccount();
  const messageId = useId();
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
      await login({ identifier, password, remember });
      onSuccess?.();
      router.push(callbackPath === "/minha-conta" ? callbackPath : "/minha-conta");
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
        <label htmlFor="account-identifier" className="mb-2 block text-sm font-medium">
          E-mail ou usuário
        </label>
        <input
          id="account-identifier"
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
        <label htmlFor="account-password" className="mb-2 block text-sm font-medium">
          Senha
        </label>
        <div className="relative">
          <input
            id="account-password"
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

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          name="remember"
          type="checkbox"
          className="h-4 w-4 accent-[#0c2d72]"
          disabled={loading}
        />
        Lembrar de mim
      </label>

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

      <div className="space-y-2 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
        <p><Link href="/criar-conta" className="font-semibold text-[#0c2d72] hover:underline">Criar conta</Link></p>
        <p><Link href="/esqueci-minha-senha" className="font-semibold text-[#0c2d72] hover:underline">Esqueci minha senha</Link></p>
      </div>
    </form>
  );
}
