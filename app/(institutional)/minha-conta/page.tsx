import type { Metadata } from "next";
import { AccountPageAccess } from "@/components/Account/AccountPageAccess";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";

export const metadata: Metadata = {
  title: "Minha conta | Persi Materiais de Construção",
  description:
    "Acesse sua conta da Persi para acompanhar pedidos e dados cadastrais.",
  alternates: { canonical: "/minha-conta" },
};

export default function AccountPage() {
  return (
    <InstitutionalPageLayout title="Minha conta">
      <p>
        Entre para acompanhar seus pedidos, endereços e dados cadastrais.
      </p>
      <div className="mt-6">
        <AccountPageAccess />
      </div>
    </InstitutionalPageLayout>
  );
}
