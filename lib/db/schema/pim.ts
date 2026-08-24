import { type AnyPgColumn, index, bigint, boolean, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products, productVariants } from "./catalog";
import { attributeCardinality, attributeDataType, recordStatus } from "./core";

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

export type AttributeValueRow = typeof attributeValues.$inferSelect;
export type MeasurementComponentRow = typeof measurementComponents.$inferSelect;
