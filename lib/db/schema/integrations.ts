import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { externalMappingStatus, externalSystem } from "./core";

export const externalMappings = pgTable("external_mappings", {
  id: uuid().primaryKey().defaultRandom(), system: externalSystem().notNull(), entityType: text("entity_type").notNull(),
  internalId: uuid("internal_id").notNull(), externalId: text("external_id").notNull(), externalSku: text("external_sku"),
  status: externalMappingStatus().notNull().default("active"), sourceVersion: text("source_version"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sourceChangedAt: timestamp("source_changed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("external_mappings_external_unique").on(table.system, table.entityType, table.externalId),
  uniqueIndex("external_mappings_internal_unique").on(table.system, table.entityType, table.internalId),
  index("external_mappings_internal_lookup_idx").on(table.entityType, table.internalId),
  index("external_mappings_external_sku_idx").on(table.system, table.externalSku).where(sql`${table.externalSku} is not null`),
  // Habilita a FK composta de shipments.order_mapping_id -> (id, entity_type):
  // garante em nível de banco que só um mapping entity_type='order' pode ser
  // referenciado como pedido de uma remessa.
  uniqueIndex("external_mappings_id_entity_type_unique").on(table.id, table.entityType),
]);

export type ExternalMappingRow = typeof externalMappings.$inferSelect;

export const integrationInbox = pgTable("integration_inbox", {
  id: uuid().primaryKey().defaultRandom(), source: externalSystem().notNull(), eventType: text("event_type").notNull(),
  externalEventId: text("external_event_id").notNull(), entityType: text("entity_type").notNull(), externalEntityId: text("external_entity_id").notNull(),
  payloadHash: text("payload_hash"), sourceChangedAt: timestamp("source_changed_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(), processedAt: timestamp("processed_at", { withTimezone: true }),
  status: text().notNull().default("pending"), attempts: integer().notNull().default(0), lastErrorCode: text("last_error_code"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(), lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"), result: text(), durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("integration_inbox_event_unique").on(table.source, table.externalEventId),
  index("integration_inbox_work_idx").on(table.nextAttemptAt, table.receivedAt, table.id),
  index("integration_inbox_entity_idx").on(table.source, table.entityType, table.externalEntityId, table.sourceChangedAt),
]);

export const integrationCheckpoints = pgTable("integration_checkpoints", {
  id: uuid().primaryKey().defaultRandom(), source: externalSystem().notNull(), stream: text().notNull(), cursorValue: text("cursor_value"),
  cursorChangedAt: timestamp("cursor_changed_at", { withTimezone: true }), lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }), lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("integration_checkpoints_stream_unique").on(table.source, table.stream)]);
