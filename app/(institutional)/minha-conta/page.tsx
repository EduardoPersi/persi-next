import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountLogoutButton } from "@/components/Account/AccountLogoutButton";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Minha conta | Persi Materiais de Construção",
  description: "Consulte os dados básicos da sua conta Persi.",
  robots: { index: false, follow: false },
};

const futureSections = [
  {
    title: "Pedidos",
    description: "A consulta de pedidos estará disponível em uma próxima etapa.",
  },
  {
    title: "Endereços",
    description: "O gerenciamento de endereços estará disponível em uma próxima etapa.",
  },
  {
    title: "Dados pessoais",
    description: "A edição dos seus dados estará disponível em uma próxima etapa.",
  },
];

export default async function AccountPage() {
  const session = await getServerAccountSession();
  if (!session) redirect("/entrar");

  const name =
    session.customer.firstName || session.customer.displayName || "cliente";

  return (
    <InstitutionalPageLayout title="Minha conta" accountSession={session}>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-lg font-semibold text-[#071f5c]">Olá, {name}.</p>
          <p className="mt-2 break-all text-slate-600">{session.customer.email}</p>
        </div>
        <AccountLogoutButton />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {futureSections.map((section) => (
          <section
            key={section.title}
            className="rounded-xl border border-slate-200 bg-slate-50 p-5"
          >
            <h2 className="font-semibold text-[#071f5c]">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {section.description}
            </p>
          </section>
        ))}
      </div>
    </InstitutionalPageLayout>
  );
}
