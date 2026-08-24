import { sql } from "drizzle-orm";
import { bigint, char, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { recordStatus } from "./core";

export const priceLists = pgTable("price_lists", {
  id: uuid().primaryKey().defaultRandom(), code: text().notNull(), name: text().notNull(),
  currency: char({ length: 3 }).notNull().default("BRL"), channel: text(), customerSegment: text("customer_segment"),
  priority: integer().notNull().default(0), status: recordStatus().notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("price_lists_code_unique").on(table.code)]);

export const prices = pgTable("prices", {
  id: uuid().primaryKey().defaultRandom(),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  priceListId: uuid("price_list_id").notNull().references(() => priceLists.id, { onDelete: "restrict" }),
  listAmountMinor: bigint("list_amount_minor", { mode: "bigint" }).notNull(),
  saleAmountMinor: bigint("sale_amount_minor", { mode: "bigint" }),
  saleValidFrom: timestamp("sale_valid_from", { withTimezone: true }),
  saleValidTo: timestamp("sale_valid_to", { withTimezone: true }),
  currency: char({ length: 3 }).notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(), validTo: timestamp("valid_to", { withTimezone: true }),
  status: recordStatus().notNull().default("active"), source: text().notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("prices_variant_list_period_idx").on(table.productVariantId, table.priceListId, table.validFrom),
  index("prices_active_lookup_idx").on(table.priceListId, table.productVariantId, table.validFrom).where(sql`${table.status} = 'active'`),
]);

export const priceHistory = pgTable("price_history", {
  id: uuid().primaryKey().defaultRandom(), priceId: uuid("price_id").notNull().references(() => prices.id, { onDelete: "restrict" }),
  previousListAmountMinor: bigint("previous_list_amount_minor", { mode: "bigint" }),
  newListAmountMinor: bigint("new_list_amount_minor", { mode: "bigint" }).notNull(),
  previousSaleAmountMinor: bigint("previous_sale_amount_minor", { mode: "bigint" }),
  newSaleAmountMinor: bigint("new_sale_amount_minor", { mode: "bigint" }), currency: char({ length: 3 }).notNull(),
  source: text().notNull(), actorReference: text("actor_reference"), sourceEventId: text("source_event_id"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("price_history_source_event_unique").on(table.source, table.sourceEventId).where(sql`${table.sourceEventId} is not null`),
  index("price_history_price_changed_idx").on(table.priceId, table.changedAt),
]);

export type PriceRow = typeof prices.$inferSelect;
