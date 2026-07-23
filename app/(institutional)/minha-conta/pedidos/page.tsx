import type { Metadata } from "next";
import { AccountPageAccess } from "@/components/Account/AccountPageAccess";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";

export const metadata: Metadata = {
  title: "Pedidos | Persi Materiais de Construção",
  description: "Acesse sua conta para consultar os pedidos feitos na Persi.",
  alternates: { canonical: "/minha-conta/pedidos" },
};

export default function OrdersPage() {
  return (
    <InstitutionalPageLayout title="Pedidos">
      <p>
        Para proteger seus dados, é necessário entrar na sua conta antes de
        consultar pedidos.
      </p>
      <div className="mt-6">
        <AccountPageAccess />
      </div>
    </InstitutionalPageLayout>
  );
}
