import { sql } from "drizzle-orm";
import {
  bigint, boolean, char, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { externalSystem, recordStatus, shipmentStatus } from "./core";
import { externalMappings } from "./integrations";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const shippingMethods = pgTable("shipping_methods", {
  id: uuid().primaryKey().defaultRandom(),
  provider: externalSystem().notNull(),
  externalCode: text("external_code").notNull(),
  carrierName: text("carrier_name").notNull(),
  serviceName: text("service_name").notNull(),
  supportsInsurance: boolean("supports_insurance").notNull().default(true),
  requiresPickupAgency: boolean("requires_pickup_agency").notNull().default(false),
  status: recordStatus().notNull().default("active"),
  ...timestamps,
}, (table) => [
  uniqueIndex("shipping_methods_provider_code_unique").on(table.provider, table.externalCode),
]);

export type ShippingMethodRow = typeof shippingMethods.$inferSelect;

// order_mapping_id + order_mapping_entity_type reproduzem a FK composta
// definida em SQL (references external_mappings(id, entity_type)) — o banco,
// não só o app, impede que uma remessa seja ligada a um mapping que não seja
// do tipo 'order' (ver 20260901120000_shipping_core.sql).
export const shipments = pgTable("shipments", {
  id: uuid().primaryKey().defaultRandom(),
  orderMappingId: uuid("order_mapping_id").notNull(),
  orderMappingEntityType: text("order_mapping_entity_type").notNull().default("order"),
  shippingMethodId: uuid("shipping_method_id").references(() => shippingMethods.id, { onDelete: "restrict" }),
  provider: externalSystem().notNull(),
  externalShipmentId: text("external_shipment_id"),
  externalProtocol: text("external_protocol"),
  carrierName: text("carrier_name"),
  serviceName: text("service_name"),
  status: shipmentStatus().notNull().default("pending"),
  rawProviderStatus: text("raw_provider_status"),
  trackingCode: text("tracking_code"),
  trackingUrl: text("tracking_url"),
  quotedAmountMinor: bigint("quoted_amount_minor", { mode: "bigint" }).notNull(),
  currency: char({ length: 3 }).notNull().default("BRL"),
  promisedDeliveryDays: integer("promised_delivery_days"),
  destinationPostcode: text("destination_postcode").notNull(),
  estimatedDeliveryAt: timestamp("estimated_delivery_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("shipments_external_unique").on(table.provider, table.externalShipmentId),
  index("shipments_order_mapping_idx").on(table.orderMappingId),
  index("shipments_status_idx").on(table.status, table.lastEventAt),
  foreignKey({
    columns: [table.orderMappingId, table.orderMappingEntityType],
    foreignColumns: [externalMappings.id, externalMappings.entityType],
    name: "shipments_order_mapping_fk",
  }),
]);

export type ShipmentRow = typeof shipments.$inferSelect;

export const shipmentEvents = pgTable("shipment_events", {
  id: uuid().primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  status: shipmentStatus().notNull(),
  rawProviderStatus: text("raw_provider_status"),
  description: text(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  externalEventId: text("external_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shipment_events_external_unique").on(table.shipmentId, table.externalEventId),
  index("shipment_events_shipment_timeline_idx").on(table.shipmentId, sql`${table.occurredAt} desc`),
]);

export type ShipmentEventRow = typeof shipmentEvents.$inferSelect;

// access_token_ciphertext/refresh_token_ciphertext nunca recebem texto puro —
// ver lib/shipping/providers/melhor-envio/auth.ts (AES-256-GCM antes do insert).
export const shippingProviderCredentials = pgTable("shipping_provider_credentials", {
  id: uuid().primaryKey().defaultRandom(),
  provider: externalSystem().notNull(),
  environment: text().notNull(),
  accessTokenCiphertext: text("access_token_ciphertext").notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("shipping_provider_credentials_unique").on(table.provider, table.environment),
]);

export type ShippingProviderCredentialRow = typeof shippingProviderCredentials.$inferSelect;

export const shippingQuoteCache = pgTable("shipping_quote_cache", {
  id: uuid().primaryKey().defaultRandom(),
  cacheKey: text("cache_key").notNull(),
  provider: externalSystem().notNull(),
  destinationPostcode: text("destination_postcode").notNull(),
  response: jsonb().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shipping_quote_cache_key_unique").on(table.cacheKey),
  index("shipping_quote_cache_expires_idx").on(table.expiresAt),
]);

export type ShippingQuoteCacheRow = typeof shippingQuoteCache.$inferSelect;
