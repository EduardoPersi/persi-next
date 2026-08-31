"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Drawer } from "@/components/Header/Drawer";
import { useAccount } from "@/hooks/useAccount";
import { AccountDrawerHeader } from "./AccountDrawerHeader";
import { AccountLoginForm } from "./AccountLoginForm";
import { SocialLoginButtons } from "./SocialLoginButtons";

type AccountDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function AccountDrawer({ open, onClose }: AccountDrawerProps) {
  const titleId = useId();
  const socialLoginStatusId = useId();
  const { status, customer, logout } = useAccount();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      onClose();
    } finally {
      setLoggingOut(false);
    }
  }

  const title =
    status === "authenticated" ? "Minha conta" : "Entrar na minha conta";

  return (
    <Drawer
      id="account-drawer"
      open={open}
      onClose={onClose}
      side="right"
      widthClassName="max-w-none sm:max-w-[420px]"
      titleId={titleId}
    >
      <div className="flex h-full flex-col">
        <AccountDrawerHeader
          title={title}
          titleId={titleId}
          onClose={onClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
          {status === "loading" ? (
            <p role="status" className="text-sm text-muted">
              Verificando sua sessão...
            </p>
          ) : status === "authenticated" && customer ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-primary-hover">
                  Olá, {customer.firstName || customer.displayName}
                </p>
                <p className="mt-1 break-all text-sm text-muted">
                  {customer.email}
                </p>
              </div>
              <Link
                href="/minha-conta"
                onClick={onClose}
                className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover"
              >
                Acessar minha conta
              </Link>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Saindo..." : "Sair"}
              </Button>
            </div>
          ) : (
            <>
              <AccountLoginForm onSuccess={onClose} variant="drawer" />
              <div className="mt-6">
                <SocialLoginButtons
                  descriptionId={socialLoginStatusId}
                  stacked
                />
                <p
                  id={socialLoginStatusId}
                  className="sr-only"
                >
                  O login com Facebook estará disponível em breve.
                </p>
              </div>
              <div className="mt-6 border-t border-slate-200 py-7 text-center">
                <UserRound
                  className="mx-auto size-14 stroke-1 text-slate-200"
                  aria-hidden="true"
                />
                <p className="mt-5 text-sm font-semibold text-foreground">
                  Ainda não possui uma conta?
                </p>
                <Link
                  href="/criar-conta"
                  onClick={onClose}
                  className="mt-8 inline-block text-sm font-medium uppercase text-primary underline underline-offset-4"
                >
                  Crie uma conta
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
