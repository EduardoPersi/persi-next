import { sql } from "drizzle-orm";
import { bigint, boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { inventoryMovementType, inventoryReservationStatus, recordStatus } from "./core";

export const inventoryLocations = pgTable("inventory_locations", {
  id: uuid().primaryKey().defaultRandom(), code: text().notNull(), name: text().notNull(),
  status: recordStatus().notNull().default("draft"), isPhysical: boolean("is_physical").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("inventory_locations_code_unique").on(table.code)]);

export const inventoryLevels = pgTable("inventory_levels", {
  id: uuid().primaryKey().defaultRandom(),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  inventoryLocationId: uuid("inventory_location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  quantityOnHand: bigint("quantity_on_hand", { mode: "bigint" }).notNull().default(BigInt(0)),
  quantityReserved: bigint("quantity_reserved", { mode: "bigint" }).notNull().default(BigInt(0)),
  quantityAvailable: bigint("quantity_available", { mode: "bigint" }).generatedAlwaysAs(sql`quantity_on_hand - quantity_reserved`),
  version: bigint({ mode: "bigint" }).notNull().default(BigInt(0)),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("inventory_levels_variant_location_unique").on(table.productVariantId, table.inventoryLocationId),
  index("inventory_levels_location_variant_idx").on(table.inventoryLocationId, table.productVariantId),
]);

export const inventoryReservations = pgTable("inventory_reservations", {
  id: uuid().primaryKey().defaultRandom(), inventoryLevelId: uuid("inventory_level_id").notNull().references(() => inventoryLevels.id, { onDelete: "restrict" }),
  quantity: bigint({ mode: "bigint" }).notNull(), status: inventoryReservationStatus().notNull().default("active"),
  referenceType: text("reference_type").notNull(), referenceId: text("reference_id").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), releasedAt: timestamp("released_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("inventory_reservations_idempotency_unique").on(table.idempotencyKey),
  index("inventory_reservations_active_expiry_idx").on(table.expiresAt, table.id).where(sql`${table.status} = 'active'`),
  index("inventory_reservations_level_status_idx").on(table.inventoryLevelId, table.status, table.id),
]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid().primaryKey().defaultRandom(), inventoryLevelId: uuid("inventory_level_id").notNull().references(() => inventoryLevels.id, { onDelete: "restrict" }),
  reservationId: uuid("reservation_id").references(() => inventoryReservations.id, { onDelete: "restrict" }),
  movementType: inventoryMovementType("movement_type").notNull(),
  quantityOnHandDelta: bigint("quantity_on_hand_delta", { mode: "bigint" }).notNull().default(BigInt(0)),
  quantityReservedDelta: bigint("quantity_reserved_delta", { mode: "bigint" }).notNull().default(BigInt(0)),
  quantityOnHandAfter: bigint("quantity_on_hand_after", { mode: "bigint" }).notNull(),
  quantityReservedAfter: bigint("quantity_reserved_after", { mode: "bigint" }).notNull(),
  sourceSystem: text("source_system").notNull(), sourceReference: text("source_reference").notNull(), reason: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("inventory_movements_source_unique").on(table.sourceSystem, table.sourceReference, table.movementType),
  index("inventory_movements_level_created_idx").on(table.inventoryLevelId, table.createdAt, table.id),
  index("inventory_movements_reservation_idx").on(table.reservationId).where(sql`${table.reservationId} is not null`),
]);

export type InventoryLevelRow = typeof inventoryLevels.$inferSelect;
export type InventoryReservationRow = typeof inventoryReservations.$inferSelect;
