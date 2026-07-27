import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountLoginForm } from "@/components/Account/AccountLoginForm";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { AccountProvider } from "@/hooks/useAccount";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Entrar na minha conta | Persi Materiais",
  description: "Acesse com segurança sua conta na Persi Materiais.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const session = await getServerAccountSession();
  if (session) redirect("/minha-conta");

  return (
    <InstitutionalPageLayout
      title="Entrar na minha conta"
      accountSession={{ authenticated: false }}
    >
      <div className="mx-auto max-w-md">
        <p className="mb-6 text-sm leading-6 text-slate-600">
          Use o e-mail ou usuário cadastrado no site da Persi.
        </p>
        <AccountProvider initialSession={{ authenticated: false }}>
          <AccountLoginForm />
        </AccountProvider>
      </div>
    </InstitutionalPageLayout>
  );
}
