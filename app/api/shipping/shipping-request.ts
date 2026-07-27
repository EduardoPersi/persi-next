import { z } from "zod";

export const postcodeSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{8}$/));

export const cartShippingQuoteSchema = z
  .object({
    postcode: postcodeSchema,
  })
  .strict();

const variationAttributeSchema = z
  .object({
    attribute: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(200),
  })
  .strict();

export const productShippingQuoteSchema = z
  .object({
    postcode: postcodeSchema,
    productId: z.number().int().positive(),
    variationId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().max(999),
    variation: z.array(variationAttributeSchema).min(1).max(20).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.variationId) !== Boolean(value.variation?.length)) {
      context.addIssue({
        code: "custom",
        message: "A variação está incompleta.",
      });
    }
  });
