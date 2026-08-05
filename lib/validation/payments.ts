import { z } from "zod";
import { isValidBrazilianDocument } from "./document.ts";

const idempotencyKeySchema = z.uuid();
const documentSchema = z
  .string()
  .trim()
  .refine(isValidBrazilianDocument, "CPF ou CNPJ inválido.");
const customerNoteSchema = z.string().trim().max(500).optional();

export const paymentInitiationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("inter_pix"),
      idempotencyKey: idempotencyKeySchema,
      document: documentSchema,
      customerNote: customerNoteSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal("inter_boleto"),
      idempotencyKey: idempotencyKeySchema,
      document: documentSchema,
      customerNote: customerNoteSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal("pagbank_card"),
      idempotencyKey: idempotencyKeySchema,
      cardToken: z.string().trim().min(1).max(4096),
      installments: z.number().int().min(1).max(12),
      holderDocument: documentSchema,
      customerNote: customerNoteSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal("pagbank_apple_pay"),
      idempotencyKey: idempotencyKeySchema,
      token: z.string().trim().min(1).max(4096),
      holderDocument: documentSchema,
      customerNote: customerNoteSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal("pagbank_google_pay"),
      idempotencyKey: idempotencyKeySchema,
      token: z.string().trim().min(1).max(4096),
      holderDocument: documentSchema,
      customerNote: customerNoteSchema,
    })
    .strict(),
]);

export type PaymentInitiationInput = z.infer<typeof paymentInitiationSchema>;

export const paymentStatusQuerySchema = z.object({
  provider: z.enum(["inter_pix", "inter_boleto", "pagbank_card"]),
  reference: z.string().trim().min(1).max(200),
});

export const boletoPdfQuerySchema = z.object({
  reference: z.string().trim().min(1).max(200),
});
