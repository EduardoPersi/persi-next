"use client";

import { useEffect, type RefObject } from "react";
import { PaymentCardFields, type PaymentCardFieldsHandle } from "./PaymentCardFields";
import { PaymentMethodSelector } from "./PaymentMethodSelector";
import { isPaymentMethodAvailable, type CheckoutPaymentMethod } from "./paymentMethod";

interface CheckoutPaymentProps {
  method: CheckoutPaymentMethod;
  onMethodChange: (method: CheckoutPaymentMethod) => void;
  installments: number;
  onInstallmentsChange: (installments: number) => void;
  cardFieldsRef: RefObject<PaymentCardFieldsHandle | null>;
  onCardError: (message: string) => void;
  cartTotal?: number;
  currencyCode?: string;
}

const CARD_METHODS: CheckoutPaymentMethod[] = [
  "pagbank_card",
  "pagbank_apple_pay",
  "pagbank_google_pay",
];

export function CheckoutPayment({
  method,
  onMethodChange,
  installments,
  onInstallmentsChange,
  cardFieldsRef,
  onCardError,
  cartTotal,
  currencyCode,
}: CheckoutPaymentProps) {
  const showCardFields = method === "pagbank_card";
  const isWalletMethod = CARD_METHODS.includes(method) && method !== "pagbank_card";

  // Se o carrinho mudar (ex.: cupom removido, item excluído) e o método já
  // selecionado deixar de atingir o valor mínimo, troca para o Pix — a
  // única forma sem mínimo — em vez de deixar uma opção escondida marcada.
  useEffect(() => {
    if (!isPaymentMethodAvailable(method, cartTotal)) {
      onMethodChange("inter_pix");
    }
  }, [method, cartTotal, onMethodChange]);

  return (
    <div className="space-y-5">
      <p className="text-xs leading-6 text-slate-600">
        Escolha como prefere pagar. O valor final é sempre confirmado com o Banco
        Inter ou o PagBank antes da confirmação do pedido.
      </p>
      <PaymentMethodSelector
        value={method}
        onChange={onMethodChange}
        cartTotal={cartTotal}
        currencyCode={currencyCode}
      />
      {showCardFields ? (
        <PaymentCardFields
          ref={cardFieldsRef}
          installments={installments}
          onInstallmentsChange={onInstallmentsChange}
          onError={onCardError}
        />
      ) : null}
      {isWalletMethod ? (
        <p className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
          Você vai confirmar o pagamento pela carteira digital do seu dispositivo ao
          continuar.
        </p>
      ) : null}
    </div>
  );
}
