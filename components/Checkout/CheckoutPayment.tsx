"use client";

import { useEffect, type RefObject } from "react";
import { Button } from "@/components/UI/Button";
import { PaymentCardFields, type PaymentCardFieldsHandle } from "./PaymentCardFields";
import { PaymentMethodSelector } from "./PaymentMethodSelector";
import { isPaymentMethodAvailable, type CheckoutPaymentMethod } from "./paymentMethod";
import type { PublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";

interface CheckoutPaymentProps {
  method: CheckoutPaymentMethod;
  onMethodChange: (method: CheckoutPaymentMethod) => void;
  installments: number;
  onInstallmentsChange: (installments: number) => void;
  cardFieldsRef: RefObject<PaymentCardFieldsHandle | null>;
  onCardError: (message: string) => void;
  cardDeclinedMessage?: string;
  // Depois de uma recusa de cartão: destaca "Pagar com Pix".
  suggestPix?: boolean;
  cartTotal?: number;
  discountBase?: number;
  currencyCode?: string;
  capabilities: PublicCheckoutCapabilities;
  holderDocument: string;
}

const CARD_METHODS: CheckoutPaymentMethod[] = [
  "mercadopago_card",
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
  cardDeclinedMessage,
  suggestPix = false,
  cartTotal,
  discountBase,
  currencyCode,
  capabilities,
  holderDocument,
}: CheckoutPaymentProps) {
  const showCardFields = method === "mercadopago_card";
  const isWalletMethod = CARD_METHODS.includes(method) && method !== "mercadopago_card";

  // Se o carrinho mudar (ex.: cupom removido, item excluído) e o método já
  // selecionado deixar de atingir o valor mínimo, troca para o Pix — a
  // única forma sem mínimo — em vez de deixar uma opção escondida marcada.
  useEffect(() => {
    if (!isPaymentMethodAvailable(method, cartTotal, discountBase)) {
      onMethodChange("inter_pix");
    }
  }, [method, cartTotal, discountBase, onMethodChange]);

  return (
    <div className="space-y-5">
      <p className="text-xs leading-6 text-muted">
        Escolha como prefere pagar. O valor final é sempre confirmado com o Banco
        Inter, o Mercado Pago ou o PagBank antes da confirmação do pedido.
      </p>
      <PaymentMethodSelector
        value={method}
        onChange={onMethodChange}
        cartTotal={cartTotal}
        discountBase={discountBase}
        currencyCode={currencyCode}
        capabilities={capabilities}
      />
      {showCardFields ? (
        <PaymentCardFields
          ref={cardFieldsRef}
          installments={installments}
          onInstallmentsChange={onInstallmentsChange}
          onError={onCardError}
          declinedMessage={cardDeclinedMessage}
          holderDocument={holderDocument}
        />
      ) : null}
      {isWalletMethod ? (
        <p className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-muted">
          Você vai confirmar o pagamento pela carteira digital do seu dispositivo ao
          continuar.
        </p>
      ) : null}
      {suggestPix && capabilities.pix && method !== "inter_pix" ? (
        <div className="rounded-xl border border-secondary/40 bg-secondary/5 p-4">
          <p className="text-sm font-semibold text-foreground">Prefere pagar com Pix?</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Troque a forma de pagamento sem perder nenhum dado do seu pedido.
          </p>
          <Button
            type="button"
            variant="primary"
            className="mt-3 w-full sm:w-auto"
            onClick={() => onMethodChange("inter_pix")}
          >
            Pagar com Pix
          </Button>
        </div>
      ) : null}
    </div>
  );
}
