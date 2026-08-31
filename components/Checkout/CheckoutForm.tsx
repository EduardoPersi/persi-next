"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useRouteTransition } from "@/hooks/useRouteTransition";
import { useTabAttentionTitle } from "@/hooks/useTabAttentionTitle";
import { applyAccountPrefill } from "@/lib/commerce/checkoutAccountPrefill";
import {
  canAdvanceCheckoutAddress,
  getFirstCheckoutErrorPath,
  isAddressComplete,
} from "@/lib/commerce/checkout";
import {
  hasSelectedShippingRate,
} from "@/lib/commerce/checkoutAddress";
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
import { CheckoutAddresses } from "./CheckoutAddresses";
import { CheckoutContactForm } from "./CheckoutContactForm";
import { CheckoutErrorMessage } from "./CheckoutErrorMessage";
import { CheckoutMobileOrderSummary } from "./CheckoutMobileOrderSummary";
import { CheckoutMobileStepper } from "./CheckoutMobileStepper";
import { CheckoutOrderNote } from "./CheckoutOrderNote";
import { CheckoutPayment } from "./CheckoutPayment";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutStepCard, type CheckoutStepState } from "./CheckoutStepCard";
import { CheckoutTerms } from "./CheckoutTerms";
import {
  createIdempotencyKey,
  getCartPaymentTotals,
  type CheckoutPaymentMethod,
} from "./paymentMethod";
import type { PaymentCardFieldsHandle } from "./PaymentCardFields";
import type { PublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";

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
  initialGuestEmail?: string;
  paymentMethod: CheckoutPaymentMethod;
  onPaymentMethodChange: (method: CheckoutPaymentMethod) => void;
  hasCreatedOrder: boolean;
  onOrderCreated: () => void;
  capabilities: PublicCheckoutCapabilities;
}

