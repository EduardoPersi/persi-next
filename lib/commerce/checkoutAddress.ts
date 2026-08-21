import type {
  CheckoutAddress,
  CheckoutCustomerPayload,
  CheckoutFormValues,
  CheckoutStoreAddress,
} from "@/types/checkout";
import type { CartAddress, CheckoutShippingPackage } from "@/types/cart";

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

// O "Destinatário" do endereço pode ser diferente de quem está comprando
// (ex.: presente, portaria) — por isso o nome de entrega vem do campo
// `recipientName`, não do contato/titular da compra usado na cobrança.
function splitRecipientName(recipientName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = recipientName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function mapAddress(
  address: CheckoutAddress,
  form: CheckoutFormValues,
  includeContact: boolean,
  useRecipientName: boolean,
): CheckoutStoreAddress {
  const { firstName, lastName } = useRecipientName
    ? splitRecipientName(address.recipientName)
    : { firstName: form.contact.firstName.trim(), lastName: form.contact.lastName.trim() };

  return {
    firstName,
    lastName,
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
    billingAddress: mapAddress(form.billingAddress, form, true, false),
    shippingAddress: mapAddress(shippingSource, form, false, true),
  };
}

function normalizedAddressValue(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function addressesMatch(
  expected: CheckoutStoreAddress,
  current: CartAddress | undefined,
): boolean {
  if (!current) return false;
  return (
    normalizedAddressValue(expected.firstName) === normalizedAddressValue(current.firstName) &&
    normalizedAddressValue(expected.lastName) === normalizedAddressValue(current.lastName) &&
    normalizedAddressValue(expected.company) === normalizedAddressValue(current.company) &&
    normalizedAddressValue(expected.address1) === normalizedAddressValue(current.address1) &&
    normalizedAddressValue(expected.address2) === normalizedAddressValue(current.address2) &&
    normalizedAddressValue(expected.city) === normalizedAddressValue(current.city) &&
    normalizedAddressValue(expected.state) === normalizedAddressValue(current.state) &&
    expected.postcode.replace(/\D/g, "") === (current.postcode ?? "").replace(/\D/g, "") &&
    normalizedAddressValue(expected.country) === normalizedAddressValue(current.country) &&
    normalizedAddressValue(expected.email) === normalizedAddressValue(current.email) &&
    (expected.phone ?? "").replace(/\D/g, "") === (current.phone ?? "").replace(/\D/g, "")
  );
}

export function isCheckoutCustomerSynced(
  form: CheckoutFormValues,
  billingAddress: CartAddress | undefined,
  shippingAddress: CartAddress | undefined,
): boolean {
  const expected = mapCheckoutFormToWooAddress(form);
  return (
    addressesMatch(expected.billingAddress, billingAddress) &&
    addressesMatch(expected.shippingAddress, shippingAddress)
  );
}

export function hasSelectedShippingRate(
  packages: CheckoutShippingPackage[],
): boolean {
  return (
    packages.length > 0 &&
    packages.every((shippingPackage) =>
      shippingPackage.rates.some((rate) => rate.selected),
    )
  );
}
