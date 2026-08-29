import type {
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
} from "@/lib/customer-workspace/types";
import type { CheckoutAddress, CheckoutFormValues } from "@/types/checkout";
import { formatBrazilianCpf, formatBrazilianPhone } from "../formatting/personalData.ts";
import { formatPostcode } from "./shippingCalculator.ts";

// O cadastro da conta (WooCommerce) guarda bairro num campo próprio
// (`{tipo}_neighborhood`, meta separada — a Woo não tem esse campo nativo)
// e `address2` continua sendo só o complemento, mesma semântica do
// formulário do checkout. "Número" continua em branco para o cliente
// confirmar, exatamente como já acontece quando o endereço vem do
// preenchimento automático por CEP.
function toCheckoutAddress(
  address: CustomerWorkspaceAddress | undefined,
): CheckoutAddress | null {
  if (!address?.address1?.trim()) return null;

  return {
    postalCode: formatPostcode(address.postcode ?? ""),
    addressLine1: address.address1.trim(),
    number: "",
    addressLine2: address.address2?.trim() ?? "",
    neighborhood: address.neighborhood?.trim() ?? "",
    city: address.city?.trim() ?? "",
    state: address.state?.trim().toUpperCase() ?? "",
    country: "BR",
    recipientName: "",
  };
}

export interface CheckoutAccountPrefillInput {
  profile: CustomerWorkspaceProfile | null;
  addresses: CustomerWorkspaceAddress[];
}

// Preenche só os campos que a conta realmente tem — nunca sobrescreve com
// vazio o que já está em `base` (assim dá pra aplicar em cima dos
// `checkoutDefaultValues` sem perder nenhum default existente).
export function applyAccountPrefill(
  base: CheckoutFormValues,
  { profile, addresses }: CheckoutAccountPrefillInput,
): CheckoutFormValues {
  const result: CheckoutFormValues = {
    ...base,
    contact: { ...base.contact },
    billingAddress: { ...base.billingAddress },
    // A loja usa um único endereço (cobrança = entrega) — sempre "true",
    // não há mais como a conta ou o checkout divergirem os dois.
    shipToBillingAddress: true,
    shippingAddress: { ...base.shippingAddress },
  };

  if (profile) {
    if (profile.firstName) result.contact.firstName = profile.firstName;
    if (profile.lastName) result.contact.lastName = profile.lastName;
    if (profile.email) result.contact.email = profile.email;
    if (profile.phone) result.contact.phone = formatBrazilianPhone(profile.phone);
    // A conta ainda só guarda CPF (pessoa física) — não há como saber se o
    // cliente é pessoa jurídica a partir do cadastro hoje.
    if (profile.cpf) {
      result.contact.personType = "fisica";
      result.contact.document = formatBrazilianCpf(profile.cpf);
    }
  }

  // Só um endereço é usado (cobrança = entrega): prioriza o de cobrança
  // salvo na conta; se não houver, usa o de entrega salvo como ponto de
  // partida. Nunca preenche `shippingAddress` — ele não tem mais campo
  // próprio no checkout.
  const billing = toCheckoutAddress(
    addresses.find((address) => address.type === "billing"),
  );
  const shipping = toCheckoutAddress(
    addresses.find((address) => address.type === "shipping"),
  );
  const singleAddress = billing ?? shipping;

  if (singleAddress) {
    result.billingAddress = singleAddress;
  }

  // Destinatário padrão é o próprio titular da conta — o cliente pode
  // trocar livremente no formulário (ex.: presente, portaria).
  const fullName = [profile?.firstName, profile?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) {
    result.billingAddress.recipientName = fullName;
  }

  return result;
}
