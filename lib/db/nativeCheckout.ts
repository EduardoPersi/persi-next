import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase } from "./connection";
import { hashGuestCartToken } from "./nativeCart";

export interface NativeCheckoutIntent {
  storeId: string;
  cartId: string;
  customerId: string | null;
  cartVersion: bigint;
  priceListId: string;
  inventoryLocationId: string;
  currency: string;
  shippingRequired: boolean;
}

export interface NativeCheckoutQuoteInput {
  quoteKey: string;
  shippingMethodId?: string;
  provider: "woocommerce" | "olist" | "banco_inter" | "pagbank" | "melhor_envio" | "mercadopago";
  externalServiceCode: string;
  carrierName: string;
  serviceName: string;
  amountMinor: bigint;
  destinationPostcode: string;
  destinationFingerprint: string;
  logisticsFingerprint: string;
  logisticsVersion: string;
  expiresAt: Date;
  estimatedDeliveryDays?: number;
  providerQuoteReference?: string;
}

export interface PrepareNativeCheckoutInput extends NativeCheckoutIntent {
  idempotencyKey: string;
  expiresAt: Date;
  guestToken?: string;
  quote?: NativeCheckoutQuoteInput;
}

export interface NativeCheckoutReadModel {
  [key: string]: unknown;
  id: string;
  storeId: string;
  cartId: string;
  customerId: string | null;
  status: string;
  currency: string;
  requestHash: string;
  cartVersion: bigint;
  storePriceListAssignmentId: string | null;
  storePriceListAssignmentVersion: bigint | null;
  priceListId: string | null;
  expiresAt: Date;
  version: bigint;
  items: unknown[];
  selectedShippingQuote: unknown | null;
  reservations: unknown[];
}

function canonicalValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

export function createNativeCheckoutRequestHash(intent: NativeCheckoutIntent): string {
  const canonical = JSON.stringify(canonicalValue({
    version: "native-checkout-intent-v1",
    storeId: intent.storeId,
    cartId: intent.cartId,
    customerId: intent.customerId,
    cartVersion: intent.cartVersion,
    priceListId: intent.priceListId,
    inventoryLocationId: intent.inventoryLocationId,
    currency: intent.currency,
    shippingRequired: intent.shippingRequired,
  }));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createLogisticsFingerprint(input: {
  cartVersion: bigint;
  destinationPostcode: string;
  inventoryLocationId: string;
  serviceCode: string;
  logisticsVersion: string;
  lines: Array<{ variantId: string; quantity: bigint }>;
}): string {
  const canonical = canonicalValue({
    version: "native-logistics-v1",
    ...input,
    lines: [...input.lines].sort((left, right) => left.variantId.localeCompare(right.variantId)),
  });
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export async function prepareNativeCheckout(input: PrepareNativeCheckoutInput) {
  if (input.shippingRequired !== Boolean(input.quote)) throw new Error("NATIVE_CHECKOUT_SHIPPING_CONTEXT_INVALID");
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID");
  const requestHash = createNativeCheckoutRequestHash({
    storeId: input.storeId, cartId: input.cartId, customerId: input.customerId,
    cartVersion: input.cartVersion, priceListId: input.priceListId,
    inventoryLocationId: input.inventoryLocationId, currency: input.currency,
    shippingRequired: input.shippingRequired,
  });
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const quote = input.quote;
  const result = await getDatabase().execute(sql`
    select * from public.prepare_native_checkout(
      ${input.storeId}::uuid, ${input.cartId}::uuid, ${input.customerId}::uuid,
      ${guestFingerprint}::text, ${input.idempotencyKey}::text, ${requestHash}::text,
      ${input.cartVersion}::bigint, ${input.priceListId}::uuid, ${input.inventoryLocationId}::uuid,
      ${input.expiresAt.toISOString()}::timestamptz, ${input.shippingRequired}::boolean,
      ${quote?.quoteKey ?? null}::text, ${quote?.shippingMethodId ?? null}::uuid,
      ${quote?.provider ?? null}::public.external_system, ${quote?.externalServiceCode ?? null}::text,
      ${quote?.carrierName ?? null}::text, ${quote?.serviceName ?? null}::text,
      ${quote?.amountMinor ?? null}::bigint, ${quote?.destinationPostcode ?? null}::text,
      ${quote?.destinationFingerprint ?? null}::text, ${quote?.logisticsFingerprint ?? null}::text,
      ${quote?.logisticsVersion ?? null}::text, ${quote?.expiresAt.toISOString() ?? null}::timestamptz,
      ${quote?.estimatedDeliveryDays ?? null}::integer, ${quote?.providerQuoteReference ?? null}::text
    )
  `);
  return result[0];
}

export async function markNativeCheckoutReady(input: {
  checkoutId: string;
  customerId?: string | null;
  guestToken?: string;
  expectedVersion: bigint;
  expectedPiiFingerprint: string;
}) {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const result = await getDatabase().execute(sql`
    select * from public.mark_native_checkout_ready(
      ${input.checkoutId}::uuid,${input.customerId ?? null}::uuid,${guestFingerprint}::text,
      ${input.expectedVersion}::bigint,${input.expectedPiiFingerprint}::text)
  `);
  return result[0];
}

export async function closeNativeCheckout(checkoutId: string, target: "cancelled" | "expired") {
  const result = await getDatabase().execute(sql`select * from public.close_native_checkout(${checkoutId}::uuid,${target}::public.checkout_session_status)`);
  return result[0];
}

export async function readNativeCheckout(checkoutId: string): Promise<NativeCheckoutReadModel | null> {
  const result = await getDatabase().execute<NativeCheckoutReadModel>(sql`
    select s.id::text as "id",s.store_id::text as "storeId",s.cart_id::text as "cartId",
      s.customer_id::text as "customerId",s.status,s.currency,s.request_hash as "requestHash",
      s.cart_version as "cartVersion",s.expires_at as "expiresAt",s.version,
      s.store_price_list_assignment_id::text as "storePriceListAssignmentId",
      s.store_price_list_assignment_version as "storePriceListAssignmentVersion",
      s.price_list_id::text as "priceListId",
      coalesce((select jsonb_agg(to_jsonb(i) order by i.line_number) from public.checkout_session_items i where i.checkout_session_id=s.id),'[]') as items,
      (select to_jsonb(q) from public.checkout_shipping_quotes q where q.checkout_session_id=s.id and q.is_selected) as "selectedShippingQuote",
      coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'itemId',r.checkout_session_item_id,'status',r.status,'quantity',r.quantity) order by r.id)
        from public.inventory_reservations r join public.checkout_session_items i on i.id=r.checkout_session_item_id where i.checkout_session_id=s.id),'[]') as reservations
    from public.checkout_sessions s where s.id=${checkoutId}::uuid
  `);
  return result[0] ?? null;
}
