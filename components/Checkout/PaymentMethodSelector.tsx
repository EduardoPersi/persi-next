"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { CheckoutPaymentMethod } from "./paymentMethod";

interface PaymentMethodOption {
  value: CheckoutPaymentMethod;
  label: string;
  description: string;
}

const BASE_OPTIONS: PaymentMethodOption[] = [
  { value: "inter_pix", label: "Pix", description: "Aprovação imediata" },
  {
    value: "inter_boleto",
    label: "Boleto",
    description: "Compensação em até 2 dias úteis",
  },
  {
    value: "pagbank_card",
    label: "Cartão de crédito",
    description: "Em até 12x",
  },
];

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

interface PaymentMethodSelectorProps {
  value: CheckoutPaymentMethod;
  onChange: (method: CheckoutPaymentMethod) => void;
}

export function PaymentMethodSelector({ value, onChange }: PaymentMethodSelectorProps) {
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

  const options: PaymentMethodOption[] = [
    ...BASE_OPTIONS,
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

  return (
    <div
      role="radiogroup"
      aria-label="Forma de pagamento"
      className="grid gap-3 sm:grid-cols-2"
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
              "min-h-11 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary/5"
                : "border-slate-300 bg-white hover:border-primary/50",
            )}
          >
            <span className="block text-xs font-semibold text-slate-900">
              {option.label}
            </span>
            <span className="mt-0.5 block text-xs text-slate-600">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
