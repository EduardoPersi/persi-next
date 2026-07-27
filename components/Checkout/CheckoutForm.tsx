"use client";

import { useState } from "react";
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
import { CheckoutAddresses } from "./CheckoutAddresses";
import { CheckoutContactForm } from "./CheckoutContactForm";
import { CheckoutPaymentPlaceholder } from "./CheckoutPaymentPlaceholder";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutTerms } from "./CheckoutTerms";

export function CheckoutForm() {
  const { cart, isCheckoutUpdating } = useCart();
  const [statusMessage, setStatusMessage] = useState("");
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

  const submitLocally = () => {
    setStatusMessage(
      "A integração de pagamento ainda está em homologação.",
    );
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

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        onSubmit={methods.handleSubmit(submitLocally, focusFirstError)}
        className="space-y-5"
      >
        <CheckoutContactForm />
        <CheckoutAddresses />
        <CheckoutShippingPlaceholder />
        <CheckoutPaymentPlaceholder />

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <CheckoutTerms />
          <Button
            type="submit"
            size="lg"
            disabled={!canContinue || isCheckoutUpdating}
            aria-describedby="checkout-submit-status"
            className="mt-5 w-full"
          >
            Continuar para pagamento
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
