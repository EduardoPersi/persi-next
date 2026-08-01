import Link from "next/link";
import { BellRing, Eye, Heart, Link2, MapPin, Package, UserRound } from "lucide-react";
import type { AccountCustomer } from "@/lib/account/validation";
import type { CustomerWorkspaceSummary } from "@/lib/customer-workspace/types";
import { getAccountGreetingName } from "@/lib/account/display";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { AccountDashboardCard } from "./AccountDashboardCard";

const dashboardItems = [
  { title: "Pedidos", href: "/minha-conta/pedidos", icon: Package },
  { title: "Endereços", href: "/minha-conta/enderecos", icon: MapPin },
  { title: "Dados pessoais", href: "/minha-conta/perfil", icon: UserRound },
  { title: "Lista de espera", href: "/minha-conta/lista-espera", icon: BellRing },
  { title: "Minhas listas", href: "/minha-conta/listas", icon: Heart },
  { title: "Contas conectadas", href: "/minha-conta/contas-conectadas", icon: Link2 },
] as const;

export function AccountDashboard({ customer, summary }: { customer: AccountCustomer; summary: CustomerWorkspaceSummary | null }) {
  const greetingName = getAccountGreetingName(customer);
  const metrics = [
    ["Pedidos", summary?.orders, "/minha-conta/pedidos"],
    ["Favoritos", summary?.favorites, "/favoritos"],
    ["Listas", summary?.lists, "/minha-conta/listas"],
    ["Endereços", summary?.addresses, "/minha-conta/enderecos"],
  ] as const;
  return (
    <div>
      <section aria-labelledby="account-greeting">
        <h2 id="account-greeting" className="text-2xl font-bold text-[#071f5c]">Olá{greetingName ? `, ${greetingName}` : ""}!</h2>
        <p className="mt-2 text-slate-600">Bem-vindo novamente.</p>
      </section>
      <section aria-label="Resumo da conta" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(([label, value, href]) => <Link key={label} href={href} className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"><span className="block text-2xl font-bold text-[#071f5c]">{value ?? "—"}</span><span className="mt-1 block text-sm text-slate-600">{label}</span></Link>)}
      </section>
      {!summary ? <p role="status" className="mt-3 text-sm text-slate-500">O resumo será atualizado assim que o serviço da conta responder.</p> : null}
      <section aria-label="Recursos da minha conta" className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dashboardItems.map((item) => <AccountDashboardCard key={item.title} {...item} />)}
        <AccountDashboardCard title="Produtos vistos" href="/minha-conta/produtos-vistos" icon={Eye} />
      </section>
      <RecentlyViewedProducts title="Produtos vistos recentemente" sectionId="workspace-recent-products" />
    </div>
  );
}
