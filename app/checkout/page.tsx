import type { Metadata } from "next";
import { CheckoutPageClient } from "@/components/Checkout/CheckoutPageClient";
import { CheckoutHeader } from "@/components/Header/CheckoutHeader";
import { Container } from "@/components/UI/Container";
import { getServerAccountSession, getServerAccountToken } from "@/services/account/serverSession";
import {
  getCustomerWorkspaceAddresses,
  getCustomerWorkspaceProfile,
} from "@/services/account/workspace";
import type {
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
} from "@/lib/customer-workspace/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Finalizar compra | Persi Materiais",
  description: "Revise seus dados e seu pedido na Persi Materiais.",
  robots: {
    index: false,
    follow: false,
  },
};

// O checkout continua aberto para convidados (sem exigir login, ao
// contrário das páginas de "Minha conta") — só reaproveita a sessão e os
// dados já salvos quando o cliente já está autenticado, para pré-preencher
// o formulário. Segue o mesmo mecanismo de app/(institutional)/minha-conta.
async function getAccountPrefillData(): Promise<{
  profile: CustomerWorkspaceProfile | null;
  addresses: CustomerWorkspaceAddress[];
}> {
  const [session, token] = await Promise.all([
    getServerAccountSession(),
    getServerAccountToken(),
  ]);

  if (!session?.authenticated || !token) {
    return { profile: null, addresses: [] };
  }

  const [profile, addresses] = await Promise.all([
    getCustomerWorkspaceProfile(token).catch(() => null),
    getCustomerWorkspaceAddresses(token).catch(() => []),
  ]);

  return { profile, addresses };
}

export default async function CheckoutPage() {
  const { profile, addresses } = await getAccountPrefillData();

  return (
    <>
      <CheckoutHeader />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <h1 className="sr-only">Finalizar compra</h1>
          <CheckoutPageClient initialProfile={profile} initialAddresses={addresses} />
        </Container>
      </main>
    </>
  );
}
