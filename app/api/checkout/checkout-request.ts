import { z } from "zod";
import { BRAZILIAN_STATES } from "@/lib/constants/brazilianStates";
import { CartServiceError } from "@/services/woocommerce/cart";

export const MAX_CHECKOUT_REQUEST_BYTES = 16_384;

const stateSchema = z.enum(BRAZILIAN_STATES);

export const storeAddressSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    company: z.string().trim().max(200).optional(),
    address1: z.string().trim().min(1).max(250),
    address2: z.string().trim().max(250).optional(),
    city: z.string().trim().min(1).max(120),
    state: stateSchema,
    postcode: z.string().regex(/^\d{8}$/),
    country: z.literal("BR"),
    email: z.email().max(254).optional(),
    phone: z.string().regex(/^\d{10,11}$/).optional(),
  })
  .strict();

export const customerPayloadSchema = z
  .object({
    billingAddress: storeAddressSchema,
    shippingAddress: storeAddressSchema,
  })
  .strict();

export const shippingRatePayloadSchema = z
  .object({
    packageId: z.union([
      z.number().int().nonnegative(),
      z.string().trim().min(1).max(100),
    ]),
    rateId: z.string().trim().min(1).max(200),
  })
  .strict();

export function exceedsRequestLimit(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > MAX_CHECKOUT_REQUEST_BYTES;
}

export function getCheckoutError(
  error: unknown,
  operation: "customer" | "shipping",
) {
  if (!(error instanceof CartServiceError)) {
    return {
      status: 500,
      message:
        operation === "customer"
          ? "Não foi possível atualizar o endereço agora."
          : "Não foi possível selecionar a entrega agora.",
    };
  }
  if (error.status === 400 || error.status === 409) {
    return {
      status: error.status,
      message:
        operation === "customer"
          ? "Confira os dados do endereço para calcular a entrega."
          : "Esta opção de entrega não está mais disponível.",
    };
  }
  if (error.status === 401 || error.status === 403 || error.status === 404) {
    return {
      status: error.status,
      message:
        "Não foi possível atualizar o carrinho. Recarregue a página e tente novamente.",
    };
  }
  return {
    status: error.status,
    message:
      error.status === 504
        ? "O cálculo da entrega demorou mais que o esperado. Tente novamente."
        : "Não foi possível calcular a entrega agora.",
  };
}
