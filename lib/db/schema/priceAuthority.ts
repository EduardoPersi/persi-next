import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { stores } from "./commerce";
import { priceLists } from "./pricing";

export const commercialContext = pgEnum("commercial_context", ["storefront_retail"]);

export const storePriceListAssignments = pgTable("store_price_list_assignments", {
  id: uuid().primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  priceListId: uuid("price_list_id").notNull(),
  currency: char({ length: 3 }).notNull(),
  commercialContext: commercialContext("commercial_context").notNull(),
  version: bigint({ mode: "bigint" }).notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validTo: timestamp("valid_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("store_price_assignments_version_unique").on(table.storeId, table.currency, table.commercialContext, table.version),
  uniqueIndex("store_price_assignments_identity_unique").on(table.id, table.storeId, table.priceListId, table.version, table.currency),
  foreignKey({ columns: [table.priceListId, table.currency], foreignColumns: [priceLists.id, priceLists.currency], name: "store_price_assignments_list_currency_fk" }).onDelete("restrict"),
  index("store_price_assignments_lookup_idx").on(table.storeId, table.currency, table.commercialContext, table.validFrom, table.validTo),
  index("store_price_assignments_list_idx").on(table.priceListId, table.storeId, table.validFrom),
  // Period and currency invariants are enforced by the canonical SQL migration.
  check("store_price_assignments_valid_period", sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`),
]);

export type StorePriceListAssignmentRow = typeof storePriceListAssignments.$inferSelect;
