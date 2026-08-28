import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const stringList = (itemMax: number, maxItems: number) => z.array(z.string().trim().min(1).max(itemMax)).max(maxItems)
  .transform((items) => [...new Set(items)]);

export const pimEditorialDraftSchema = z.object({
  productId: z.string().uuid(),
  version: z.coerce.bigint().min(BigInt(0)),
  commercialName: optionalText(240),
  shortDescription: optionalText(600),
  description: optionalText(20_000),
  bulletPoints: stringList(300, 20),
  application: optionalText(4_000),
  specifications: optionalText(8_000),
  seoTitle: optionalText(240),
  metaDescription: optionalText(500),
  searchTerms: stringList(120, 50),
  imageAltText: optionalText(300),
}).strict();

export const pimWorkflowActionSchema = z.object({
  productId: z.string().uuid(),
  version: z.coerce.bigint().min(BigInt(0)),
  action: z.enum(["SUBMIT_REVIEW", "APPROVE", "REJECT", "REOPEN", "DISCARD_DRAFT"]),
  reason: z.string().trim().max(1_000).optional(),
}).strict();

export type PimEditorialDraftInput = z.infer<typeof pimEditorialDraftSchema>;
export type PimWorkflowActionInput = z.infer<typeof pimWorkflowActionSchema>;
