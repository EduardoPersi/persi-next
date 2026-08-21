import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutPageClient } from "@/components/Checkout/CheckoutPageClient";
import { CheckoutIdentityGate } from "@/components/Checkout/CheckoutIdentityGate";
import { CheckoutHeader } from "@/components/Header/CheckoutHeader";
import { Container } from "@/components/UI/Container";
import {
  getCheckoutMode,
  getPublicCheckoutCapabilities,
} from "@/lib/commerce/checkoutConfig";
import {
  getServerAccountSession,
  getServerAccountToken,
} from "@/services/account/serverSession";
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
  robots: { index: false, follow: false },
};

async function getAccountPrefillData(token: string): Promise<{
  profile: CustomerWorkspaceProfile | null;
  addresses: CustomerWorkspaceAddress[];
}> {
  const [profile, addresses] = await Promise.all([
    getCustomerWorkspaceProfile(token).catch(() => null),
    getCustomerWorkspaceAddresses(token).catch(() => []),
  ]);
  return { profile, addresses };
}

export default async function CheckoutPage() {
  if (getCheckoutMode() === "hybrid") redirect("/checkout/hybrid");

  const [session, token, capabilities] = await Promise.all([
    getServerAccountSession(),
    getServerAccountToken(),
    Promise.resolve(getPublicCheckoutCapabilities()),
  ]);
  const authenticated = Boolean(session?.authenticated && token);
  const { profile, addresses } = authenticated && token
    ? await getAccountPrefillData(token)
    : { profile: null, addresses: [] };

  return (
    <>
      <CheckoutHeader />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <h1 className="sr-only">Finalizar compra</h1>
          {authenticated ? (
            <CheckoutPageClient
              initialProfile={profile}
              initialAddresses={addresses}
              initialGuestEmail={session?.customer.email}
              capabilities={capabilities}
            />
          ) : (
            <CheckoutIdentityGate capabilities={capabilities} />
          )}
        </Container>
      </main>
    </>
  );
}
