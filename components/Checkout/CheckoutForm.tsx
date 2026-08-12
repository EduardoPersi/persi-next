"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useCheckoutTransfer } from "@/hooks/useCheckoutTransfer";
import { usePostcodeAddressLookup } from "@/hooks/usePostcodeAddressLookup";
import { useTabAttentionTitle } from "@/hooks/useTabAttentionTitle";
import { applyAccountPrefill } from "@/lib/commerce/checkoutAccountPrefill";
import { getFirstCheckoutErrorPath } from "@/lib/commerce/checkout";
import {
  formatPostcode,
  readLastShippingPostcode,
} from "@/lib/commerce/shippingCalculator";
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
import { CheckoutAddresses } from "./CheckoutAddresses";
import { CheckoutContactForm } from "./CheckoutContactForm";
import { CheckoutMobileOrderSummary } from "./CheckoutMobileOrderSummary";
import { CheckoutMobileStepper } from "./CheckoutMobileStepper";
import { CheckoutOrderNote } from "./CheckoutOrderNote";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutStepCard, type CheckoutStepState } from "./CheckoutStepCard";
import { CheckoutTerms } from "./CheckoutTerms";
import type { CheckoutPaymentMethod } from "./paymentMethod";

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

const BILLING_ADDRESS_FIELDS = [
  "billingAddress.postalCode",
  "billingAddress.addressLine1",
  "billingAddress.number",
  "billingAddress.neighborhood",
  "billingAddress.city",
  "billingAddress.state",
  "billingAddress.recipientName",
] as const;

const SHIPPING_ADDRESS_FIELDS = [
  "shippingAddress.postalCode",
  "shippingAddress.addressLine1",
  "shippingAddress.number",
  "shippingAddress.neighborhood",
  "shippingAddress.city",
  "shippingAddress.state",
  "shippingAddress.recipientName",
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
  hasCreatedOrder,
  onOrderCreated: setHasCreatedOrder,
}: CheckoutFormProps) {
  const { cart, isCheckoutUpdating } = useCart();
  const { checkoutError, isPreparingCheckout, prepareCheckout } =
    useCheckoutTransfer();
  const [statusMessage, setStatusMessage] = useState("");
  const [currentStep, setCurrentStep] = useState<CheckoutStep>("profile");
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

  const goToPayment = async () => {
    setStatusMessage("");
    // Sinaliza a saída como intencional antes do redirect (suprime o aviso
    // de "sair sem salvar" do useBeforeUnloadWarning) só depois que o link
    // de transferência é confirmado — se prepareCheckout falhar, o aviso
    // continua ativo normalmente.
    await prepareCheckout(() => setHasCreatedOrder());
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

  const advanceToPayment = async () => {
    setStatusMessage("");
    // Antes só checava se o frete tinha sido calculado — dava pra avançar
    // com campos obrigatórios (ex.: Número) vazios, já que calcular o frete
    // depende só do CEP, não do endereço completo.
    const shipsToBillingAddress = methods.getValues("shipToBillingAddress");
    const fieldsToValidate = shipsToBillingAddress
      ? BILLING_ADDRESS_FIELDS
      : [...BILLING_ADDRESS_FIELDS, ...SHIPPING_ADDRESS_FIELDS];
    const valid = await methods.trigger(fieldsToValidate, { shouldFocus: true });
    if (!valid) {
      setStatusMessage("Revise os campos destacados para continuar.");
      return;
    }
    if (!addressReady) {
      setStatusMessage("Calcule e selecione a entrega para continuar.");
      return;
    }
    setStatusMessage("");
    setCurrentStep("payment");
  };

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
        onSubmit={methods.handleSubmit(goToPayment, focusFirstError)}
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
              <p className="text-sm leading-6 text-slate-600">
                Você será direcionado para o ambiente seguro de pagamento da
                Persi Materiais para finalizar sua compra com Pix, boleto ou
                cartão.
              </p>
              <CheckoutTerms />
              <Button
                type="submit"
                size="lg"
                disabled={isCheckoutUpdating || isPreparingCheckout}
                aria-describedby="checkout-submit-status"
                className="w-full"
              >
                {isPreparingCheckout ? (
                  "Preparando checkout..."
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Ir para pagamento
                  </>
                )}
              </Button>
              {checkoutError ? (
                <p role="status" className="text-center text-xs text-red-700">
                  {checkoutError}
                </p>
              ) : null}
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
