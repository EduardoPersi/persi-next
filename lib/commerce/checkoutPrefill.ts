import { BRAZILIAN_STATES } from "../constants/brazilianStates.ts";
import { formatBrazilianCpf, formatBrazilianPhone } from "../formatting/personalData.ts";
import { isValidBrazilianCpf } from "../validation/cpf.ts";
import { formatPostcode, isValidPostcode } from "./shippingCalculator.ts";
import type { CheckoutFormValues } from "../../types/checkout.ts";

// Pré-preenchimento do checkout por link (vendedor, WhatsApp, campanhas):
// /checkout?nome=Maria&sobrenome=Souza&whatsapp=11987654321&cep=13201000
//
// Os parâmetros são sanitizados, guardados na sessionStorage da aba (nunca em
// cookie, para o dado pessoal não viajar em toda requisição) e retirados da
// URL logo depois. Aplicados uma única vez, só em campos ainda vazios.

export const CHECKOUT_PREFILL_KEY = "checkout_prefill_v1";
export const CHECKOUT_PREFILL_TTL_MS = 24 * 60 * 60 * 1000;

export type CheckoutPrefill = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  document?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  address?: string;
  neighborhood?: string;
};

// Primeiro nome da lista que vier preenchido vence os aliases seguintes.
const PARAM_ALIASES: Record<keyof CheckoutPrefill, readonly string[]> = {
  firstName: ["nome"],
  lastName: ["sobrenome"],
  email: ["email"],
  phone: ["whatsapp", "telefone", "phone", "cel"],
  document: ["cpf"],
  postalCode: ["cep"],
  city: ["cidade"],
  state: ["estado"],
  address: ["endereco"],
  neighborhood: ["bairro"],
};

export const CHECKOUT_PREFILL_PARAM_NAMES: readonly string[] =
  Object.values(PARAM_ALIASES).flat();

const MAX_RAW_LENGTH = 200;

function clean(value: string, allowed: RegExp, maxLength: number): string {
  return value
    .normalize("NFC")
    // Tags inteiras (<b>Ana</b>) saem antes do filtro de caracteres, para não
    // sobrar o nome da tag misturado ao texto.
    .replace(/<[^>]*>/g, "")
    .replace(allowed, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const NAME_DISALLOWED = /[^\p{L}\s'.-]/gu;
const TEXT_DISALLOWED = /[^\p{L}\p{N}\s'.,/#º°ª-]/gu;

function readName(value: string): string {
  return clean(value, NAME_DISALLOWED, 60);
}

function readText(value: string, maxLength: number): string {
  return clean(value, TEXT_DISALLOWED, maxLength);
}

function readEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  if (email.length > 120) return undefined;
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)
    ? email
    : undefined;
}

// Aceita com ou sem +55/55 e com máscara; só 10 ou 11 dígitos (DDD + número).
function readPhone(value: string): string | undefined {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return undefined;
  return formatBrazilianPhone(digits);
}

function readDocument(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return isValidBrazilianCpf(digits) ? formatBrazilianCpf(digits) : undefined;
}

function readState(value: string): string | undefined {
  const state = value.trim().toUpperCase();
  return (BRAZILIAN_STATES as readonly string[]).includes(state)
    ? state
    : undefined;
}

function pick(
  params: URLSearchParams,
  field: keyof CheckoutPrefill,
): string | undefined {
  for (const name of PARAM_ALIASES[field]) {
    const value = params.get(name);
    if (value && value.trim() && value.length <= MAX_RAW_LENGTH) return value;
  }
  return undefined;
}

export function parseCheckoutPrefillParams(
  params: URLSearchParams,
): CheckoutPrefill | null {
  const prefill: CheckoutPrefill = {};

  const rawFirstName = pick(params, "firstName");
  const rawLastName = pick(params, "lastName");
  let firstName = rawFirstName ? readName(rawFirstName) : "";
  let lastName = rawLastName ? readName(rawLastName) : "";
  // Link só com "nome=Maria Souza": separa no primeiro espaço.
  if (firstName && !lastName && firstName.includes(" ")) {
    const [first, ...rest] = firstName.split(" ");
    firstName = first;
    lastName = rest.join(" ");
  }
  if (firstName) prefill.firstName = firstName;
  if (lastName) prefill.lastName = lastName;

  const email = pick(params, "email");
  const readEmailValue = email ? readEmail(email) : undefined;
  if (readEmailValue) prefill.email = readEmailValue;

  const phone = pick(params, "phone");
  const readPhoneValue = phone ? readPhone(phone) : undefined;
  if (readPhoneValue) prefill.phone = readPhoneValue;

  const document = pick(params, "document");
  const readDocumentValue = document ? readDocument(document) : undefined;
  if (readDocumentValue) prefill.document = readDocumentValue;

  const postalCode = pick(params, "postalCode");
  if (postalCode && isValidPostcode(postalCode)) {
    prefill.postalCode = formatPostcode(postalCode);
  }

  const city = pick(params, "city");
  const readCityValue = city ? readText(city, 60) : "";
  if (readCityValue) prefill.city = readCityValue;

  const state = pick(params, "state");
  const readStateValue = state ? readState(state) : undefined;
  if (readStateValue) prefill.state = readStateValue;

  const address = pick(params, "address");
  const readAddressValue = address ? readText(address, 120) : "";
  if (readAddressValue) prefill.address = readAddressValue;

  const neighborhood = pick(params, "neighborhood");
  const readNeighborhoodValue = neighborhood ? readText(neighborhood, 60) : "";
  if (readNeighborhoodValue) prefill.neighborhood = readNeighborhoodValue;

  return Object.keys(prefill).length > 0 ? prefill : null;
}

// Mesma query sem os parâmetros de pré-preenchimento (utm_*, gclid e demais
// continuam). Devolve a query com "?" ou string vazia.
export function stripCheckoutPrefillParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of CHECKOUT_PREFILL_PARAM_NAMES) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// Mesma URL completa sem os parâmetros de pré-preenchimento. Usada para que o
// analytics nunca receba nome, telefone, CPF etc. que vieram no link.
export function stripCheckoutPrefillFromHref(href: string): string {
  try {
    const url = new URL(href);
    url.search = stripCheckoutPrefillParams(url.search);
    return url.toString();
  } catch {
    return href;
  }
}

export function hasCheckoutPrefillParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return CHECKOUT_PREFILL_PARAM_NAMES.some((name) => params.has(name));
}

