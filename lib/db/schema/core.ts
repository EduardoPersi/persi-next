import { pgEnum } from "drizzle-orm/pg-core";

export const recordStatus = pgEnum("record_status", ["draft", "active", "inactive", "archived"]);
export const mediaKind = pgEnum("media_kind", ["image", "video", "document", "manual", "technical_sheet"]);
export const attributeDataType = pgEnum("attribute_data_type", [
  "text", "boolean", "integer", "decimal", "option", "measurement", "composite_measurement",
]);
export const attributeCardinality = pgEnum("attribute_cardinality", ["single", "multiple"]);
export const inventoryMovementType = pgEnum("inventory_movement_type", [
  "purchase", "sale", "reservation", "release", "adjustment", "return", "transfer", "erp_sync",
]);
export const inventoryReservationStatus = pgEnum("inventory_reservation_status", [
  "active", "released", "confirmed", "expired", "cancelled",
]);
export const externalSystem = pgEnum("external_system", [
  "woocommerce", "olist", "banco_inter", "pagbank", "melhor_envio", "mercadopago",
]);
export const externalMappingStatus = pgEnum("external_mapping_status", ["active", "conflict", "inactive"]);
export const shipmentStatus = pgEnum("shipment_status", [
  "pending", "preparing", "ready_to_ship", "posted", "in_transit",
  "out_for_delivery", "delivered", "delivery_failed", "delayed",
  "returning", "returned", "cancelled",
]);
export const pimWorkflowStatus = pgEnum("pim_workflow_status", [
  "raw", "normalized", "needs_enrichment", "draft", "ai_suggested", "needs_review", "approved", "rejected", "published",
]);
export const pimSource = pgEnum("pim_source", [
  "olist", "woocommerce", "manufacturer", "manual", "ai", "migration", "external_reference",
]);
export const pimDecisionStatus = pgEnum("pim_decision_status", ["needs_review", "approved", "rejected"]);
