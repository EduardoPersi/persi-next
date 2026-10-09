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
import { useCartSignal } from "@/hooks/useCartSignal";
import {
  readStoredCheckoutDraft,
  useCheckoutDraft,
} from "@/hooks/useCheckoutDraft";
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
  CHECKOUT_STEP_ORDER,
  getCheckoutStepAccess,
  mergeCheckoutDraft,
  parseCheckoutStep,
  resolveInitialCheckoutStep,
} from "@/lib/commerce/checkoutDraft";
import {
  hasSelectedShippingRate,
} from "@/lib/commerce/checkoutAddress";
import {
  formatPostcode,
  isValidPostcode,
  readLastShippingPostcode,
} from "@/lib/commerce/shippingCalculator";
import { mergeCheckoutPrefill } from "@/lib/commerce/checkoutPrefill";
import {
  isPaymentInProgress,
  pollPaymentAttempt,
  type PollCheck,
} from "@/lib/commerce/paymentPolling";
import { resumePendingPayment } from "@/lib/commerce/resumePendingPayment";
import {
  browserPendingStorage,
  clearPendingPayment,
  readPendingPayment,
  rememberPendingPayment,
  shouldKeepPendingAfterFailure,
} from "@/lib/commerce/pendingPayment";
import {
  CARD_DECLINED_RETRY_MESSAGE,
  isDefinitiveCardFailure,
  nextIdempotencyKey,
  shouldSuggestPix,
} from "@/lib/commerce/paymentRetry";
import {
  clearStoredCheckoutPrefill,
  readStoredCheckoutPrefill,
} from "@/lib/commerce/checkoutPrefillStorage";
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
import { CheckoutMobileSubmitBar } from "./CheckoutMobileSubmitBar";
import { CheckoutOrderNote } from "./CheckoutOrderNote";
import { CheckoutPayment } from "./CheckoutPayment";
import { CheckoutShippingPlaceholder } from "./CheckoutShippingPlaceholder";
import { CheckoutStepCard, type CheckoutStepState } from "./CheckoutStepCard";
import { CheckoutTerms } from "./CheckoutTerms";
import { PaymentProcessingNotice } from "./PaymentProcessingNotice";
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
  // Depois de uma recusa de cartão, o Pix aparece em destaque.
  const [suggestPix, setSuggestPix] = useState(false);
  // Pagamento "em processamento" (409): espera a confirmação do banco com a MESMA
  // chave, sem liberar outro pagamento. Ver lib/commerce/paymentPolling.ts.
  // Chave pendente guardada (recarregou durante ou depois de uma tentativa de pagamento):
  // começa já travado, consultando o estado dela antes de liberar qualquer pagamento.
  const [paymentProcessing, setPaymentProcessing] = useState<"idle" | "confirming" | "timeout">(
    () => (readPendingPayment(browserPendingStorage()) ? "confirming" : "idle"),
  );
  const isUnmountedRef = useRef(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [installments, setInstallments] = useState(1);
  const cardFieldsRef = useRef<PaymentCardFieldsHandle>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutAttemptIdRef = useRef(createIdempotencyKey());
  const lookupPostcodeAddress = usePostcodeAddressLookup();

  // Dados salvos no cadastro do cliente logado têm prioridade sobre
  // qualquer CEP solto lembrado da navegação anônima (ver efeito abaixo) —
  // só é calculado uma vez, a partir dos dados já resolvidos no servidor.
  // Precedência (cada etapa só preenche o que ainda está vazio): conta do
  // cliente > link do vendedor/campanha (?nome=…&cep=…) > rascunho salvo no
  // navegador (autosave) > último CEP lembrado.
  const initialFormValues = useMemo(() => {
    const accountValues = applyAccountPrefill({
      ...checkoutDefaultValues,
      contact: {
        ...checkoutDefaultValues.contact,
        email: initialGuestEmail ?? checkoutDefaultValues.contact.email,
      },
    }, {
      profile: initialProfile,
      addresses: initialAddresses,
    });
    const linkPrefill = readStoredCheckoutPrefill();
    const withLink = linkPrefill
      ? mergeCheckoutPrefill(accountValues, linkPrefill)
      : accountValues;
    const savedDraft = readStoredCheckoutDraft();
    return savedDraft ? mergeCheckoutDraft(withLink, savedDraft) : withLink;
  }, [initialAddresses, initialGuestEmail, initialProfile]);

  // Etapa inicial: a de `?step=` se os dados anteriores já estão válidos, ou
  // "Entrega" para cliente logado com perfil completo. O formulário só monta
  // depois do carrinho carregar no cliente, então ler a URL aqui é seguro.
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(() => {
    if (typeof window === "undefined") return "profile";
    const initialAddress = initialFormValues.shipToBillingAddress
      ? initialFormValues.billingAddress
      : initialFormValues.shippingAddress;
    return resolveInitialCheckoutStep({
      requested: parseCheckoutStep(
        new URLSearchParams(window.location.search).get("step"),
      ),
      isLoggedIn: Boolean(initialProfile),
      access: getCheckoutStepAccess(initialFormValues),
      addressReady:
        Boolean(cart) &&
        canAdvanceCheckoutAddress({
          needsShipping: cart?.needsShipping ?? true,
          addressComplete: isAddressComplete(initialAddress),
          hasSelectedShippingRate: hasSelectedShippingRate(
            cart?.shippingPackages ?? [],
          ),
          isUpdating: isCheckoutUpdating,
        }),
    });
  });

  const methods = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: initialFormValues,
    mode: "onBlur",
    shouldFocusError: false,
    shouldUnregister: false,
  });
  const { hasUnsavedDraft } = useCheckoutDraft(methods, hasCreatedOrder);
  useCartSignal({
    methods,
    step: currentStep,
    cart,
    enabled: capabilities.cartSignal && !hasCreatedOrder,
  });

  // `?step=` acompanha a etapa: abrir direto numa etapa, recarregar e usar o
  // botão voltar do navegador entre as etapas. O histórico só anda para trás
  // até a etapa mais avançada já alcançada nesta sessão.
  const furthestStepRef = useRef(CHECKOUT_STEP_ORDER.indexOf(currentStep));
  const currentStepRef = useRef(currentStep);
  const isFirstUrlSyncRef = useRef(true);

  useEffect(() => {
    currentStepRef.current = currentStep;
    furthestStepRef.current = Math.max(
      furthestStepRef.current,
      CHECKOUT_STEP_ORDER.indexOf(currentStep),
    );

    const url = new URL(window.location.href);
    if (parseCheckoutStep(url.searchParams.get("step")) !== currentStep) {
      url.searchParams.set("step", currentStep);
      const write = isFirstUrlSyncRef.current
        ? window.history.replaceState
        : window.history.pushState;
      write.call(window.history, window.history.state, "", url);
    }
    isFirstUrlSyncRef.current = false;
  }, [currentStep]);

  useEffect(() => {
    const handlePopState = () => {
      const step = parseCheckoutStep(
        new URLSearchParams(window.location.search).get("step"),
      );
      if (!step) return;
      if (CHECKOUT_STEP_ORDER.indexOf(step) <= furthestStepRef.current) {
        setCurrentStep(step);
        return;
      }
      // Avançar pelo histórico além do que já foi concluído: volta a URL
      // para a etapa que está na tela.
      const url = new URL(window.location.href);
      url.searchParams.set("step", currentStepRef.current);
      window.history.replaceState(window.history.state, "", url);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Sem endereço salvo na conta (convidado, ou cliente logado que nunca
  // preencheu um endereço): sugere o último CEP usado em qualquer cálculo
  // de frete no site (mesmo armazenamento de lib/commerce/shippingCalculator,
  // já usado nas páginas de produto/carrinho) e busca o endereço
  // correspondente — o cliente não precisa digitar de novo o que já
  // informou em outro lugar da navegação.
  useEffect(() => {
    const billing = methods.getValues("billingAddress");
    if (billing.addressLine1 && billing.city && billing.state) return;
    if (typeof window === "undefined") return;

    // CEP já no formulário (link ou rascunho) tem prioridade sobre o lembrado.
    const remembered = readLastShippingPostcode(window.localStorage);
    const formatted = formatPostcode(
      isValidPostcode(billing.postalCode) ? billing.postalCode : (remembered ?? ""),
    );
    if (!isValidPostcode(formatted)) return;

    if (billing.postalCode !== formatted) {
      methods.setValue("billingAddress.postalCode", formatted, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }

    // Completa só o que ainda está vazio: nada digitado é sobrescrito.
    const fillIfEmpty = (
      field: "addressLine1" | "neighborhood" | "city" | "state",
      value: string | undefined,
    ) => {
      if (!value || methods.getValues(`billingAddress.${field}`)) return;
      methods.setValue(`billingAddress.${field}`, value, { shouldValidate: true });
    };

    void lookupPostcodeAddress(formatted).then((address) => {
      if (!address) return;
      fillIfEmpty("addressLine1", address.address1);
      fillIfEmpty("neighborhood", address.address2);
      fillIfEmpty("city", address.city);
      fillIfEmpty("state", address.state);
    });
    // Roda só uma vez, ao montar — não deve reagir a edições do cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O link de pré-preenchimento vale uma vez só: já foi aplicado acima.
  useEffect(() => {
    clearStoredCheckoutPrefill();
  }, []);
  const shipToBillingAddress = useWatch({
    control: methods.control,
    name: "shipToBillingAddress",
  });
  const contact = useWatch({ control: methods.control, name: "contact" });
  const billingAddress = useWatch({ control: methods.control, name: "billingAddress" });
  const shippingAddress = useWatch({ control: methods.control, name: "shippingAddress" });
  const activeAddress = shipToBillingAddress ? billingAddress : shippingAddress;

  // Só avisa ao sair da página quando há alteração que o autosave ainda não
  // gravou (ou se o armazenamento do navegador falhou), ou o cliente trocou
  // a forma de pagamento padrão, que não é salva — e para de avisar assim
  // que o pedido é de fato criado no servidor.
  const hasUnsavedProgress = hasUnsavedDraft || paymentMethod !== "inter_pix";
  useBeforeUnloadWarning(hasUnsavedProgress && !hasCreatedOrder);
  // "Não feche esta página": enquanto o banco confirma, sair da página avisa.
  useBeforeUnloadWarning(paymentProcessing === "confirming" && !hasCreatedOrder);
  useTabAttentionTitle(!hasCreatedOrder);

  // Troca de forma de pagamento invalida qualquer recusa de cartão mostrada
  // anteriormente — sem isto, a mensagem específica ficava presa na tela
  // mesmo depois do cliente escolher Pix ou boleto. Limpa no próprio handler
  // (não num efeito) para não disparar um render em cascata; também cobre a
  // troca automática que CheckoutPayment faz para Pix quando o método
  // selecionado deixa de ser válido.
  const handlePaymentMethodChange = (method: CheckoutPaymentMethod) => {
    setCardDeclinedMessage("");
    setSuggestPix(false);
    setPaymentMethod(method);
  };

  // Erro de tokenização (SDK do Mercado Pago rejeitando os dados antes de
  // qualquer chamada ao servidor) é, na prática, o mesmo tipo de problema
  // que uma recusa CARD_PAYMENT_DECLINED — mesmo estado, mesmo bloco de
  // exibição perto dos campos do cartão, para não duplicar local de erro.
  const handleCardError = (message: string) => {
    setCardDeclinedMessage(message);
  };

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  // Consulta (só leitura) o estado da tentativa pela mesma chave de idempotência.
  const checkAttempt = async (key: string): Promise<PollCheck | null> => {
    const response = await fetch(
      `/api/checkout/payment/attempt?key=${encodeURIComponent(key)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as PollCheck | null;
  };

  // Pedido criado: o cliente vai para a página do pedido e a chave pendente sai.
  const markOrderCreated = () => {
    clearPendingPayment(browserPendingStorage());
    setHasCreatedOrder();
  };

  // Recarregou a página com uma chave pendente (menos de 30 min): consulta o estado
  // dela, só leitura, ANTES de liberar qualquer pagamento. Mesma espera do 409.
  const resumedPendingRef = useRef(false);
  useEffect(() => {
    if (resumedPendingRef.current) return;
    const storage = browserPendingStorage();
    if (!readPendingPayment(storage)) return;
    resumedPendingRef.current = true;
    void resumePendingPayment({
      storage,
      check: checkAttempt,
      wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      generateKey: createIdempotencyKey,
      isCancelled: () => isUnmountedRef.current,
    }).then((resumed) => {
      if (resumed.kind === "cancelled") return;
      if (resumed.kind === "created") {
        navigate(resumed.confirmationUrl);
        setHasCreatedOrder();
        return;
      }
      if (resumed.kind === "declined") {
        // Recusa definitiva: chave NOVA e o fluxo da recusa (mensagem + Pix).
        checkoutAttemptIdRef.current = resumed.newKey;
        setPaymentProcessing("idle");
        setSuggestPix(true);
        setStatusMessage(CARD_DECLINED_RETRY_MESSAGE);
        return;
      }
      if (resumed.kind === "timeout") {
        // 2 minutos sem confirmação: mensagem final, sem liberar pagamento.
        setPaymentProcessing("timeout");
        return;
      }
      // Sem nada pendente ou tentativa que nunca existiu: libera normalmente.
      setPaymentProcessing("idle");
    });
    // Só ao abrir o checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPayment = async (values: CheckoutFormValues) => {
    // Enquanto o banco confirma, nenhum novo pagamento sai (nem pelo botão fixo do celular).
    if (paymentProcessing !== "idle") return;
    setStatusMessage("");
    setCardDeclinedMessage("");
    setSuggestPix(false);
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
        body = {
          method: paymentMethod,
          idempotencyKey,
          document,
          customerNote,
          expectedAmount,
          whatsappOptIn: values.whatsappOptIn,
        };
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
          whatsappOptIn: values.whatsappOptIn,
        };
      } else {
        setStatusMessage(
          "O pagamento por carteira digital ainda não está disponível neste checkout.",
        );
        return;
      }

      // Guarda a chave em uso, a forma de pagamento e o horário (nada de cartão nem de
      // dado pessoal). Se a página recarregar antes de o resultado chegar, o checkout
      // consulta esta chave em vez de liberar outro pagamento.
      rememberPendingPayment(browserPendingStorage(), idempotencyKey, paymentMethod);
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
        const outcome = { status: response.status, code: result?.code };
        const declined = isDefinitiveCardFailure(outcome);
        // Recusa definitiva: a tentativa acabou e o servidor devolveria sempre a
        // mesma recusa para esta chave. Chave NOVA, sem recarregar a página e sem
        // mexer no formulário, para o cliente tentar outro cartão ou o Pix. Em
        // qualquer outro caso (409, 429, erro do servidor) a chave é mantida:
        // nunca existe cobrança dupla.
        checkoutAttemptIdRef.current = nextIdempotencyKey(
          idempotencyKey,
          outcome,
          createIdempotencyKey,
        );
        if (shouldSuggestPix(outcome)) setSuggestPix(true);
        // Só fica guardada quando o resultado é incerto (409, 5xx, sem resposta).
        if (!shouldKeepPendingAfterFailure(outcome)) clearPendingPayment(browserPendingStorage());

        // Em processamento (409): o resultado é incerto. NADA de chave nova nem de
        // outra forma de pagamento; só espera, consultando a mesma chave.
        if (isPaymentInProgress(outcome)) {
          setPaymentProcessing("confirming");
          const polled = await pollPaymentAttempt({
            check: () => checkAttempt(idempotencyKey),
            wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
            isCancelled: () => isUnmountedRef.current,
          });
          if (polled.kind === "cancelled") return;
          if (polled.kind === "created") {
            markOrderCreated();
            navigate(polled.confirmationUrl);
            return;
          }
          if (polled.kind === "declined") {
            clearPendingPayment(browserPendingStorage());
            setPaymentProcessing("idle");
            checkoutAttemptIdRef.current = nextIdempotencyKey(
              idempotencyKey,
              { status: 402, code: "CARD_PAYMENT_DECLINED" },
              createIdempotencyKey,
            );
            setSuggestPix(true);
            if (paymentMethod === "mercadopago_card") {
              setCardDeclinedMessage(CARD_DECLINED_RETRY_MESSAGE);
            } else {
              setStatusMessage(CARD_DECLINED_RETRY_MESSAGE);
            }
            return;
          }
          // 2 minutos sem confirmação: mensagem final, sem liberar novo pagamento.
          setPaymentProcessing("timeout");
          return;
        }
        const message = declined
          ? CARD_DECLINED_RETRY_MESSAGE
          : (result?.message ?? "Não foi possível iniciar o pagamento. Tente novamente.");
        // Recusa de cartão tem exibição própria, perto dos campos do cartão
        // (PaymentCardFields) — não duplica no aviso genérico do rodapé.
        // Carteiras digitais (Apple/Google Pay) não têm campos de cartão na
        // tela, então continuam usando o aviso genérico.
        if (declined && paymentMethod === "mercadopago_card") {
          setCardDeclinedMessage(message);
        } else {
          setStatusMessage(message);
        }
        return;
      }

      if (result.alreadyInitiated) {
        markOrderCreated();
        navigate(result.confirmationUrl);
        return;
      }

      if (result.method === "inter_pix" || result.method === "inter_boleto") {
        markOrderCreated();
        navigate(result.confirmationUrl);
        return;
      }

      markOrderCreated();
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

  // Sugere o destinatário a partir do nome informado no perfil — o cliente
  // pode trocar livremente (ex.: presente, portaria).
  const suggestRecipientName = () => {
    if (!methods.getValues("billingAddress.recipientName")) {
      const { firstName, lastName } = methods.getValues("contact");
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        methods.setValue("billingAddress.recipientName", fullName, {
          shouldDirty: true,
        });
      }
    }
  };

  // Abrir direto em Entrega/Pagamento (cliente logado ou `?step=`) pula o
  // botão "Avançar" do perfil, que é onde a sugestão acontecia.
  useEffect(() => {
    if (currentStep !== "profile") suggestRecipientName();
    // Só na montagem: não deve reagir a edições do cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advanceToAddress = async () => {
    setStatusMessage("");
    const valid = await methods.trigger(PROFILE_FIELDS, { shouldFocus: true });
    if (!valid) {
      setStatusMessage("Revise os campos destacados para continuar.");
      return;
    }
    suggestRecipientName();
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
              {paymentProcessing !== "idle" ? (
                <PaymentProcessingNotice state={paymentProcessing} />
              ) : null}
              <div
                inert={paymentProcessing !== "idle"}
                className={paymentProcessing !== "idle" ? "space-y-5 opacity-50" : "space-y-5"}
              >
              <CheckoutPayment
                method={paymentMethod}
                onMethodChange={handlePaymentMethodChange}
                installments={installments}
                onInstallmentsChange={setInstallments}
                cardFieldsRef={cardFieldsRef}
                onCardError={handleCardError}
                cardDeclinedMessage={cardDeclinedMessage}
                suggestPix={suggestPix}
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
                ref={submitButtonRef}
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
            </div>
          </CheckoutStepCard>
        </div>

        <CheckoutErrorMessage
          id="checkout-submit-status"
          message={statusMessage}
          alwaysRender
          className="lg:col-span-2"
        />
        <CheckoutMobileSubmitBar
          active={currentStep === "payment"}
          submitButtonRef={submitButtonRef}
          total={
            cart
              ? getCartPaymentTotals(paymentMethod, cart).finalTotal
              : undefined
          }
          currencyCode={cart?.currencyCode}
          isSubmitting={isSubmittingPayment}
          disabled={isCheckoutUpdating || paymentProcessing !== "idle"}
        />
      </form>
    </FormProvider>
  );
}

