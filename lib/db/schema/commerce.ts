import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  char,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { recordStatus } from "./core";

export const customerStatus = pgEnum("customer_status", ["active", "inactive", "anonymized"]);
export const customerType = pgEnum("customer_type", ["individual", "business"]);
export const cartStatus = pgEnum("cart_status", ["active", "locked", "converted", "abandoned", "expired", "merged"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const stores = pgTable("stores", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull(),
  name: text().notNull(),
  status: recordStatus().notNull().default("draft"),
  defaultCurrency: char("default_currency", { length: 3 }).notNull().default("BRL"),
  timezone: text().notNull().default("America/Sao_Paulo"),
  nextOrderSequence: bigint("next_order_sequence", { mode: "bigint" }).notNull().default(BigInt(1)),
  ...timestamps,
}, (table) => [
  uniqueIndex("stores_code_unique").on(table.code),
]);

export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  status: customerStatus().notNull().default("active"),
  customerType: customerType("customer_type").notNull().default("individual"),
  email: text(),
  emailNormalized: text("email_normalized").generatedAlwaysAs(sql`lower(btrim(email))`),
  phone: text(),
  phoneNormalized: text("phone_normalized"),
  taxIdType: text("tax_id_type"),
  taxIdCiphertext: text("tax_id_ciphertext"),
  taxIdFingerprint: text("tax_id_fingerprint"),
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("customers_email_normalized_idx").on(table.emailNormalized, table.id).where(sql`${table.emailNormalized} is not null`),
  index("customers_phone_normalized_idx").on(table.phoneNormalized, table.id).where(sql`${table.phoneNormalized} is not null`),
  index("customers_tax_id_fingerprint_idx").on(table.taxIdFingerprint, table.id).where(sql`${table.taxIdFingerprint} is not null`),
  index("customers_status_created_idx").on(table.status, table.createdAt, table.id),
]);

export const customerIdentities = pgTable("customer_identities", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  issuer: text().notNull(),
  subject: text().notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("customer_identities_issuer_subject_unique").on(table.issuer, table.subject),
  index("customer_identities_customer_idx").on(table.customerId, table.createdAt, table.id),
]);

export const customerAddresses = pgTable("customer_addresses", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  label: text(),
  recipient: text().notNull(),
  company: text(),
  street: text().notNull(),
  number: text().notNull(),
  complement: text(),
  neighborhood: text().notNull(),
  postalCode: text("postal_code").notNull(),
  city: text().notNull(),
  state: text().notNull(),
  country: char({ length: 2 }).notNull().default("BR"),
  status: recordStatus().notNull().default("active"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("customer_addresses_customer_status_idx").on(table.customerId, table.status, table.createdAt, table.id),
]);

export const carts = pgTable("carts", {
  id: uuid().primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
  guestTokenFingerprint: text("guest_token_fingerprint"),
  currency: char({ length: 3 }).notNull().default("BRL"),
  status: cartStatus().notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  version: bigint({ mode: "bigint" }).notNull().default(BigInt(0)),
  mergedIntoCartId: uuid("merged_into_cart_id").references((): AnyPgColumn => carts.id, { onDelete: "restrict" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("carts_guest_token_unique").on(table.guestTokenFingerprint).where(sql`${table.guestTokenFingerprint} is not null`),
  uniqueIndex("carts_active_customer_unique").on(table.storeId, table.customerId, table.currency).where(sql`${table.status} = 'active' and ${table.customerId} is not null`),
  index("carts_customer_lookup_idx").on(table.customerId, table.storeId, table.status, table.updatedAt),
  index("carts_expiration_idx").on(table.expiresAt, table.id),
  index("carts_status_idx").on(table.storeId, table.status, table.updatedAt, table.id),
]);

export const cartItems = pgTable("cart_items", {
  id: uuid().primaryKey().defaultRandom(),
  cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  quantity: bigint({ mode: "bigint" }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("cart_items_variant_unique").on(table.cartId, table.productVariantId),
  index("cart_items_variant_idx").on(table.productVariantId, table.cartId),
]);

export type StoreRow = typeof stores.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type CustomerIdentityRow = typeof customerIdentities.$inferSelect;
export type CustomerAddressRow = typeof customerAddresses.$inferSelect;
export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;
