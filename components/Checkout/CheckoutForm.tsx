"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  FormProvider,
  useForm,
  useWatch,
  type FieldErrors,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/UI/Button";
import { useBeforeUnloadWarning } from "@/hooks/useBeforeUnloadWarning";
import { useCart } from "@/hooks/useCart";
import { usePostcodeAddressLookup } from "@/hooks/usePostcodeAddressLookup";
import { useTabAttentionTitle } from "@/hooks/useTabAttentionTitle";
import { applyAccountPrefill } from "@/lib/commerce/checkoutAccountPrefill";
import { getFirstCheckoutErrorPath } from "@/lib/commerce/checkout";
import {
  formatPostcode,
  readLastShippingPostcode,
} from "@/lib/commerce/shippingCalculator";
import { moneyToNumber } from "@/lib/formatting/money";
import type {
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
} from "@/lib/customer-workspace/types";
import {
  formatBrazilianCnpj,
  formatBrazilianCpf,
} from "@/lib/formatting/personalData";
import { checkoutDefaultValues, checkoutSchema } from "@/lib/validation/checkout";
import type { CheckoutFormValues } from "@/types/checkout";
import type {
  BoletoPaymentResult as BoletoPaymentResultData,
  PixPaymentResult as PixPaymentResultData,
} from "@/types/payments";
import { CheckoutAddresses } from "./CheckoutAddresses";
import { BoletoPaymentResult } from "./BoletoPaymentResult";
import { CheckoutContactForm } from "./CheckoutContactForm";
import { CheckoutMobileOrderSummary } from "./CheckoutMobileOrderSummary";
import { CheckoutMobileStepper } from "./CheckoutMobileStepper";
import { CheckoutOrderNote } from "./CheckoutOrderNote";
import { CheckoutPayment } from "./CheckoutPayment";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutStepCard, type CheckoutStepState } from "./CheckoutStepCard";
import { CheckoutTerms } from "./CheckoutTerms";
import { createIdempotencyKey, type CheckoutPaymentMethod } from "./paymentMethod";
import { PixPaymentResult } from "./PixPaymentResult";
import type { PaymentCardFieldsHandle } from "./PaymentCardFields";

export type CheckoutStep = "profile" | "address" | "payment";

const STEP_ORDER: readonly CheckoutStep[] = ["profile", "address", "payment"];

const PROFILE_FIELDS = [
  "contact.email",
  "contact.firstName",
  "contact.lastName",
  "contact.phone",
  "contact.personType",
  "contact.document",
] as const;

interface CheckoutFormProps {
  initialProfile: CustomerWorkspaceProfile | null;
  initialAddresses: CustomerWorkspaceAddress[];
  paymentMethod: CheckoutPaymentMethod;
  onPaymentMethodChange: (method: CheckoutPaymentMethod) => void;
  hasCreatedOrder: boolean;
  onOrderCreated: () => void;
}

