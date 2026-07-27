import type { Cart } from "@/types/cart";
import type {
  CheckoutAddress,
  CheckoutViewState,
} from "@/types/checkout";

interface ResolveCheckoutViewStateInput {
  cart: Cart | null;
  error: string;
  isHydrated: boolean;
  isLoading: boolean;
}

export function resolveCheckoutViewState({
  cart,
  error,
  isHydrated,
  isLoading,
}: ResolveCheckoutViewStateInput): CheckoutViewState {
  if (!isHydrated || (isLoading && !cart)) return "loading";
  if (error && !cart) return "error";
  if (!cart) return "error";
  if (cart.items.length === 0) return "empty";
  return "ready";
}

export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
}

export function isAddressComplete(address: CheckoutAddress): boolean {
  return (
    /^\d{5}-?\d{3}$/.test(address.postalCode.trim()) &&
    Boolean(address.addressLine1.trim()) &&
    Boolean(address.number.trim()) &&
    Boolean(address.neighborhood.trim()) &&
    Boolean(address.city.trim()) &&
    /^[A-Za-z]{2}$/.test(address.state.trim())
  );
}

const checkoutFieldOrder = [
  "contact.email",
  "contact.firstName",
  "contact.lastName",
  "contact.phone",
  "billingAddress.postalCode",
  "billingAddress.addressLine1",
  "billingAddress.number",
  "billingAddress.neighborhood",
  "billingAddress.city",
  "billingAddress.state",
  "shippingAddress.postalCode",
  "shippingAddress.addressLine1",
  "shippingAddress.number",
  "shippingAddress.neighborhood",
  "shippingAddress.city",
  "shippingAddress.state",
  "acceptsTerms",
] as const;

function hasPath(errors: unknown, path: string): boolean {
  return Boolean(
    path.split(".").reduce<unknown>((value, segment) => {
      if (!value || typeof value !== "object") return undefined;
      return (value as Record<string, unknown>)[segment];
    }, errors),
  );
}

export function getFirstCheckoutErrorPath(
  errors: unknown,
): (typeof checkoutFieldOrder)[number] | undefined {
  return checkoutFieldOrder.find((path) => hasPath(errors, path));
}
