import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDurableTaxDocumentBundle } from "../commerce/taxDocumentCrypto";
import { getDatabase } from "./connection";

export type NativeOrderStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type NativeOrderActorType = "system" | "customer" | "admin" | "worker";

export const NATIVE_ORDER_REQUEST_HASH_VERSION = "c3-request-v1";

export interface NativeOrderRequestIdentity {
  storeId: string; checkoutSessionId: string; cartId: string;
  checkoutVersion: bigint; cartVersion: bigint;
  storePriceListAssignmentId: string; storePriceListAssignmentVersion: bigint; priceListId: string;
  piiFingerprint: string; destinationFingerprint: string; checkoutItemsFingerprint: string;
  shippingQuoteId: string | null; shippingQuoteKey: string | null;
  logisticsFingerprint: string | null; logisticsVersion: string | null; currency: string;
}

function canonicalOrderRequestMaterial(input: NativeOrderRequestIdentity): string {
  return JSON.stringify([
    NATIVE_ORDER_REQUEST_HASH_VERSION,input.storeId,input.checkoutSessionId,input.cartId,
    input.checkoutVersion.toString(),input.cartVersion.toString(),input.storePriceListAssignmentId,
    input.storePriceListAssignmentVersion.toString(),input.priceListId,input.piiFingerprint,
    input.destinationFingerprint,input.checkoutItemsFingerprint,input.shippingQuoteId,input.shippingQuoteKey,
    input.logisticsFingerprint,input.logisticsVersion,input.currency,
  ]);
}

export function createNativeOrderRequestHash(input: NativeOrderRequestIdentity): string {
  return createHash("sha256").update(canonicalOrderRequestMaterial(input),"utf8").digest("hex");
}

const SAFE_RESERVATION_LINK_ERRORS = new Set([
  "RESERVATION_NOT_FOUND","RESERVATION_LINK_CONFLICT","RESERVATION_NOT_ACTIVE","RESERVATION_EXPIRED",
  "RESERVATION_CHECKOUT_LINK_REQUIRED","ORDER_ITEM_NOT_FOUND","RESERVATION_VARIANT_MISMATCH",
  "RESERVATION_QUANTITY_MISMATCH","RESERVATION_ORDER_SCOPE_MISMATCH",
]);

export function mapReservationLinkError(error: unknown): Error {
  const message=error instanceof Error ? error.message : "";
  const safe=[...SAFE_RESERVATION_LINK_ERRORS].find(code=>message.includes(code));
  return new Error(safe ?? "RESERVATION_LINK_FAILED");
}

export async function linkNativeInventoryReservation(reservationId: string,orderItemId: string) {
  try {
    const rows=await getDatabase().execute(sql`select * from public.link_inventory_reservation_to_order_item(${reservationId}::uuid,${orderItemId}::uuid)`);
    return rows[0];
  } catch(error) { throw mapReservationLinkError(error); }
}

export interface NativeOrderReadModel {
  [key: string]: unknown;
  id: string;
  storeId: string;
  customerId: string | null;
  checkoutSessionId: string | null;
  orderSequence: bigint;
  orderNumber: string;
  status: NativeOrderStatus;
  currency: string;
  grandTotalMinor: bigint;
  version: bigint;
  items: unknown[];
  addresses: unknown[];
  adjustments: unknown[];
  events: unknown[];
}

export function normalizeNativeOrderAddress(input: {
  recipient: string; company?: string; street: string; number: string; complement?: string;
  neighborhood: string; city: string; state: string; postalCode: string; country?: string;
}) {
  const optional = (value?: string) => value?.trim() || null;
  return {
    recipient: input.recipient.trim(), company: optional(input.company), street: input.street.trim(),
    number: input.number.trim(), complement: optional(input.complement), neighborhood: input.neighborhood.trim(),
    city: input.city.trim(), state: input.state.trim().toUpperCase(), postalCode: input.postalCode.replace(/\D/g, ""),
    country: (input.country ?? "BR").trim().toUpperCase(),
  };
}

export function assertEncryptedTaxIdBundle(input: { type?: "cpf" | "cnpj"; ciphertext?: string; fingerprint?: string; masked?: string }) {
  try {
    return assertDurableTaxDocumentBundle(input);
  } catch {
    throw new Error("NATIVE_ORDER_TAX_ID_ENVELOPE_INVALID");
  }
}

export async function allocateNativeOrderNumber(storeId: string) {
  const rows = await getDatabase().execute<{ order_sequence: bigint; order_number: string }>(sql`select * from public.allocate_native_order_number(${storeId}::uuid)`);
  return rows[0];
}

export async function transitionNativeOrder(input: { orderId: string; expected: NativeOrderStatus; target: NativeOrderStatus; expectedVersion: bigint; actorType: NativeOrderActorType; actorId?: string; reasonCode?: string; reason?: string; correlationId: string }) {
  const rows = await getDatabase().execute(sql`select * from public.transition_native_order(${input.orderId}::uuid,${input.expected}::public.order_status,${input.target}::public.order_status,${input.expectedVersion}::bigint,${input.actorType}::public.order_actor_type,${input.actorId ?? null}::text,${input.reasonCode ?? null}::text,${input.reason ?? null}::text,${input.correlationId}::uuid)`);
  return rows[0];
}

export async function readNativeOrder(orderId: string): Promise<NativeOrderReadModel | null> {
  const rows = await getDatabase().execute<NativeOrderReadModel>(sql`
    select o.id::text as "id",o.store_id::text as "storeId",o.customer_id::text as "customerId",
      o.checkout_session_id::text as "checkoutSessionId",o.order_sequence as "orderSequence",o.order_number as "orderNumber",
      o.status,o.currency,o.grand_total_minor as "grandTotalMinor",o.version,
      coalesce((select jsonb_agg(to_jsonb(i) order by i.line_number) from public.order_items i where i.order_id=o.id),'[]') as items,
      coalesce((select jsonb_agg(to_jsonb(a) order by a.address_type) from public.order_addresses a where a.order_id=o.id),'[]') as addresses,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.order_adjustments x where x.order_id=o.id),'[]') as adjustments,
      coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.order_status_events e where e.order_id=o.id),'[]') as events
    from public.orders o where o.id=${orderId}::uuid
  `);
  return rows[0] ?? null;
}
