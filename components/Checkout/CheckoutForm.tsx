"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FormProvider,
  useForm,
  useWatch,
  type FieldErrors,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import { getFirstCheckoutErrorPath } from "@/lib/commerce/checkout";
import { checkoutDefaultValues, checkoutSchema } from "@/lib/validation/checkout";
import type { CheckoutFormValues } from "@/types/checkout";
import type {
  BoletoPaymentResult as BoletoPaymentResultData,
  PixPaymentResult as PixPaymentResultData,
} from "@/types/payments";
import { CheckoutAddresses } from "./CheckoutAddresses";
import { BoletoPaymentResult } from "./BoletoPaymentResult";
import { CheckoutContactForm } from "./CheckoutContactForm";
import { CheckoutPayment } from "./CheckoutPayment";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutTerms } from "./CheckoutTerms";
import { createIdempotencyKey, type CheckoutPaymentMethod } from "./paymentMethod";
import { PixPaymentResult } from "./PixPaymentResult";
import type { PaymentCardFieldsHandle } from "./PaymentCardFields";

export function CheckoutForm() {
  const { cart, isCheckoutUpdating } = useCart();
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>("inter_pix");
  const [installments, setInstallments] = useState(1);
  const [pixResult, setPixResult] = useState<PixPaymentResultData | null>(null);
  const [boletoResult, setBoletoResult] = useState<BoletoPaymentResultData | null>(null);
  const cardFieldsRef = useRef<PaymentCardFieldsHandle>(null);

  const methods = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: checkoutDefaultValues,
    mode: "onBlur",
    shouldFocusError: false,
    shouldUnregister: false,
  });
  const shipToBillingAddress = useWatch({
    control: methods.control,
    name: "shipToBillingAddress",
  });
  const dirtyFields = methods.formState.dirtyFields;
  const addressNeedsUpdate =
    Boolean(dirtyFields.contact) ||
    Boolean(dirtyFields.billingAddress) ||
    Boolean(dirtyFields.shipToBillingAddress) ||
    (!shipToBillingAddress && Boolean(dirtyFields.shippingAddress));

  const submitPayment = async (values: CheckoutFormValues) => {
    setStatusMessage("");
    setIsSubmittingPayment(true);

    try {
      const idempotencyKey = createIdempotencyKey();
      const document = values.contact.document;
      let body: Record<string, unknown>;

      if (paymentMethod === "inter_pix" || paymentMethod === "inter_boleto") {
        body = { method: paymentMethod, idempotencyKey, document };
      } else if (paymentMethod === "pagbank_card") {
        const cardToken = cardFieldsRef.current?.tokenize();
        if (!cardToken) {
          return;
        }
        body = {
          method: paymentMethod,
          idempotencyKey,
          cardToken,
          installments,
          holderDocument: document,
        };
      } else {
        setStatusMessage(
          "O pagamento por carteira digital ainda não está disponível neste checkout.",
        );
        return;
      }

      const response = await fetch("/api/checkout/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result) {
        setStatusMessage(
          result?.message ?? "Não foi possível iniciar o pagamento. Tente novamente.",
        );
        return;
      }

      if (result.alreadyInitiated) {
        router.push(`/checkout/confirmacao?orderId=${result.orderId}`);
        return;
      }

      if (result.method === "inter_pix") {
        setPixResult(result);
        return;
      }

      if (result.method === "inter_boleto") {
        setBoletoResult(result);
        return;
      }

      router.push(
        `/checkout/confirmacao?provider=pagbank_card&reference=${encodeURIComponent(result.chargeId)}`,
      );
    } catch {
      setStatusMessage("Não foi possível iniciar o pagamento. Tente novamente.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const canContinue =
    Boolean(cart) &&
    (!cart?.needsShipping ||
      (!addressNeedsUpdate &&
        cart.hasCalculatedShipping &&
        cart.shippingPackages.length > 0 &&
        cart.shippingPackages.every((shippingPackage) =>
          shippingPackage.rates.some((rate) => rate.selected),
        )));

  const focusFirstError = (errors: FieldErrors<CheckoutFormValues>) => {
    setStatusMessage("Revise os campos destacados para continuar.");
    const firstError = getFirstCheckoutErrorPath(errors);
    if (firstError) {
      methods.setFocus(firstError);
    }
  };

  if (pixResult) {
    return (
      <PixPaymentResult
        result={pixResult}
        onPaid={() =>
          router.push(
            `/checkout/confirmacao?provider=inter_pix&reference=${encodeURIComponent(pixResult.txid)}`,
          )
        }
        onExpired={() => {
          setPixResult(null);
          setStatusMessage("O Pix anterior expirou. Gere um novo código para continuar.");
        }}
      />
    );
  }

  if (boletoResult) {
    return <BoletoPaymentResult result={boletoResult} />;
  }

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        // eslint-disable-next-line react-hooks/refs -- cardFieldsRef só é lido dentro do callback de submit do react-hook-form, disparado por um evento real de submit, nunca durante a renderização.
        onSubmit={methods.handleSubmit(submitPayment, focusFirstError)}
        className="space-y-5"
      >
        <CheckoutContactForm />
        <CheckoutAddresses />
        <CheckoutShippingPlaceholder />
        <CheckoutPayment
          method={paymentMethod}
          onMethodChange={setPaymentMethod}
          installments={installments}
          onInstallmentsChange={setInstallments}
          cardFieldsRef={cardFieldsRef}
          onCardError={setStatusMessage}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <CheckoutTerms />
          <Button
            type="submit"
            size="lg"
            disabled={!canContinue || isCheckoutUpdating || isSubmittingPayment}
            aria-describedby="checkout-submit-status"
            className="mt-5 w-full"
          >
            {isSubmittingPayment ? "Processando..." : "Continuar para pagamento"}
          </Button>
          <p
            id="checkout-submit-status"
            className="mt-3 text-center text-sm text-slate-600"
            role="status"
            aria-live="polite"
          >
            {!canContinue
              ? "Calcule e selecione a entrega para continuar."
              : statusMessage}
          </p>
        </section>
      </form>
    </FormProvider>
  );
}