export function CheckoutForm({
  initialProfile,
  initialAddresses,
  initialGuestEmail,
  paymentMethod,
  onPaymentMethodChange: setPaymentMethod,
  hasCreatedOrder,
  onOrderCreated: setHasCreatedOrder,
  capabilities,
}: CheckoutFormProps) {
  const { cart, isCheckoutUpdating, refreshCart } = useCart();
  const { navigate } = useRouteTransition();
  const [statusMessage, setStatusMessage] = useState("");
  const [cardDeclinedMessage, setCardDeclinedMessage] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [installments, setInstallments] = useState(1);
  const [currentStep, setCurrentStep] = useState<CheckoutStep>("profile");
  const cardFieldsRef = useRef<PaymentCardFieldsHandle>(null);
  const checkoutAttemptIdRef = useRef(createIdempotencyKey());
  const lookupPostcodeAddress = usePostcodeAddressLookup();

  // Dados salvos no cadastro do cliente logado têm prioridade sobre
  // qualquer CEP solto lembrado da navegação anônima (ver efeito abaixo) —
  // só é calculado uma vez, a partir dos dados já resolvidos no servidor.
  const initialFormValues = useMemo(
    () =>
      applyAccountPrefill({
        ...checkoutDefaultValues,
        contact: {
          ...checkoutDefaultValues.contact,
          email: initialGuestEmail ?? checkoutDefaultValues.contact.email,
        },
      }, {
        profile: initialProfile,
        addresses: initialAddresses,
      }),
    [initialAddresses, initialGuestEmail, initialProfile],
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
  const shippingAddress = useWatch({ control: methods.control, name: "shippingAddress" });
  const activeAddress = shipToBillingAddress ? billingAddress : shippingAddress;

  // Só avisa ao sair da página depois que o cliente já preencheu algum
  // dado (endereço/contato) ou trocou a forma de pagamento padrão — e para
  // de avisar assim que o pedido é de fato criado no servidor.
  const hasUnsavedProgress = methods.formState.isDirty || paymentMethod !== "inter_pix";
  useBeforeUnloadWarning(hasUnsavedProgress && !hasCreatedOrder);
  useTabAttentionTitle(!hasCreatedOrder);

  // Troca de forma de pagamento invalida qualquer recusa de cartão mostrada
  // anteriormente — sem isto, a mensagem específica ficava presa na tela
  // mesmo depois do cliente escolher Pix ou boleto. Limpa no próprio handler
  // (não num efeito) para não disparar um render em cascata; também cobre a
  // troca automática que CheckoutPayment faz para Pix quando o método
  // selecionado deixa de ser válido.
  const handlePaymentMethodChange = (method: CheckoutPaymentMethod) => {
    setCardDeclinedMessage("");
    setPaymentMethod(method);
  };

  // Erro de tokenização (SDK do Mercado Pago rejeitando os dados antes de
  // qualquer chamada ao servidor) é, na prática, o mesmo tipo de problema
  // que uma recusa CARD_PAYMENT_DECLINED — mesmo estado, mesmo bloco de
  // exibição perto dos campos do cartão, para não duplicar local de erro.
  const handleCardError = (message: string) => {
    setCardDeclinedMessage(message);
  };

  const submitPayment = async (values: CheckoutFormValues) => {
    setStatusMessage("");
    setCardDeclinedMessage("");
    setIsSubmittingPayment(true);

    try {
      const idempotencyKey = checkoutAttemptIdRef.current;
      const expectedAmount = cart
        ? getCartPaymentTotals(paymentMethod, cart).finalTotal
        : 0;
      const document = values.contact.document;
      const customerNote = values.includeOrderNote ? values.orderNote.trim() : "";
      let body: Record<string, unknown>;

      if (paymentMethod === "inter_pix" || paymentMethod === "inter_boleto") {
        body = { method: paymentMethod, idempotencyKey, document, customerNote, expectedAmount };
      } else if (paymentMethod === "mercadopago_card") {
        const tokenization = await cardFieldsRef.current?.tokenize();
        if (!tokenization) {
          return;
        }
        body = {
          method: paymentMethod,
          idempotencyKey,
          cardToken: tokenization.token,
          installments,
          paymentMethodId: tokenization.paymentMethodId,
          issuerId: tokenization.issuerId,
          holderDocument: document,
          customerNote,
          expectedAmount,
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
        if (result?.code === "CART_CHANGED" || result?.code === "ORDER_TOTAL_MISMATCH") {
          await refreshCart();
        }
        const message =
          result?.message ?? "Não foi possível iniciar o pagamento. Tente novamente.";
        // Recusa de cartão tem exibição própria, perto dos campos do cartão
        // (PaymentCardFields) — não duplica no aviso genérico do rodapé.
        // Carteiras digitais (Apple/Google Pay) não têm campos de cartão na
        // tela, então continuam usando o aviso genérico.
        if (result?.code === "CARD_PAYMENT_DECLINED" && paymentMethod === "mercadopago_card") {
          setCardDeclinedMessage(message);
        } else {
          setStatusMessage(message);
        }
        return;
      }

      if (result.alreadyInitiated) {
        setHasCreatedOrder();
        navigate(result.confirmationUrl);
        return;
      }

      if (result.method === "inter_pix" || result.method === "inter_boleto") {
        setHasCreatedOrder();
        navigate(result.confirmationUrl);
        return;
      }

      setHasCreatedOrder();
      navigate(
        `/checkout/confirmacao?provider=mercadopago_card&reference=${encodeURIComponent(result.chargeId)}`,
      );
    } catch {
      setStatusMessage("Não foi possível iniciar o pagamento. Tente novamente.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const addressReady = Boolean(cart) && canAdvanceCheckoutAddress({
    needsShipping: cart?.needsShipping ?? true,
    addressComplete: isAddressComplete(activeAddress),
    hasSelectedShippingRate: hasSelectedShippingRate(
      cart?.shippingPackages ?? [],
    ),
    isUpdating: isCheckoutUpdating,
  });

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
        // eslint-disable-next-line react-hooks/refs -- cardFieldsRef só é lido dentro do callback de submit do react-hook-form, disparado por um evento real de submit, nunca durante a renderização.
        onSubmit={methods.handleSubmit(submitPayment, focusFirstError)}
        className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start"
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
              <div className="space-y-1 text-xs text-foreground">
                <p className="font-semibold text-foreground">
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
              <p className="text-xs text-foreground">
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
                onMethodChange={handlePaymentMethodChange}
                installments={installments}
                onInstallmentsChange={setInstallments}
                cardFieldsRef={cardFieldsRef}
                onCardError={handleCardError}
                cardDeclinedMessage={cardDeclinedMessage}
                cartTotal={cart ? moneyToNumber(cart.totals.price) : undefined}
                discountBase={
                  cart
                    ? Math.max(
                        0,
                        moneyToNumber(cart.totals.items) -
                          moneyToNumber(cart.totals.discount),
                      )
                    : undefined
                }
                currencyCode={cart?.currencyCode}
                capabilities={capabilities}
                holderDocument={contact?.document ?? ""}
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

        <CheckoutErrorMessage
          id="checkout-submit-status"
          message={statusMessage}
          alwaysRender
          className="lg:col-span-2"
        />
      </form>
    </FormProvider>
  );
}
