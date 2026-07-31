import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountLoginForm } from "@/components/Account/AccountLoginForm";
import { SocialLoginButtons } from "@/components/Account/SocialLoginButtons";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Entrar na minha conta | Persi Materiais",
  description: "Acesse com segurança sua conta na Persi Materiais.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const session = await getServerAccountSession();
  if (session) redirect("/minha-conta");
  const error = (await searchParams).erro;
  const errorMessage =
    error === "google"
      ? "Não foi possível entrar com o Google. Tente novamente."
      : error === "facebook_cancelado"
        ? "Login pelo Facebook cancelado."
        : error === "facebook"
          ? "Não foi possível entrar com o Facebook. Tente novamente."
          : "";

  return (
    <InstitutionalPageLayout
      title="Entrar na minha conta"
      accountSession={{ authenticated: false }}
    >
      <div className="mx-auto max-w-md">
        <p className="mb-6 text-sm leading-6 text-slate-600">
          Use o e-mail ou usuário cadastrado no site da Persi.
        </p>
        <>
          {errorMessage ? (
            <p
              id="social-login-error"
              role="alert"
              className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              {errorMessage}
            </p>
          ) : null}
          <AccountLoginForm />
          <div className="mt-6">
            <SocialLoginButtons descriptionId="social-login-status" />
            <p id="social-login-status" className="mt-2 text-center text-xs text-slate-500">
              Use Google ou Facebook para entrar com segurança.
            </p>
          </div>
        </>
      </div>
    </InstitutionalPageLayout>
  );
}
