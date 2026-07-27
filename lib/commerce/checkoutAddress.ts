import type {
  CheckoutAddress,
  CheckoutCustomerPayload,
  CheckoutFormValues,
  CheckoutStoreAddress,
} from "@/types/checkout";

function normalizePostcode(value: string): string {
  return value.replace(/\D/g, "");
}

function joinAddressLine1(address: CheckoutAddress): string {
  return [address.addressLine1.trim(), address.number.trim()]
    .filter(Boolean)
    .join(", ");
}

function joinAddressLine2(address: CheckoutAddress): string | undefined {
  const value = [address.neighborhood.trim(), address.addressLine2.trim()]
    .filter(Boolean)
    .join(" - ");
  return value || undefined;
}

function mapAddress(
  address: CheckoutAddress,
  form: CheckoutFormValues,
  includeContact: boolean,
): CheckoutStoreAddress {
  return {
    firstName: form.contact.firstName.trim(),
    lastName: form.contact.lastName.trim(),
    company: form.contact.company.trim() || undefined,
    address1: joinAddressLine1(address),
    address2: joinAddressLine2(address),
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
    postcode: normalizePostcode(address.postalCode),
    country: "BR",
    ...(includeContact
      ? {
          email: form.contact.email.trim(),
          phone: form.contact.phone.replace(/\D/g, ""),
        }
      : {}),
  };
}

/**
 * Estratégia provisória isolada, validada contra a Store API ativa:
 * número integra address_1 e bairro antecede o complemento em address_2.
 * Substituir somente aqui quando as meta keys brasileiras forem auditadas.
 */
export function mapCheckoutFormToWooAddress(
  form: CheckoutFormValues,
): CheckoutCustomerPayload {
  const shippingSource = form.shipToBillingAddress
    ? form.billingAddress
    : form.shippingAddress;

  return {
    billingAddress: mapAddress(form.billingAddress, form, true),
    shippingAddress: mapAddress(shippingSource, form, false),
  };
}
