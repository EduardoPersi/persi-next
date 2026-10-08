import type { CheckoutAddress, CheckoutFormValues } from "../../types/checkout.ts";
import { checkoutSchema } from "../validation/checkout.ts";

// Rascunho do formulário de checkout no localStorage (autosave) e controle
// da etapa pelo `?step=`. Lógica pura, sem acesso ao navegador, para testar
// sem DOM. A leitura/gravação em si fica em hooks/useCheckoutDraft.ts.

export const CHECKOUT_DRAFT_KEY = "checkout_form_v1";
export const CHECKOUT_DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DRAFT_VERSION = 1;
const MAX_TEXT_LENGTH = 500;

export type CheckoutStepName = "profile" | "address" | "payment";
export const CHECKOUT_STEP_ORDER: readonly CheckoutStepName[] = [
  "profile",
  "address",
  "payment",
];

// Só estes campos são persistidos. A lista é montada campo a campo (nunca
// copiando o objeto inteiro), então senha, código de acesso, forma de
// pagamento, dados de cartão, aceite de termos e o e-mail (vem da
// identificação, não do formulário) não têm como vazar para o rascunho.
// CPF/CNPJ (e o tipo PF/PJ, que depende dele) também ficam de fora: documento
// nunca é guardado no navegador.
export type CheckoutDraftValues = {
  contact: {
    firstName: string;
    lastName: string;
    company: string;
    phone: string;
  };
  billingAddress: CheckoutAddress;
  shipToBillingAddress: boolean;
  shippingAddress: CheckoutAddress;
  includeOrderNote: boolean;
  orderNote: string;
  // Só a escolha de receber (ou não) avisos pelo WhatsApp; desmarcar vale.
  whatsappOptIn: boolean;
};

function pickAddress(address: CheckoutAddress): CheckoutAddress {
  return {
    postalCode: address.postalCode,
    addressLine1: address.addressLine1,
    number: address.number,
    addressLine2: address.addressLine2,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    country: "BR",
    recipientName: address.recipientName,
  };
}

export function buildCheckoutDraft(
  values: CheckoutFormValues,
): CheckoutDraftValues {
  return {
    contact: {
      firstName: values.contact.firstName,
      lastName: values.contact.lastName,
      company: values.contact.company,
      phone: values.contact.phone,
    },
    billingAddress: pickAddress(values.billingAddress),
    shipToBillingAddress: values.shipToBillingAddress,
    shippingAddress: pickAddress(values.shippingAddress),
    includeOrderNote: values.includeOrderNote,
    orderNote: values.orderNote,
    whatsappOptIn: values.whatsappOptIn,
  };
}

function addressIsEmpty(address: CheckoutAddress): boolean {
  return (
    !address.postalCode &&
    !address.addressLine1 &&
    !address.number &&
    !address.addressLine2 &&
    !address.neighborhood &&
    !address.city &&
    !address.state &&
    !address.recipientName
  );
}

// Formulário em branco não vira rascunho (nem apaga um existente à toa).
export function isCheckoutDraftEmpty(draft: CheckoutDraftValues): boolean {
  return (
    !draft.contact.firstName &&
    !draft.contact.lastName &&
    !draft.contact.company &&
    !draft.contact.phone &&
    !draft.orderNote &&
    addressIsEmpty(draft.billingAddress) &&
    addressIsEmpty(draft.shippingAddress)
  );
}

export function serializeCheckoutDraft(
  values: CheckoutFormValues,
  now: number,
): string | null {
  const draft = buildCheckoutDraft(values);
  if (isCheckoutDraftEmpty(draft)) return null;
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: now, values: draft });
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : "";
}

function readAddress(value: unknown): CheckoutAddress {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    postalCode: readText(source.postalCode),
    addressLine1: readText(source.addressLine1),
    number: readText(source.number),
    addressLine2: readText(source.addressLine2),
    neighborhood: readText(source.neighborhood),
    city: readText(source.city),
    state: readText(source.state),
    country: "BR",
    recipientName: readText(source.recipientName),
  };
}

// Qualquer problema (JSON inválido, versão antiga, expirado, formato
// inesperado) resulta em `null`: o checkout segue normal, sem rascunho.
export function parseCheckoutDraft(
  raw: string | null | undefined,
  now: number,
): CheckoutDraftValues | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.v !== DRAFT_VERSION) return null;
  if (typeof envelope.savedAt !== "number") return null;
  if (now - envelope.savedAt > CHECKOUT_DRAFT_TTL_MS) return null;
  if (envelope.savedAt > now + 60_000) return null;
  if (!envelope.values || typeof envelope.values !== "object") return null;

  const values = envelope.values as Record<string, unknown>;
  const contact =
    values.contact && typeof values.contact === "object"
      ? (values.contact as Record<string, unknown>)
      : {};
  const draft: CheckoutDraftValues = {
    contact: {
      firstName: readText(contact.firstName),
      lastName: readText(contact.lastName),
      company: readText(contact.company),
      phone: readText(contact.phone),
    },
    billingAddress: readAddress(values.billingAddress),
    shipToBillingAddress: values.shipToBillingAddress !== false,
    shippingAddress: readAddress(values.shippingAddress),
    includeOrderNote: values.includeOrderNote === true,
    orderNote: readText(values.orderNote),
    whatsappOptIn: values.whatsappOptIn !== false,
  };
  return isCheckoutDraftEmpty(draft) ? null : draft;
}

