import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigint, boolean, char, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { mediaKind, recordStatus } from "./core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const brands = pgTable("brands", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  websiteUrl: text("website_url"),
  imageUrl: text("image_url"), imageAlt: text("image_alt"),
  status: recordStatus().notNull().default("draft"),
  ...timestamps,
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [uniqueIndex("brands_slug_unique").on(table.slug)]);

export const categories = pgTable("categories", {
  id: uuid().primaryKey().defaultRandom(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  sortOrder: integer("sort_order").notNull().default(0),
  imageUrl: text("image_url"), imageAlt: text("image_alt"),
  status: recordStatus().notNull().default("draft"),
  ...timestamps,
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  index("categories_parent_sort_idx").on(table.parentId, table.sortOrder, table.id),
]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid().primaryKey().defaultRandom(),
  kind: mediaKind().notNull(),
  storageProvider: text("storage_provider").notNull(),
  storagePath: text("storage_path").notNull(),
  publicUrl: text("public_url"),
  mimeType: text("mime_type").notNull(),
  width: integer(),
  height: integer(),
  sizeBytes: bigint("size_bytes", { mode: "bigint" }),
  altText: text("alt_text"),
  title: text(),
  ...timestamps,
}, (table) => [uniqueIndex("media_assets_provider_path_unique").on(table.storageProvider, table.storagePath)]);

export const products = pgTable("products", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "restrict" }),
  primaryCategoryId: uuid("primary_category_id").references(() => categories.id, { onDelete: "restrict" }),
  name: text().notNull(),
  slug: text().notNull(),
  shortDescription: text("short_description"),
  description: text(),
  productType: text("product_type").notNull().default("simple"),
  taxClass: text("tax_class"),
  warranty: text(),
  countryOfOrigin: char("country_of_origin", { length: 2 }),
  manufacturerReference: text("manufacturer_reference"),
  catalogVisibility: text("catalog_visibility").notNull().default("visible"), isPurchasable: boolean("is_purchasable").notNull().default(false),
  allowsBackorder: boolean("allows_backorder").notNull().default(false), manageStock: boolean("manage_stock").notNull().default(false),
  wooStockStatus: text("woo_stock_status").notNull().default("outofstock"), averageRating: numeric("average_rating", { precision: 3, scale: 2 }).notNull().default("0"),
  reviewCount: integer("review_count").notNull().default(0), isFeatured: boolean("is_featured").notNull().default(false),
  popularity: bigint({ mode: "bigint" }).notNull().default(BigInt(0)), hasFreeShipping: boolean("has_free_shipping").notNull().default(false),
  status: recordStatus().notNull().default("draft"),
  ...timestamps,
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("products_slug_unique").on(table.slug),
  index("products_brand_status_idx").on(table.brandId, table.status, table.id),
  index("products_primary_category_idx").on(table.primaryCategoryId, table.id),
]);

export const productCategories = pgTable("product_categories", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.productId, table.categoryId] }),
  index("product_categories_category_product_idx").on(table.categoryId, table.productId),
]);

export const productVariants = pgTable("product_variants", {
  id: uuid().primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  sku: text().notNull(),
  skuNormalized: text("sku_normalized").generatedAlwaysAs(sql`upper(btrim(sku))`),
  gtin: text(),
  manufacturerCode: text("manufacturer_code"),
  weightValue: numeric("weight_value", { precision: 18, scale: 6 }),
  weightUnitCode: text("weight_unit_code"),
  widthValue: numeric("width_value", { precision: 18, scale: 6 }),
  heightValue: numeric("height_value", { precision: 18, scale: 6 }),
  lengthValue: numeric("length_value", { precision: 18, scale: 6 }),
  dimensionUnitCode: text("dimension_unit_code"),
  physicalUnit: text("physical_unit").notNull().default("unit"),
  status: recordStatus().notNull().default("draft"),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("product_variants_sku_unique").on(table.skuNormalized),
  uniqueIndex("product_variants_gtin_unique").on(table.gtin).where(sql`${table.gtin} is not null`),
  index("product_variants_product_status_idx").on(table.productId, table.status, table.id),
]);

export const productMedia = pgTable("product_media", {
  id: uuid().primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  role: text().notNull().default("gallery"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_media_usage_unique").on(
    table.productId,
    sql`coalesce(${table.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    table.mediaAssetId,
    table.role,
  ),
  index("product_media_product_sort_idx").on(table.productId, table.sortOrder, table.id),
  index("product_media_variant_idx").on(table.variantId),
]);

export const productTags = pgTable("product_tags", {
  id: uuid().primaryKey().defaultRandom(), wooExternalId: bigint("woo_external_id", { mode: "bigint" }).notNull(), name: text().notNull(), slug: text().notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("product_tags_woo_external_id_key").on(table.wooExternalId), uniqueIndex("product_tags_slug_key").on(table.slug)]);

export const productTagAssignments = pgTable("product_tag_assignments", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => productTags.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.productId, table.tagId] }), index("product_tag_assignments_tag_idx").on(table.tagId, table.productId)]);

export type BrandRow = typeof brands.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type NewProductVariantRow = typeof productVariants.$inferInsert;
