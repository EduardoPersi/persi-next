import { sql } from "drizzle-orm";
import { bigint, boolean, char, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products, productVariants } from "./catalog";
import { carts, customers, stores } from "./commerce";
import { externalSystem } from "./core";
import { prices } from "./pricing";
import { storePriceListAssignments } from "./priceAuthority";
import { shippingMethods } from "./shipping";

export const checkoutSessionStatus = pgEnum("checkout_session_status", [
  "open", "validating", "ready", "submitting", "order_created", "expired", "cancelled",
]);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid().primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
  status: checkoutSessionStatus().notNull().default("open"),
  currency: char({ length: 3 }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(), requestHash: text("request_hash").notNull(),
  cartVersion: bigint("cart_version", { mode: "bigint" }).notNull(), correlationId: uuid("correlation_id").notNull().defaultRandom(),
  storePriceListAssignmentId: uuid("store_price_list_assignment_id"),
  storePriceListAssignmentVersion: bigint("store_price_list_assignment_version", { mode: "bigint" }),
  priceListId: uuid("price_list_id"),
  shippingRequired: boolean("shipping_required").notNull().default(true), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  piiCiphertext: text("pii_ciphertext"), piiIv: text("pii_iv"), piiAuthTag: text("pii_auth_tag"),
  piiEnvelopeVersion: integer("pii_envelope_version"), piiKeyId: text("pii_key_id"),
  piiFingerprint: text("pii_fingerprint"), piiDestinationFingerprint: text("pii_destination_fingerprint"),
  piiExpiresAt: timestamp("pii_expires_at", { withTimezone: true }), piiUpdatedAt: timestamp("pii_updated_at", { withTimezone: true }),
  version: bigint({ mode: "bigint" }).notNull().default(BigInt(0)),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("checkout_sessions_store_idempotency_unique").on(table.storeId, table.idempotencyKey),
  uniqueIndex("checkout_sessions_correlation_unique").on(table.correlationId),
  uniqueIndex("checkout_sessions_active_cart_unique").on(table.cartId).where(sql`${table.status} in ('open','validating','ready','submitting')`),
  index("checkout_sessions_customer_store_idx").on(table.customerId, table.storeId, table.status, table.updatedAt, table.id),
  index("checkout_sessions_expiration_idx").on(table.expiresAt, table.id).where(sql`${table.status} in ('open','validating','ready')`),
  index("checkout_sessions_authority_idx").on(table.storePriceListAssignmentId, table.storePriceListAssignmentVersion, table.id).where(sql`${table.storePriceListAssignmentId} is not null`),
  index("checkout_sessions_pii_expiry_idx").on(table.piiExpiresAt, table.id).where(sql`${table.piiCiphertext} is not null`),
  foreignKey({
    columns: [table.storePriceListAssignmentId, table.storeId, table.priceListId, table.storePriceListAssignmentVersion, table.currency],
    foreignColumns: [storePriceListAssignments.id, storePriceListAssignments.storeId, storePriceListAssignments.priceListId, storePriceListAssignments.version, storePriceListAssignments.currency],
    name: "checkout_sessions_authority_fk",
  }).onDelete("restrict"),
]);

