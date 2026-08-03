import type {
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
} from "@/lib/customer-workspace/types";
import type { CheckoutAddress, CheckoutFormValues } from "@/types/checkout";
import { formatBrazilianCpf, formatBrazilianPhone } from "../formatting/personalData.ts";
import { formatPostcode } from "./shippingCalculator.ts";

// O cadastro da conta (WooCommerce) guarda o endereço em só dois campos de
// texto — `address1` (rua) e `address2` (bairro + complemento, já
// combinados por mapCheckoutFormToWooAddress) — sem separar número nem
// bairro/complemento como o formulário do checkout faz. Não existe forma
// confiável de "desfazer" essa combinação sem arriscar interpretar errado
// um endereço real, então o valor inteiro de `address1` vai para
// `addressLine1` e o de `address2` vai para `neighborhood` (é o campo que
// a validação de endereço completo exige) — "Número" e "Complemento"
// continuam em branco para o cliente confirmar, exatamente como já
// acontece quando o endereço vem do preenchimento automático por CEP.
function toCheckoutAddress(
  address: CustomerWorkspaceAddress | undefined,
): CheckoutAddress | null {
  if (!address?.address1?.trim()) return null;

  return {
    postalCode: formatPostcode(address.postcode ?? ""),
    addressLine1: address.address1.trim(),
    number: "",
    addressLine2: "",
    neighborhood: address.address2?.trim() ?? "",
    city: address.city?.trim() ?? "",
    state: address.state?.trim().toUpperCase() ?? "",
    country: "BR",
  };
}

function isSameAddress(a: CheckoutAddress, b: CheckoutAddress): boolean {
  return (
    a.postalCode.replace(/\D/g, "") === b.postalCode.replace(/\D/g, "") &&
    a.addressLine1.trim().toLowerCase() === b.addressLine1.trim().toLowerCase()
  );
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

  const billing = toCheckoutAddress(
    addresses.find((address) => address.type === "billing"),
  );
  const shipping = toCheckoutAddress(
    addresses.find((address) => address.type === "shipping"),
  );

  if (billing) {
    result.billingAddress = billing;
    result.shipToBillingAddress = !shipping || isSameAddress(billing, shipping);
    if (shipping && !result.shipToBillingAddress) {
      result.shippingAddress = shipping;
    }
  } else if (shipping) {
    // Sem endereço de cobrança salvo, mas com endereço de entrega: usa o
    // de entrega como ponto de partida dos dois (cliente confirma/edita).
    result.billingAddress = shipping;
    result.shipToBillingAddress = true;
  }

  return result;
}
