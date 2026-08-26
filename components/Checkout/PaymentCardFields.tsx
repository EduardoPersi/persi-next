"use client";

import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ChangeEvent,
} from "react";
import Script from "next/script";
import { CheckoutErrorMessage } from "./CheckoutErrorMessage";

declare global {
  interface Window {
    PagSeguro?: {
      encryptCard: (input: {
        publicKey: string;
        holder: string;
        number: string;
        expMonth: string;
        expYear: string;
        securityCode: string;
      }) => { hasErrors: boolean; encryptedCard: string; errors?: { message: string }[] };
    };
  }
}

export interface PaymentCardFieldsHandle {
  tokenize: () => string;
}

export interface CardFieldsValue {
  holder: string;
  number: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
}

const EMPTY_CARD: CardFieldsValue = {
  holder: "",
  number: "",
  expMonth: "",
  expYear: "",
  securityCode: "",
};

interface PaymentCardFieldsProps {
  installments: number;
  onInstallmentsChange: (installments: number) => void;
  onError: (message: string) => void;
  declinedMessage?: string;
}

// Componente isolado de propósito: é o único lugar do checkout que toca em
// número de cartão, validade e CVV. Esses dados nunca saem daqui para o
// resto do app — só o token gerado por `window.PagSeguro.encryptCard`
// (`tokenize()`) é exposto ao componente pai via ref.
export const PaymentCardFields = forwardRef<PaymentCardFieldsHandle, PaymentCardFieldsProps>(
  function PaymentCardFields({ installments, onInstallmentsChange, onError, declinedMessage }, ref) {
    const [card, setCard] = useState<CardFieldsValue>(EMPTY_CARD);

    useImperativeHandle(ref, () => ({
      tokenize: () => {
        const publicKey = process.env.NEXT_PUBLIC_PAGBANK_PUBLIC_KEY;
        if (!publicKey || !window.PagSeguro) {
          onError("Não foi possível carregar o pagamento por cartão. Tente novamente.");
          return "";
        }

        const result = window.PagSeguro.encryptCard({
          publicKey,
          holder: card.holder,
          number: card.number.replace(/\D/g, ""),
          expMonth: card.expMonth,
          expYear: card.expYear,
          securityCode: card.securityCode,
        });

        if (result.hasErrors || !result.encryptedCard) {
          onError(
            result.errors?.[0]?.message ??
              "Confira os dados do cartão e tente novamente.",
          );
          return "";
        }

        return result.encryptedCard;
      },
    }));

    const handleChange =
      (field: keyof CardFieldsValue) => (event: ChangeEvent<HTMLInputElement>) => {
        setCard((current) => ({ ...current, [field]: event.target.value }));
      };

    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Script
          src="https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js"
          strategy="lazyOnload"
        />
        <div className="sm:col-span-2">
          <label htmlFor="card-holder" className="mb-1.5 block text-xs font-medium text-black">
            Nome impresso no cartão
          </label>
          <input
            id="card-holder"
            autoComplete="cc-name"
            value={card.holder}
            onChange={handleChange("holder")}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="card-number" className="mb-1.5 block text-xs font-medium text-black">
            Número do cartão
          </label>
          <input
            id="card-number"
            inputMode="numeric"
            autoComplete="cc-number"
            maxLength={19}
            value={card.number}
            onChange={handleChange("number")}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          />
        </div>
        <div>
          <label htmlFor="card-exp-month" className="mb-1.5 block text-xs font-medium text-black">
            Mês de validade
          </label>
          <input
            id="card-exp-month"
            inputMode="numeric"
            autoComplete="cc-exp-month"
            maxLength={2}
            placeholder="MM"
            value={card.expMonth}
            onChange={handleChange("expMonth")}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          />
        </div>
        <div>
          <label htmlFor="card-exp-year" className="mb-1.5 block text-xs font-medium text-black">
            Ano de validade
          </label>
          <input
            id="card-exp-year"
            inputMode="numeric"
            autoComplete="cc-exp-year"
            maxLength={4}
            placeholder="AAAA"
            value={card.expYear}
            onChange={handleChange("expYear")}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          />
        </div>
        <div>
          <label htmlFor="card-cvv" className="mb-1.5 block text-xs font-medium text-black">
            CVV
          </label>
          <input
            id="card-cvv"
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            value={card.securityCode}
            onChange={handleChange("securityCode")}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          />
        </div>
        <div>
          <label htmlFor="card-installments" className="mb-1.5 block text-xs font-medium text-black">
            Parcelas
          </label>
          <select
            id="card-installments"
            value={installments}
            onChange={(event) => onInstallmentsChange(Number(event.target.value))}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}x
              </option>
            ))}
          </select>
        </div>
        {declinedMessage ? (
          <div className="sm:col-span-2">
            <CheckoutErrorMessage message={declinedMessage} live="assertive" />
          </div>
        ) : null}
      </div>
    );
  },
);