export function CheckoutForm({
  initialProfile,
  initialAddresses,
  paymentMethod,
  onPaymentMethodChange: setPaymentMethod,
  hasCreatedOrder,
  onOrderCreated: setHasCreatedOrder,
}: CheckoutFormProps) {
  const { cart, isCheckoutUpdating, refreshCart } = useCart();
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [installments, setInstallments] = useState(1);
  const [pixResult, setPixResult] = useState<PixPaymentResultData | null>(null);
  const [boletoResult, setBoletoResult] = useState<BoletoPaymentResultData | null>(null);
  const [currentStep, setCurrentStep] = useState<CheckoutStep>("profile");
  const cardFieldsRef = useRef<PaymentCardFieldsHandle>(null);
  const lookupPostcodeAddress = usePostcodeAddressLookup();

  // Dados salvos no cadastro do cliente logado têm prioridade sobre
  // qualquer CEP solto lembrado da navegação anônima (ver efeito abaixo) —
  // só é calculado uma vez, a partir dos dados já resolvidos no servidor.
  const initialFormValues = useMemo(
    () =>
      applyAccountPrefill(checkoutDefaultValues, {
        profile: initialProfile,
        addresses: initialAddresses,
      }),
    [initialProfile, initialAddresses],
  );

  const methods = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: initialFormValues,
    mode: "onBlur",
    shouldFocusError: false,
    shouldUnregister: false,
  });

  // Sem endereço salvo na conta (convidado, ou cliente logado que nunca
  // preencheu um endereço): sugere o último CEP usado em qualquer cálculo
  // de frete no site (mesmo armazenamento de lib/commerce/shippingCalculator,
  // já usado nas páginas de produto/carrinho) e busca o endereço
  // correspondente — o cliente não precisa digitar de novo o que já
  // informou em outro lugar da navegação.
  useEffect(() => {
    if (methods.getValues("billingAddress.addressLine1")) return;
    if (typeof window === "undefined") return;

    const remembered = readLastShippingPostcode(window.localStorage);
    if (!remembered) return;

    const formatted = formatPostcode(remembered);
    methods.setValue("billingAddress.postalCode", formatted, {
      shouldDirty: false,
      shouldValidate: false,
    });

    void lookupPostcodeAddress(formatted).then((address) => {
      if (!address) return;
      if (address.address1) {
        methods.setValue("billingAddress.addressLine1", address.address1, {
          shouldValidate: true,
        });
      }
      if (address.address2) {
        methods.setValue("billingAddress.neighborhood", address.address2, {
          shouldValidate: true,
        });
      }
      if (address.city) {
        methods.setValue("billingAddress.city", address.city, { shouldValidate: true });
      }
      if (address.state) {
        methods.setValue("billingAddress.state", address.state, {
          shouldValidate: true,
        });
      }
    });
    // Roda só uma vez, ao montar — não deve reagir a edições do cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shipToBillingAddress = useWatch({
    control: methods.control,
    name: "shipToBillingAddress",
  });
  const contact = useWatch({ control: methods.control, name: "contact" });
  const billingAddress = useWatch({ control: methods.control, name: "billingAddress" });
  const dirtyFields = methods.formState.dirtyFields;
  const addressNeedsUpdate =
    Boolean(dirtyFields.contact) ||
    Boolean(dirtyFields.billingAddress) ||
    Boolean(dirtyFields.shipToBillingAddress) ||
    (!shipToBillingAddress && Boolean(dirtyFields.shippingAddress));

  // Só avisa ao sair da página depois que o cliente já preencheu algum
  // dado (endereço/contato) ou trocou a forma de pagamento padrão — e para
  // de avisar assim que o pedido é de fato criado no servidor.
  const hasUnsavedProgress = methods.formState.isDirty || paymentMethod !== "inter_pix";
  useBeforeUnloadWarning(hasUnsavedProgress && !hasCreatedOrder);
  useTabAttentionTitle(!hasCreatedOrder);

  const submitPayment = async (values: CheckoutFormValues) => {
    setStatusMessage("");
    setIsSubmittingPayment(true);

    try {
      const idempotencyKey = createIdempotencyKey();
      const document = values.contact.document;
      const customerNote = values.includeOrderNote ? values.orderNote.trim() : "";
      let body: Record<string, unknown>;

      if (paymentMethod === "inter_pix" || paymentMethod === "inter_boleto") {
        body = { method: paymentMethod, idempotencyKey, document, customerNote };
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
          customerNote,
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

      // O pedido já foi criado a partir desses itens — o servidor troca o
      // Cart-Token por um carrinho novo e vazio; sem isso, os mesmos itens
      // continuariam aparecendo no carrinho depois da compra.
      void refreshCart();

      if (result.alreadyInitiated) {
        setHasCreatedOrder();
        router.push(`/checkout/confirmacao?orderId=${result.orderId}`);
        return;
      }

      if (result.method === "inter_pix") {
        setHasCreatedOrder();
        setPixResult(result);
        return;
      }

      if (result.method === "inter_boleto") {
        setHasCreatedOrder();
        setBoletoResult(result);
        return;
      }

      setHasCreatedOrder();
      router.push(
        `/checkout/confirmacao?provider=pagbank_card&reference=${encodeURIComponent(result.chargeId)}`,
      );
    } catch {
      setStatusMessage("Não foi possível iniciar o pagamento. Tente novamente.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const addressReady =
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

  const advanceToAddress = async () => {
    setStatusMessage("");
    const valid = await methods.trigger(PROFILE_FIELDS, { shouldFocus: true });
    if (!valid) {
      setStatusMessage("Revise os campos destacados para continuar.");
      return;
    }
    // Sugere o destinatário a partir do nome informado no perfil — o
    // cliente pode trocar livremente (ex.: presente, portaria).
    if (!methods.getValues("billingAddress.recipientName")) {
      const { firstName, lastName } = methods.getValues("contact");
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        methods.setValue("billingAddress.recipientName", fullName, {
          shouldDirty: true,
        });
      }
    }
    setCurrentStep("address");
  };

  const advanceToPayment = () => {
    if (!addressReady) {
      setStatusMessage("Calcule e selecione a entrega para continuar.");
      return;
    }
    setStatusMessage("");
    setCurrentStep("payment");
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

  const profileState: CheckoutStepState =
    currentStep === "profile" ? "active" : "done";
  const addressState: CheckoutStepState =
    currentStep === "profile" ? "upcoming" : currentStep === "address" ? "active" : "done";
  const paymentState: CheckoutStepState =
    currentStep === "payment" ? "active" : "upcoming";

  const completedSteps = STEP_ORDER.slice(0, STEP_ORDER.indexOf(currentStep));

  const documentLabel = contact?.personType === "juridica" ? "CNPJ" : "CPF";
  const formattedDocument = contact?.document
    ? contact.personType === "juridica"
      ? formatBrazilianCnpj(contact.document)
      : formatBrazilianCpf(contact.document)
    : "";

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        // eslint-disable-next-line react-hooks/refs -- cardFieldsRef só é lido dentro do callback de submit do react-hook-form, disparado por um evento real de submit, nunca durante a renderização.
        onSubmit={methods.handleSubmit(submitPayment, focusFirstError)}
        className="grid gap-5 lg:grid-cols-2 lg:items-start"
      >
        <CheckoutMobileStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepSelect={setCurrentStep}
        />
        {cart ? (
          <CheckoutMobileOrderSummary cart={cart} paymentMethod={paymentMethod} />
        ) : null}

        <div>
          <CheckoutStepCard
            step={1}
            title="Perfil"
            state={profileState}
            onEdit={() => setCurrentStep("profile")}
            doneSummary={
              <div className="space-y-1 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">
                  {contact?.firstName} {contact?.lastName}
                </p>
                <p>{contact?.email}</p>
                <p>
                  {documentLabel} {formattedDocument}
                </p>
              </div>
            }
          >
            <CheckoutContactForm />
            <Button
              type="button"
              size="lg"
              onClick={() => void advanceToAddress()}
              className="mt-5 w-full"
            >
              Avançar
            </Button>
          </CheckoutStepCard>
        </div>

        <div className="space-y-5">
          <CheckoutStepCard
            step={2}
            title="Endereço de entrega"
            state={addressState}
            upcomingText="Finalize seu perfil para avançar..."
            onEdit={() => setCurrentStep("address")}
            doneSummary={
              <p className="text-xs text-slate-700">
                {billingAddress?.addressLine1}, {billingAddress?.number} —{" "}
                {billingAddress?.neighborhood}, {billingAddress?.city}/
                {billingAddress?.state}
              </p>
            }
          >
            <CheckoutAddresses />
            <CheckoutShippingPlaceholder />
            <CheckoutOrderNote />
            <Button
              type="button"
              size="lg"
              disabled={!addressReady || isCheckoutUpdating}
              onClick={advanceToPayment}
              className="mt-5 w-full"
            >
              Avançar
            </Button>
          </CheckoutStepCard>

          <CheckoutStepCard
            step={3}
            title="Pagamento"
            state={paymentState}
            upcomingText="Finalize seu cadastro e endereço para avançar..."
          >
            <div className="space-y-5">
              <CheckoutPayment
                method={paymentMethod}
                onMethodChange={setPaymentMethod}
                installments={installments}
                onInstallmentsChange={setInstallments}
                cardFieldsRef={cardFieldsRef}
                onCardError={setStatusMessage}
                cartTotal={cart ? moneyToNumber(cart.totals.price) : undefined}
                currencyCode={cart?.currencyCode}
              />
              <CheckoutTerms />
              <Button
                type="submit"
                size="lg"
                disabled={isCheckoutUpdating || isSubmittingPayment}
                aria-describedby="checkout-submit-status"
                className="w-full"
              >
                {isSubmittingPayment ? (
                  "Processando..."
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Comprar
                  </>
                )}
              </Button>
            </div>
          </CheckoutStepCard>
        </div>

        <p
          id="checkout-submit-status"
          className="text-center text-xs text-slate-600 lg:col-span-2"
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </p>
      </form>
    </FormProvider>
  );
}