function fillEmpty(current: string, saved: string): string {
  return current ? current : saved;
}

function mergeAddress(
  current: CheckoutAddress,
  saved: CheckoutAddress,
): CheckoutAddress {
  return {
    postalCode: fillEmpty(current.postalCode, saved.postalCode),
    addressLine1: fillEmpty(current.addressLine1, saved.addressLine1),
    number: fillEmpty(current.number, saved.number),
    addressLine2: fillEmpty(current.addressLine2, saved.addressLine2),
    neighborhood: fillEmpty(current.neighborhood, saved.neighborhood),
    city: fillEmpty(current.city, saved.city),
    state: fillEmpty(current.state, saved.state),
    country: "BR",
    recipientName: fillEmpty(current.recipientName, saved.recipientName),
  };
}

// O rascunho só preenche o que está vazio: dados da conta do cliente (e,
// futuramente, do link do vendedor) têm prioridade sobre o que foi
// digitado antes. O e-mail nunca é tocado.
export function mergeCheckoutDraft(
  current: CheckoutFormValues,
  draft: CheckoutDraftValues,
): CheckoutFormValues {
  const shippingWasEmpty = addressIsEmpty(current.shippingAddress);

  return {
    ...current,
    contact: {
      ...current.contact,
      firstName: fillEmpty(current.contact.firstName, draft.contact.firstName),
      lastName: fillEmpty(current.contact.lastName, draft.contact.lastName),
      company: fillEmpty(current.contact.company, draft.contact.company),
      phone: fillEmpty(current.contact.phone, draft.contact.phone),
    },
    billingAddress: mergeAddress(current.billingAddress, draft.billingAddress),
    shipToBillingAddress:
      shippingWasEmpty && !draft.shipToBillingAddress
        ? false
        : current.shipToBillingAddress,
    shippingAddress: mergeAddress(
      current.shippingAddress,
      draft.shippingAddress,
    ),
    includeOrderNote:
      current.includeOrderNote ||
      (!current.orderNote && draft.includeOrderNote && Boolean(draft.orderNote)),
    orderNote: fillEmpty(current.orderNote, draft.orderNote),
    // Desmarcar é uma recusa: nunca é desfeita pelo que veio de antes.
    whatsappOptIn: current.whatsappOptIn && draft.whatsappOptIn,
  };
}

export function parseCheckoutStep(
  value: string | null | undefined,
): CheckoutStepName | null {
  return value === "profile" || value === "address" || value === "payment"
    ? value
    : null;
}

export type CheckoutStepAccess = {
  profileValid: boolean;
  addressValid: boolean;
};

// Valida em silêncio (sem marcar erro na tela) o que já está preenchido.
// O aceite dos termos não conta: ele só é exigido ao finalizar.
export function getCheckoutStepAccess(
  values: CheckoutFormValues,
): CheckoutStepAccess {
  const result = checkoutSchema.safeParse({ ...values, acceptsTerms: true });
  if (result.success) return { profileValid: true, addressValid: true };

  const firstSegments = result.error.issues.map((issue) => issue.path[0]);
  return {
    profileValid: !firstSegments.includes("contact"),
    addressValid:
      !firstSegments.includes("billingAddress") &&
      !firstSegments.includes("shippingAddress"),
  };
}

type ResolveInitialStepInput = {
  requested: CheckoutStepName | null;
  isLoggedIn: boolean;
  access: CheckoutStepAccess;
  addressReady: boolean;
};

// Etapa em que o checkout abre: a pedida em `?step=` (se os dados anteriores
// já estão válidos), ou "Entrega" para cliente logado com perfil completo.
// Nunca pula etapa: sem dados válidos volta para a primeira pendente.
export function resolveInitialCheckoutStep({
  requested,
  isLoggedIn,
  access,
  addressReady,
}: ResolveInitialStepInput): CheckoutStepName {
  const wanted =
    requested ?? (isLoggedIn && access.profileValid ? "address" : "profile");

  const furthestAllowed: CheckoutStepName = !access.profileValid
    ? "profile"
    : !(access.addressValid && addressReady)
      ? "address"
      : "payment";

  const wantedIndex = CHECKOUT_STEP_ORDER.indexOf(wanted);
  const allowedIndex = CHECKOUT_STEP_ORDER.indexOf(furthestAllowed);
  return CHECKOUT_STEP_ORDER[Math.min(wantedIndex, allowedIndex)];
}
