import { CreditCard, ShieldCheck, Truck } from "lucide-react";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";

const BENEFITS = [
  {
    icon: CreditCard,
    title: "Até 10x sem juros",
    description: "No cartão de crédito",
  },
  {
    icon: Truck,
    title: "Frete grátis",
    description: "Para Jundiaí e região. Consulte as regras",
  },
  {
    icon: ShieldCheck,
    title: "Compra segura",
    description: "Protegemos seus dados",
  },
  {
    icon: WhatsAppIcon,
    title: "Fale com a gente",
    description: "Atendimento pelo WhatsApp",
  },
] as const;

export function HomeBenefits() {
  return (
    <section aria-labelledby="home-benefits-title" className="bg-white">
      <h2 id="home-benefits-title" className="sr-only">
        Vantagens de comprar na Persi
      </h2>
      <ul className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-slate-200">
        {BENEFITS.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <li
              key={benefit.title}
              className="flex items-start gap-3 px-2 sm:justify-center sm:px-4"
            >
              <Icon
                className="mt-0.5 h-6 w-6 shrink-0 text-[#ff6a00]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0c2d72]">
                  {benefit.title}
                </p>
                <p className="mt-0.5 text-xs leading-4 text-slate-500">
                  {benefit.description}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
