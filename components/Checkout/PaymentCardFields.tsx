"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Script from "next/script";
import { detectBrazilianDocumentType } from "@/lib/validation/document";
import { CheckoutErrorMessage } from "./CheckoutErrorMessage";

interface MercadoPagoCardTokenResult {
  id: string;
}

interface MercadoPagoPaymentMethodResult {
  id: string;
}

interface MercadoPagoIssuerResult {
  id: string;
}

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string },
    ) => {
      createCardToken: (input: {
        cardNumber: string;
        cardholderName: string;
        cardExpirationMonth: string;
        cardExpirationYear: string;
        securityCode: string;
        identificationType?: string;
        identificationNumber?: string;
      }) => Promise<MercadoPagoCardTokenResult>;
      getPaymentMethods: (input: { bin: string }) => Promise<{ results: MercadoPagoPaymentMethodResult[] }>;
      getIssuers: (input: { paymentMethodId: string; bin: string }) => Promise<MercadoPagoIssuerResult[]>;
    };
  }
}

export interface CardTokenizationResult {
  token: string;
  paymentMethodId: string;
  issuerId?: string;
}

export interface PaymentCardFieldsHandle {
  tokenize: () => Promise<CardTokenizationResult | null>;
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
  holderDocument: string;
}

// Componente isolado de propósito: é o único lugar do checkout que toca em
// número de cartão, validade e CVV. Esses dados nunca saem daqui para o
// resto do app — só o token gerado por `mp.createCardToken` (`tokenize()`)
// é exposto ao componente pai via ref, junto do payment_method_id/issuer_id
// que a API de pagamentos do Mercado Pago exige.
export const PaymentCardFields = forwardRef<PaymentCardFieldsHandle, PaymentCardFieldsProps>(
  function PaymentCardFields(
    { installments, onInstallmentsChange, onError, declinedMessage, holderDocument },
    ref,
  ) {
    const [card, setCard] = useState<CardFieldsValue>(EMPTY_CARD);
    const mpRef = useRef<InstanceType<NonNullable<Window["MercadoPago"]>> | null>(null);

    useEffect(() => {
      if (mpRef.current || typeof window === "undefined" || !window.MercadoPago) return;
      const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;
      if (!publicKey) return;
      mpRef.current = new window.MercadoPago(publicKey, { locale: "pt-BR" });
    });

    useImperativeHandle(ref, () => ({
      tokenize: async () => {
        const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;
        if (!publicKey || typeof window === "undefined" || !window.MercadoPago) {
          onError("Não foi possível carregar o pagamento por cartão. Tente novamente.");
          return null;
        }
        if (!mpRef.current) {
          mpRef.current = new window.MercadoPago(publicKey, { locale: "pt-BR" });
        }
        const mp = mpRef.current;
        const cardNumber = card.number.replace(/\D/g, "");
        const bin = cardNumber.slice(0, 6);
        const documentType = detectBrazilianDocumentType(holderDocument);

        try {
          const [{ results: paymentMethods }, tokenResult] = await Promise.all([
            mp.getPaymentMethods({ bin }),
            mp.createCardToken({
              cardNumber,
              cardholderName: card.holder,
              cardExpirationMonth: card.expMonth,
              cardExpirationYear: card.expYear,
              securityCode: card.securityCode,
              identificationType: documentType ? documentType.toUpperCase() : undefined,
              identificationNumber: holderDocument.replace(/\D/g, ""),
            }),
          ]);

          const paymentMethodId = paymentMethods[0]?.id;
          if (!paymentMethodId || !tokenResult.id) {
            onError("Confira os dados do cartão e tente novamente.");
            return null;
          }

          let issuerId: string | undefined;
          try {
            const issuers = await mp.getIssuers({ paymentMethodId, bin });
            issuerId = issuers[0]?.id;
          } catch {
            // Emissor é opcional para a maioria das bandeiras — segue sem ele
            // se a consulta falhar, em vez de bloquear o pagamento por isso.
          }

          return { token: tokenResult.id, paymentMethodId, issuerId };
        } catch {
          onError("Confira os dados do cartão e tente novamente.");
          return null;
        }
      },
    }));

    const handleChange =
      (field: keyof CardFieldsValue) => (event: ChangeEvent<HTMLInputElement>) => {
        setCard((current) => ({ ...current, [field]: event.target.value }));
      };

    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Script src="https://sdk.mercadopago.com/js/v2" strategy="lazyOnload" />
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
