import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountDashboard } from "@/components/Account/AccountDashboard";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getServerAccountSession, getServerAccountToken } from "@/services/account/serverSession";
import { getCustomerWorkspaceSummary } from "@/services/account/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Minha conta | Persi Materiais de Construção",
  description: "Acompanhe seus pedidos e recursos da sua conta Persi.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const [session, token] = await Promise.all([getServerAccountSession(), getServerAccountToken()]);
  if (!session || !token) redirect("/entrar");
  const summary = await getCustomerWorkspaceSummary(token).catch(() => null);

  return (
    <CustomerWorkspacePage title="Minha conta" session={session}>
      <AccountDashboard customer={session.customer} summary={summary} />
    </CustomerWorkspacePage>
  );
}
