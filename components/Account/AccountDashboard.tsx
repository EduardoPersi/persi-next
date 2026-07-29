import {
  BellRing,
  CircleUserRound,
  ClipboardList,
  Heart,
  MapPin,
} from "lucide-react";
import type { AccountCustomer } from "@/lib/account/validation";
import { getAccountGreetingName } from "@/lib/account/display";
import { AccountDashboardCard } from "./AccountDashboardCard";
import { AccountLogoutButton } from "./AccountLogoutButton";

type AccountDashboardProps = {
  customer: AccountCustomer;
};

const dashboardItems = [
  {
    title: "Pedidos",
    href: "/minha-conta/pedidos",
    icon: ClipboardList,
  },
  { title: "Endereços", icon: MapPin },
  { title: "Dados pessoais", icon: CircleUserRound },
  { title: "Lista de espera", icon: BellRing },
  { title: "Favoritos", icon: Heart },
] as const;

export function AccountDashboard({ customer }: AccountDashboardProps) {
  const greetingName = getAccountGreetingName(customer);

  return (
    <div>
      <section aria-labelledby="account-greeting">
        <h2
          id="account-greeting"
          className="text-xl font-bold text-[#071f5c] sm:text-2xl"
        >
          Olá{greetingName ? `, ${greetingName}` : ""}!
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-slate-600">
          A partir do painel da sua conta, você pode acompanhar seus pedidos,
          gerenciar seus endereços, atualizar seus dados e acessar outros
          recursos.
        </p>
        <p className="mt-2 break-all text-sm text-slate-500">
          Conta: {customer.email}
        </p>
      </section>

      <section
        aria-label="Recursos da minha conta"
        className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {dashboardItems.map((item) => (
          <AccountDashboardCard key={item.title} {...item} />
        ))}
        <AccountLogoutButton variant="dashboard" />
      </section>
    </div>
  );
}
