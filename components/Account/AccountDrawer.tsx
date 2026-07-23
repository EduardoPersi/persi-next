"use client";

import { useCallback, useId, useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Drawer } from "@/components/Header/Drawer";
import { AccountDrawerHeader } from "./AccountDrawerHeader";
import { SocialLoginButtons } from "./SocialLoginButtons";

type AuthMode = "login" | "register" | "forgot-password";

type AccountDrawerProps = {
  open: boolean;
  onClose: () => void;
};

const inputClassName =
  "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20";

export function AccountDrawer({ open, onClose }: AccountDrawerProps) {
  const titleId = useId();
  const unavailableId = useId();
  const [mode, setMode] = useState<AuthMode>("login");
  const [showPassword, setShowPassword] = useState(false);

  const handleClose = useCallback(() => {
    setShowPassword(false);
    onClose();
  }, [onClose]);

  const title =
    mode === "login"
      ? "Entrar na sua conta"
      : mode === "register"
        ? "Criar uma conta"
        : "Recuperar senha";

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      side="right"
      widthClassName="max-w-none sm:max-w-[420px]"
      titleId={titleId}
    >
      <div className="flex h-full flex-col">
        <AccountDrawerHeader
          title={title}
          titleId={titleId}
          onClose={handleClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
          <div
            id={unavailableId}
            className="mb-5 flex gap-3 rounded-md border border-[#0c2d72]/20 bg-[#0c2d72]/5 p-4 text-sm leading-5 text-slate-700"
          >
            <LockKeyhole
              className="mt-0.5 h-5 w-5 shrink-0 text-[#0c2d72]"
              aria-hidden="true"
            />
            <p>
              O acesso seguro à conta está sendo integrado ao WooCommerce. Os
              formulários ficam indisponíveis até a configuração do serviço de
              autenticação.
            </p>
          </div>

          {mode === "login" ? (
            <>
              <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
                <div>
                  <label htmlFor="account-identifier" className="mb-2 block text-sm">
                    Nome de usuário ou e-mail
                  </label>
                  <input
                    id="account-identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    className={inputClassName}
                    disabled
                  />
                </div>

                <div>
                  <label htmlFor="account-password" className="mb-2 block text-sm">
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      id="account-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className={`${inputClassName} pr-12`}
                      disabled
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500"
                      disabled
                    >
                      {showPassword ? (
                        <EyeOff size={20} aria-hidden="true" />
                      ) : (
                        <Eye size={20} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled
                  aria-describedby={unavailableId}
                >
                  Entrar
                </Button>

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2 text-slate-700">
                    <input type="checkbox" disabled className="h-4 w-4" />
                    Lembrar de mim
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot-password")}
                    className="font-medium text-[#0c2d72] underline-offset-4 hover:underline"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </form>

              <div className="mt-7">
                <SocialLoginButtons descriptionId={unavailableId} />
              </div>

              <div className="mt-8 border-t border-slate-200 pt-6 text-center">
                <p className="mb-3 text-sm text-slate-600">
                  Ainda não possui uma conta?
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setMode("register")}
                >
                  Criar uma conta
                </Button>
              </div>
            </>
          ) : mode === "register" ? (
            <form
              className="space-y-5"
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="register-first-name" className="mb-2 block text-sm">
                    Nome
                  </label>
                  <input
                    id="register-first-name"
                    name="firstName"
                    autoComplete="given-name"
                    className={inputClassName}
                    disabled
                  />
                </div>
                <div>
                  <label htmlFor="register-last-name" className="mb-2 block text-sm">
                    Sobrenome
                  </label>
                  <input
                    id="register-last-name"
                    name="lastName"
                    autoComplete="family-name"
                    className={inputClassName}
                    disabled
                  />
                </div>
              </div>
              <div>
                <label htmlFor="register-email" className="mb-2 block text-sm">
                  E-mail
                </label>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className={inputClassName}
                  disabled
                />
              </div>
              <div>
                <label htmlFor="register-password" className="mb-2 block text-sm">
                  Senha
                </label>
                <input
                  id="register-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className={inputClassName}
                  disabled
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled
                aria-describedby={unavailableId}
              >
                Criar conta
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setMode("login")}
              >
                Voltar para entrar
              </Button>
            </form>
          ) : (
            <form
              className="space-y-5"
              onSubmit={(event) => event.preventDefault()}
            >
              <p className="text-sm leading-6 text-slate-600">
                Informe seu e-mail ou nome de usuário para receber as
                instruções de redefinição.
              </p>
              <div>
                <label htmlFor="recovery-identifier" className="mb-2 block text-sm">
                  E-mail ou nome de usuário
                </label>
                <input
                  id="recovery-identifier"
                  name="identifier"
                  autoComplete="username"
                  className={inputClassName}
                  disabled
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled
                aria-describedby={unavailableId}
              >
                Enviar instruções
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setMode("login")}
              >
                Voltar para entrar
              </Button>
            </form>
          )}
        </div>
      </div>
    </Drawer>
  );
}
