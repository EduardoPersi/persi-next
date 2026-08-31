import { CreditCard, ShieldCheck, Store } from "lucide-react";
import clsx from "clsx";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";

const BENEFITS = [
  {
    icon: CreditCard,
    title: "Até 10x sem juros",
    description: "No cartão de crédito",
    headerTitle: <>Até <span className="text-secondary">10x</span> sem juros</>,
    headerDescription: "No cartão",
  },
  {
    icon: Store,
    title: "Compre no site, retire na loja",
    description: "Praticidade sem pagar frete",
    headerTitle: <>Compre e <span className="text-secondary">retire</span> na loja</>,
    headerDescription: "Mais praticidade",
  },
  {
    icon: ShieldCheck,
    title: "Compra segura",
    description: "Protegemos seus dados",
    headerTitle: <>Compra <span className="text-secondary">segura</span></>,
    headerDescription: "Seus dados protegidos",
  },
  {
    icon: WhatsAppIcon,
    title: "Fale com a gente",
    description: "Atendimento pelo WhatsApp",
    headerTitle: <>Atendimento <span className="text-secondary">especializado</span></>,
    headerDescription: "Fale com a gente",
  },
] as const;

interface HomeBenefitsProps {
  variant?: "default" | "header";
}

export function HomeBenefits({ variant = "default" }: HomeBenefitsProps) {
  const isHeader = variant === "header";

  return (
    <section aria-labelledby={`home-benefits-title-${variant}`} className="bg-transparent">
      <h2 id={`home-benefits-title-${variant}`} className="sr-only">
        Vantagens de comprar na Persi
      </h2>

      <div
        className={clsx(
          isHeader
            ? "grid grid-cols-4 divide-x divide-white/20 overflow-hidden rounded-lg border border-white/20 bg-primary-hover py-2.5"
            : "flex snap-x snap-mandatory gap-3 overflow-x-auto sm:grid sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-slate-200 sm:overflow-visible",
        )}
      >
        {BENEFITS.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <div
              key={benefit.title}
              className={clsx(!isHeader && "min-w-[62%] snap-start sm:min-w-0")}
            >
              <div
                className={clsx(
                  "flex h-full items-start",
                  isHeader
                    ? "gap-1 px-1"
                    : "gap-3 px-2 sm:justify-center sm:px-4",
                )}
              >
                <Icon
                  className={clsx(
                    "mt-0.5 shrink-0 text-secondary",
                    isHeader ? "h-[18px] w-[18px]" : "h-6 w-6",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p
                    className={clsx(
                      "font-bold",
                      isHeader ? "text-[9px] leading-[10px] text-white" : "text-sm text-primary",
                    )}
                  >
                    {isHeader ? benefit.headerTitle : benefit.title}
                  </p>
                  <p
                    className={clsx(
                      "mt-0.5",
                      isHeader ? "text-[8px] leading-[9px] text-white/70" : "text-xs leading-4 text-muted",
                    )}
                  >
                    {isHeader ? benefit.headerDescription : benefit.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
