import { z } from "zod";
import { BRAZILIAN_STATES } from "../constants/brazilianStates.ts";
import { isValidBrazilianDocument } from "./document.ts";
import type { CheckoutFormValues } from "@/types/checkout";

const requiredText = (message: string) => z.string().trim().min(1, message);

const addressSchema = z.object({
  postalCode: z
    .string()
    .trim()
    .refine((value) => /^\d{5}-?\d{3}$/.test(value), "Informe um CEP válido."),
  addressLine1: requiredText("Informe o endereço."),
  number: requiredText("Informe o número."),
  addressLine2: z.string().trim(),
  neighborhood: requiredText("Informe o bairro."),
  city: requiredText("Informe a cidade."),
  state: z
    .string()
    .trim()
    .refine(
      (value) =>
        BRAZILIAN_STATES.includes(
          value.toUpperCase() as (typeof BRAZILIAN_STATES)[number],
        ),
      "Selecione um estado válido.",
    ),
  country: z.literal("BR"),
});

const inactiveAddressSchema = z.object({
  postalCode: z.string(),
  addressLine1: z.string(),
  number: z.string(),
  addressLine2: z.string(),
  neighborhood: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.literal("BR"),
});

export const checkoutSchema = z
  .object({
    contact: z.object({
      email: z.email("Informe um e-mail válido."),
      firstName: requiredText("Informe seu nome."),
      lastName: requiredText("Informe seu sobrenome."),
      company: z.string().trim().max(200, "Informe até 200 caracteres."),
      phone: z
        .string()
        .trim()
        .refine(
          (value) => /^\d{10,11}$/.test(value.replace(/\D/g, "")),
          "Informe um telefone com DDD.",
        ),
      document: z
        .string()
        .trim()
        .refine(isValidBrazilianDocument, "Informe um CPF ou CNPJ válido."),
    }),
    billingAddress: addressSchema,
    shipToBillingAddress: z.boolean(),
    shippingAddress: inactiveAddressSchema,
    acceptsTerms: z.boolean().refine((value) => value, {
      message: "Você precisa aceitar os termos para continuar.",
    }),
  })
  .superRefine((value, context) => {
    if (value.shipToBillingAddress) return;

    const result = addressSchema.safeParse(value.shippingAddress);
    if (result.success) return;

    for (const issue of result.error.issues) {
      context.addIssue({
        ...issue,
        path: ["shippingAddress", ...issue.path],
      });
    }
  });

export const emptyCheckoutAddress = {
  postalCode: "",
  addressLine1: "",
  number: "",
  addressLine2: "",
  neighborhood: "",
  city: "",
  state: "",
  country: "BR",
} as const;

export const checkoutDefaultValues: CheckoutFormValues = {
  contact: {
    email: "",
    firstName: "",
    lastName: "",
    company: "",
    phone: "",
    document: "",
  },
  billingAddress: { ...emptyCheckoutAddress },
  shipToBillingAddress: true,
  shippingAddress: { ...emptyCheckoutAddress },
  acceptsTerms: false,
};
