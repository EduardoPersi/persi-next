"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Barcode, CreditCard } from "lucide-react";
import { PixIcon } from "@/components/Product/PixIcon";
import {
  getPaymentMethodDiscountRate,
  isPaymentMethodAvailable,
  type CheckoutPaymentMethod,
} from "./paymentMethod";

interface PaymentMethodOption {
  value: CheckoutPaymentMethod;
  label: string;
  description: string;
  icon?: ReactNode;
  discountLabel?: string;
}

interface WalletAvailability {
  applePay: boolean;
  googlePay: boolean;
}

declare global {
  interface Window {
    ApplePaySession?: { canMakePayments: () => boolean };
    google?: { payments?: { api?: unknown } };
  }
}

function detectWalletAvailability(): WalletAvailability {
  if (typeof window === "undefined") return { applePay: false, googlePay: false };
  return {
    applePay: Boolean(window.ApplePaySession?.canMakePayments?.()),
    googlePay: Boolean(window.google?.payments?.api),
  };
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        selected ? "border-primary" : "border-slate-300",
      )}
    >
      {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
    </span>
  );
}

interface PaymentMethodSelectorProps {
  value: CheckoutPaymentMethod;
  onChange: (method: CheckoutPaymentMethod) => void;
  cartTotal?: number;
  currencyCode?: string;
}

export function PaymentMethodSelector({
  value,
  onChange,
  cartTotal,
  currencyCode = "BRL",
}: PaymentMethodSelectorProps) {
  const [wallets, setWallets] = useState<WalletAvailability>({
    applePay: false,
    googlePay: false,
  });

  useEffect(() => {
    // Detecção de carteira digital depende de `window` e só pode rodar após
    // a montagem no client; setState aqui (em vez de um inicializador de
    // useState) evita divergência entre a marcação renderizada no servidor
    // e a primeira renderização no client durante a hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWallets(detectWalletAvailability());
  }, []);

  const formatDiscount = (method: CheckoutPaymentMethod) => {
    const rate = getPaymentMethodDiscountRate(method);
    if (rate <= 0 || typeof cartTotal !== "number" || cartTotal <= 0) {
      return undefined;
    }
    return `${new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode,
    }).format(cartTotal * rate)} off`;
  };
  const pixDiscountLabel = formatDiscount("inter_pix");
  const boletoDiscountLabel = formatDiscount("inter_boleto");

  const allOptions: PaymentMethodOption[] = [
    {
      value: "inter_pix",
      label: "Pix",
      description: "Aprovação imediata",
      icon: <PixIcon className="h-5 w-5" />,
      discountLabel: pixDiscountLabel,
    },
    {
      value: "inter_boleto",
      label: "Boleto",
      description: "Compensação em até 2 dias úteis",
      icon: <Barcode className="h-5 w-5" />,
      discountLabel: boletoDiscountLabel,
    },
    {
      value: "pagbank_card",
      label: "Cartão de crédito",
      description: "Em até 12x",
      icon: <CreditCard className="h-5 w-5" />,
    },
    ...(wallets.applePay
      ? [
          {
            value: "pagbank_apple_pay" as const,
            label: "Apple Pay",
            description: "Pagamento com um toque",
          },
        ]
      : []),
    ...(wallets.googlePay
      ? [
          {
            value: "pagbank_google_pay" as const,
            label: "Google Pay",
            description: "Pagamento com um toque",
          },
        ]
      : []),
  ];

  // Novo gateway com valor mínimo próprio: basta declarar o mínimo em
  // MIN_AMOUNT_BY_METHOD (./paymentMethod.ts) — o filtro abaixo já esconde
  // a opção sozinho quando o carrinho não atinge o valor.
  const options = allOptions.filter((option) =>
    isPaymentMethodAvailable(option.value, cartTotal),
  );

  return (
    <div
      role="radiogroup"
      aria-label="Forma de pagamento"
      className="flex flex-col gap-3"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={clsx(
              "flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary/5"
                : "border-slate-200 bg-white hover:border-primary/50",
            )}
          >
            <RadioDot selected={selected} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-sm font-semibold text-slate-900">
                  {option.label}
                </span>
                {option.discountLabel ? (
                  <span className="text-xs font-semibold text-emerald-700">
                    {option.discountLabel}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-slate-600">
                {option.description}
              </span>
            </span>
            {option.icon ? (
              <span className="shrink-0 text-slate-500" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
