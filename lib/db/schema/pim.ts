import { type AnyPgColumn, index, bigint, boolean, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products, productVariants } from "./catalog";
import { attributeCardinality, attributeDataType, pimDecisionStatus, pimSource, pimWorkflowStatus, recordStatus } from "./core";

export const units = pgTable("units", {
  id: uuid().primaryKey().defaultRandom(), code: text().notNull(), symbol: text().notNull(), name: text().notNull(),
  dimension: text().notNull(), baseUnitId: uuid("base_unit_id").references((): AnyPgColumn => units.id, { onDelete: "restrict" }),
  conversionNumerator: bigint("conversion_numerator", { mode: "bigint" }),
  conversionDenominator: bigint("conversion_denominator", { mode: "bigint" }),
  status: recordStatus().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("units_code_unique").on(table.code)]);

export const attributes = pgTable("attributes", {
  id: uuid().primaryKey().defaultRandom(), code: text().notNull(), name: text().notNull(), description: text(),
  dataType: attributeDataType("data_type").notNull(), cardinality: attributeCardinality().notNull().default("single"),
  unitDimension: text("unit_dimension"), isCommercial: boolean("is_commercial").notNull().default(false),
  isTechnical: boolean("is_technical").notNull().default(false), isVariation: boolean("is_variation").notNull().default(false),
  isFilterable: boolean("is_filterable").notNull().default(false), isSearchable: boolean("is_searchable").notNull().default(false),
  isVisible: boolean("is_visible").notNull().default(true), sortOrder: integer("sort_order").notNull().default(0),
  status: recordStatus().notNull().default("draft"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("attributes_code_unique").on(table.code)]);

export const attributeValues = pgTable("attribute_values", {
  id: uuid().primaryKey().defaultRandom(), attributeId: uuid("attribute_id").notNull().references(() => attributes.id, { onDelete: "restrict" }),
  displayValue: text("display_value").notNull(), normalizedText: text("normalized_text"), textValue: text("text_value"),
  booleanValue: boolean("boolean_value"), integerValue: bigint("integer_value", { mode: "bigint" }),
  decimalValue: numeric("decimal_value", { precision: 30, scale: 12 }), optionCode: text("option_code"),
  measurementNumerator: bigint("measurement_numerator", { mode: "bigint" }),
  measurementDenominator: bigint("measurement_denominator", { mode: "bigint" }),
  measurementUnitId: uuid("measurement_unit_id").references(() => units.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("attribute_values_attribute_idx").on(table.attributeId, table.id)]);

export const measurementComponents = pgTable("measurement_components", {
  id: uuid().primaryKey().defaultRandom(),
  attributeValueId: uuid("attribute_value_id").notNull().references(() => attributeValues.id, { onDelete: "cascade" }),
  position: smallint().notNull(), semanticRole: text("semantic_role").notNull(),
  numerator: bigint({ mode: "bigint" }).notNull(), denominator: bigint({ mode: "bigint" }).notNull(),
  unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "restrict" }), displayValue: text("display_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("measurement_components_position_unique").on(table.attributeValueId, table.position),
  uniqueIndex("measurement_components_role_unique").on(table.attributeValueId, table.semanticRole),
  index("measurement_components_query_idx").on(table.unitId, table.numerator, table.denominator, table.attributeValueId),
]);

export const productAttributeValues = pgTable("product_attribute_values", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  attributeId: uuid("attribute_id").notNull().references(() => attributes.id, { onDelete: "restrict" }),
  attributeValueId: uuid("attribute_value_id").notNull().references(() => attributeValues.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.productId, table.attributeId, table.attributeValueId] })]);

export const variantAttributeValues = pgTable("variant_attribute_values", {
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  attributeId: uuid("attribute_id").notNull().references(() => attributes.id, { onDelete: "restrict" }),
  attributeValueId: uuid("attribute_value_id").notNull().references(() => attributeValues.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.variantId, table.attributeId, table.attributeValueId] })]);

export const pimProductProfiles = pgTable("pim_product_profiles", {
  productId: uuid("product_id").primaryKey().references(() => products.id, { onDelete: "cascade" }),
  workflowStatus: pimWorkflowStatus("workflow_status").notNull().default("raw"),
  commercialName: text("commercial_name"), shortDescription: text("short_description"), description: text(),
  bulletPoints: text("bullet_points").array().notNull().default([]), application: text(), specifications: text(),
  seoTitle: text("seo_title"), metaDescription: text("meta_description"), searchTerms: text("search_terms").array().notNull().default([]),
  synonyms: text().array().notNull().default([]), reviewNotes: text("review_notes"),
  imageAltText: text("image_alt_text"),
  version: bigint({ mode: "bigint" }).notNull().default(BigInt(0)), approvedContent: jsonb("approved_content"),
  draftStartedAt: timestamp("draft_started_at", { withTimezone: true }), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }), publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("pim_product_profiles_workflow_idx").on(table.workflowStatus, table.updatedAt, table.productId)]);

export const pimAttributeReviews = pgTable("pim_attribute_reviews", {
  id: uuid().primaryKey().defaultRandom(), productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
  attributeId: uuid("attribute_id").notNull().references(() => attributes.id, { onDelete: "restrict" }),
  attributeValueId: uuid("attribute_value_id").notNull().references(() => attributeValues.id, { onDelete: "restrict" }),
  source: pimSource().notNull(), status: pimDecisionStatus().notNull().default("needs_review"), confidence: numeric({ precision: 5, scale: 4 }),
  sourceReference: text("source_reference"), evidence: text(), reviewedBy: text("reviewed_by"), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("pim_attribute_reviews_assignment_unique").on(table.productId, table.attributeId, table.attributeValueId), index("pim_attribute_reviews_queue_idx").on(table.status, table.createdAt)]);

export const pimSuggestions = pgTable("pim_suggestions", {
  id: uuid().primaryKey().defaultRandom(), productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(), suggestedValue: text("suggested_value").notNull(), source: pimSource().notNull(),
  confidence: numeric({ precision: 5, scale: 4 }), status: pimDecisionStatus().notNull().default("needs_review"),
  evidence: text(), providerReference: text("provider_reference"), reviewedBy: text("reviewed_by"), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  suggestionType: text("suggestion_type").notNull().default("field"), payload: jsonb().notNull().default({}),
  provider: text().notNull().default("deterministic"), modelVersion: text("model_version").notNull().default("rules-v1"),
  promptVersion: text("prompt_version").notNull().default("pim-enrichment-v1"), sourceFingerprint: text("source_fingerprint").notNull().default(""),
  extractionMethod: text("extraction_method").notNull().default("deterministic"), evidenceReferences: jsonb("evidence_references").notNull().default([]),
  inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), estimatedCostMinor: bigint("estimated_cost_minor", { mode: "bigint" }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("pim_suggestions_queue_idx").on(table.status, table.createdAt, table.productId)]);

export const pimAuditLog = pgTable("pim_audit_log", {
  id: uuid().primaryKey().defaultRandom(), productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), fieldName: text("field_name"),
  previousValue: text("previous_value"), newValue: text("new_value"), source: pimSource().notNull(), actorReference: text("actor_reference").notNull(),
  operation: text().notNull(), reason: text(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("pim_audit_log_entity_idx").on(table.entityType, table.entityId, table.createdAt), index("pim_audit_log_product_idx").on(table.productId, table.createdAt)]);

export type AttributeValueRow = typeof attributeValues.$inferSelect;
export type MeasurementComponentRow = typeof measurementComponents.$inferSelect;
