import { bigint, char, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders";

// B.3-D payment ledger foundation -- mirrors
// supabase/migrations/20260920000000_native_payment_ledger_foundation.sql.
// No provider is called by anything importing this module; gateway
// reanchoring (wiring services/payments/{inter,mercadopago,pagbank} to
// these tables) is a separate, future phase.

export const paymentProvider = pgEnum("payment_provider", ["banco_inter", "mercado_pago", "pagbank"]);
export const paymentMethod = pgEnum("payment_method", ["pix", "boleto", "credit_card", "apple_pay", "google_pay"]);
export const paymentAttemptStatus = pgEnum("payment_attempt_status", ["created", "pending", "authorized", "paid", "failed", "cancelled", "expired", "refunded", "partially_refunded"]);
export const paymentEventType = pgEnum("payment_event_type", ["status_observed", "webhook_received", "reconciliation_probe", "manual_override"]);
export const paymentEventProcessingResult = pgEnum("payment_event_processing_result", ["applied", "duplicate_ignored", "stale_ignored", "rejected"]);
export const refundStatus = pgEnum("refund_status", ["requested", "processing", "completed", "failed", "cancelled"]);

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid().primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  provider: paymentProvider().notNull(),
  method: paymentMethod().notNull(),
  status: paymentAttemptStatus().notNull().default("created"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: char({ length: 3 }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  providerReference: text("provider_reference"),
  providerStatus: text("provider_status"),
  failureCode: text("failure_code"),
  failureReason: text("failure_reason"),
  metadata: jsonb().notNull().default({}),
  correlationId: uuid("correlation_id").notNull().defaultRandom(),
  version: bigint({ mode: "bigint" }).notNull().default(BigInt(0)),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("payment_attempts_idempotency_unique").on(table.provider, table.idempotencyKey),
  uniqueIndex("payment_attempts_correlation_unique").on(table.correlationId),
  index("payment_attempts_order_idx").on(table.orderId, table.createdAt, table.id),
  index("payment_attempts_status_idx").on(table.status, table.createdAt, table.id),
]);

export const paymentEvents = pgTable("payment_events", {
  id: uuid().primaryKey().defaultRandom(),
  paymentAttemptId: uuid("payment_attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "restrict" }),
  provider: paymentProvider().notNull(),
  eventType: paymentEventType("event_type").notNull(),
  externalEventId: text("external_event_id"),
  observedStatus: text("observed_status"),
  resultingAttemptStatus: paymentAttemptStatus("resulting_attempt_status"),
  processingResult: paymentEventProcessingResult("processing_result").notNull(),
  payloadDigest: text("payload_digest"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_events_external_dedupe_unique").on(table.provider, table.externalEventId),
  index("payment_events_attempt_idx").on(table.paymentAttemptId, table.createdAt, table.id),
]);

export const refunds = pgTable("refunds", {
  id: uuid().primaryKey().defaultRandom(),
  paymentAttemptId: uuid("payment_attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  provider: paymentProvider().notNull(),
  requestedAmountMinor: bigint("requested_amount_minor", { mode: "bigint" }).notNull(),
  currency: char({ length: 3 }).notNull(),
  status: refundStatus().notNull().default("requested"),
  idempotencyKey: text("idempotency_key").notNull(),
  providerReference: text("provider_reference"),
  reason: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("refunds_idempotency_unique").on(table.provider, table.idempotencyKey),
  index("refunds_attempt_idx").on(table.paymentAttemptId, table.createdAt, table.id),
  index("refunds_order_idx").on(table.orderId, table.createdAt, table.id),
]);

export type NativePaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type NativePaymentEventRow = typeof paymentEvents.$inferSelect;
export type NativeRefundRow = typeof refunds.$inferSelect;