export function serializeCheckoutPrefill(
  prefill: CheckoutPrefill,
  now: number,
): string {
  return JSON.stringify({ v: 1, savedAt: now, prefill });
}

export function parseStoredCheckoutPrefill(
  raw: string | null | undefined,
  now: number,
): CheckoutPrefill | null {
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as {
      v?: unknown;
      savedAt?: unknown;
      prefill?: unknown;
    };
    if (envelope?.v !== 1 || typeof envelope.savedAt !== "number") return null;
    if (now - envelope.savedAt > CHECKOUT_PREFILL_TTL_MS) return null;
    if (!envelope.prefill || typeof envelope.prefill !== "object") return null;

    // Reaproveita a sanitização: o que está salvo passa pelo mesmo crivo.
    const stored = envelope.prefill as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [field, names] of Object.entries(PARAM_ALIASES)) {
      const value = stored[field];
      if (typeof value === "string") params.set(names[0], value);
    }
    return parseCheckoutPrefillParams(params);
  } catch {
    return null;
  }
}

function fillEmpty(current: string, value: string | undefined): string {
  return current ? current : (value ?? "");
}

// Preenche só o que está vazio (conta do cliente e o que ele já digitou têm
// prioridade). O e-mail não entra aqui: ele é pedido na identificação.
export function mergeCheckoutPrefill(
  current: CheckoutFormValues,
  prefill: CheckoutPrefill,
): CheckoutFormValues {
  const documentWasEmpty = !current.contact.document;
  return {
    ...current,
    contact: {
      ...current.contact,
      firstName: fillEmpty(current.contact.firstName, prefill.firstName),
      lastName: fillEmpty(current.contact.lastName, prefill.lastName),
      phone: fillEmpty(current.contact.phone, prefill.phone),
      document: fillEmpty(current.contact.document, prefill.document),
      // O CPF do link é de pessoa física.
      personType:
        documentWasEmpty && prefill.document
          ? "fisica"
          : current.contact.personType,
    },
    billingAddress: {
      ...current.billingAddress,
      postalCode: fillEmpty(current.billingAddress.postalCode, prefill.postalCode),
      addressLine1: fillEmpty(current.billingAddress.addressLine1, prefill.address),
      neighborhood: fillEmpty(
        current.billingAddress.neighborhood,
        prefill.neighborhood,
      ),
      city: fillEmpty(current.billingAddress.city, prefill.city),
      state: fillEmpty(current.billingAddress.state, prefill.state),
    },
  };
}
