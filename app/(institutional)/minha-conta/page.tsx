import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountDashboard } from "@/components/Account/AccountDashboard";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Minha conta | Persi Materiais de Construção",
  description: "Acompanhe seus pedidos e recursos da sua conta Persi.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const session = await getServerAccountSession();
  if (!session) redirect("/entrar");

  return (
    <InstitutionalPageLayout title="Minha conta" accountSession={session}>
      <AccountDashboard customer={session.customer} />
    </InstitutionalPageLayout>
  );
}