export const checkoutSessionItems = pgTable("checkout_session_items", {
  id: uuid().primaryKey().defaultRandom(), checkoutSessionId: uuid("checkout_session_id").notNull().references(() => checkoutSessions.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(), productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  skuSnapshot: text("sku_snapshot").notNull(), productNameSnapshot: text("product_name_snapshot").notNull(), variantLabelSnapshot: text("variant_label_snapshot"),
  quantity: bigint({ mode: "bigint" }).notNull(), unitRegularAmountMinor: bigint("unit_regular_amount_minor", { mode: "bigint" }).notNull(),
  unitEffectiveAmountMinor: bigint("unit_effective_amount_minor", { mode: "bigint" }).notNull(), lineSubtotalMinor: bigint("line_subtotal_minor", { mode: "bigint" }).notNull(),
  lineDiscountMinor: bigint("line_discount_minor", { mode: "bigint" }).notNull().default(BigInt(0)), lineTaxMinor: bigint("line_tax_minor", { mode: "bigint" }).notNull().default(BigInt(0)),
  lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(), currency: char({ length: 3 }).notNull(),
  priceId: uuid("price_id").notNull().references(() => prices.id, { onDelete: "restrict" }), priceValidFrom: timestamp("price_valid_from", { withTimezone: true }).notNull(),
  priceValidTo: timestamp("price_valid_to", { withTimezone: true }), priceFingerprint: text("price_fingerprint").notNull(), sourceFingerprint: text("source_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("checkout_session_items_line_unique").on(table.checkoutSessionId, table.lineNumber),
  uniqueIndex("checkout_session_items_variant_unique").on(table.checkoutSessionId, table.productVariantId),
  index("checkout_session_items_session_idx").on(table.checkoutSessionId, table.lineNumber, table.id),
  index("checkout_session_items_price_idx").on(table.priceId, table.checkoutSessionId),
]);

export const checkoutShippingEvidence = pgTable("checkout_shipping_evidence", {
  id: uuid().primaryKey().defaultRandom(),
  checkoutSessionId: uuid("checkout_session_id").notNull().references(() => checkoutSessions.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  shippingMethodId: uuid("shipping_method_id").references(() => shippingMethods.id, { onDelete: "restrict" }),
  provider: externalSystem().notNull(), externalServiceCode: text("external_service_code").notNull(),
  carrierName: text("carrier_name").notNull(), serviceName: text("service_name").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), currency: char({ length: 3 }).notNull(),
  destinationPostcode: text("destination_postcode").notNull(), destinationFingerprint: text("destination_fingerprint").notNull(),
  logisticsInputsFingerprint: text("logistics_inputs_fingerprint").notNull(), logisticsVersion: text("logistics_version").notNull().default("shipping-authority-v1"),
  estimatedDeliveryDays: integer("estimated_delivery_days"), providerQuoteReference: text("provider_quote_reference"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  canonicalFingerprint: text("canonical_fingerprint").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("checkout_shipping_evidence_idempotency_unique").on(table.checkoutSessionId, table.idempotencyKey),
  uniqueIndex("checkout_shipping_evidence_id_checkout_unique").on(table.id, table.checkoutSessionId),
  uniqueIndex("checkout_shipping_evidence_id_checkout_store_unique").on(table.id, table.checkoutSessionId, table.storeId),
]);

export const checkoutShippingQuotes = pgTable("checkout_shipping_quotes", {
  id: uuid().primaryKey().defaultRandom(), checkoutSessionId: uuid("checkout_session_id").notNull().references(() => checkoutSessions.id, { onDelete: "cascade" }),
  shippingEvidenceId: uuid("shipping_evidence_id"),
  quoteKey: text("quote_key").notNull(), shippingMethodId: uuid("shipping_method_id").references(() => shippingMethods.id, { onDelete: "restrict" }),
  provider: externalSystem().notNull(), externalServiceCode: text("external_service_code").notNull(), carrierName: text("carrier_name").notNull(), serviceName: text("service_name").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), currency: char({ length: 3 }).notNull(), estimatedDeliveryDays: integer("estimated_delivery_days"),
  estimatedDeliveryAt: timestamp("estimated_delivery_at", { withTimezone: true }), destinationPostcode: text("destination_postcode").notNull(),
  destinationFingerprint: text("destination_fingerprint").notNull(), logisticsFingerprint: text("logistics_fingerprint").notNull(), logisticsVersion: text("logistics_version").notNull(),
  providerQuoteReference: text("provider_quote_reference"), isSelected: boolean("is_selected").notNull().default(false), quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), selectedAt: timestamp("selected_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("checkout_shipping_quotes_key_unique").on(table.checkoutSessionId, table.quoteKey),
  uniqueIndex("checkout_shipping_quotes_selected_unique").on(table.checkoutSessionId).where(sql`${table.isSelected}`),
  index("checkout_shipping_quotes_session_idx").on(table.checkoutSessionId, table.createdAt, table.id),
  index("checkout_shipping_quotes_expiration_idx").on(table.expiresAt, table.id).where(sql`${table.isSelected}`),
  foreignKey({
    columns: [table.shippingEvidenceId, table.checkoutSessionId],
    foreignColumns: [checkoutShippingEvidence.id, checkoutShippingEvidence.checkoutSessionId],
    name: "checkout_shipping_quotes_evidence_fk",
  }).onDelete("restrict"),
]);

export type CheckoutSessionRow = typeof checkoutSessions.$inferSelect;
export type CheckoutSessionItemRow = typeof checkoutSessionItems.$inferSelect;
export type CheckoutShippingQuoteRow = typeof checkoutShippingQuotes.$inferSelect;
export type CheckoutShippingEvidenceRow = typeof checkoutShippingEvidence.$inferSelect;
