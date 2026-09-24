import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withPersiRole } from "./nativeCommerceAuthority";
import { hashGuestCartToken } from "./nativeCart";

// Every function below runs as persi_app (lib/db/nativeCommerceAuthority.ts,
// docs/database/88) -- prepare_native_checkout, mark_native_checkout_ready,
// submit_native_checkout, canonical_native_submission_request_hash, and the
// checkout_sessions SELECT policy are all persi_app-only in the final
// migrated schema (close_native_checkout is dual-granted; kept on persi_app
// here since checkout abandonment is an app-triggered flow today).

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
  const result = await withPersiRole("persi_app", (db) => db.execute(sql`
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
  `));
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
  const result = await withPersiRole("persi_app", (db) => db.execute(sql`
    select * from public.mark_native_checkout_ready(
      ${input.checkoutId}::uuid,${input.customerId ?? null}::uuid,${guestFingerprint}::text,
      ${input.expectedVersion}::bigint,${input.expectedPiiFingerprint}::text)
  `));
  return result[0];
}

export async function closeNativeCheckout(checkoutId: string, target: "cancelled" | "expired") {
  const result = await withPersiRole("persi_app", (db) => db.execute(sql`select * from public.close_native_checkout(${checkoutId}::uuid,${target}::public.checkout_session_status)`));
  return result[0];
}

// B.3-I — native checkout -> order submission boundary. Wraps
// canonical_native_submission_request_hash + submit_native_checkout
// (supabase/migrations/20260905180000_native_checkout_atomic_submission.
// sql) — neither had a TypeScript wrapper before this round. The hash is
// ALWAYS fetched from the database (never hand-rolled in TS), matching the
// only prior calling convention for this function
// (scripts/database/native-checkout-e2-concurrency.mjs): the database is
// the single source of truth for what the checkout's current authoritative
// state canonicalizes to.
export interface NativeOrderAddressInput {
  recipient: string;
  company?: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

function toAddressJson(address: NativeOrderAddressInput) {
  return {
    recipient: address.recipient,
    company: address.company ?? null,
    street: address.street,
    number: address.number,
    complement: address.complement ?? null,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    country: address.country ?? "BR",
  };
}

export async function computeNativeCheckoutSubmissionHash(checkoutId: string, expectedVersion: bigint): Promise<string> {
  // canonical_native_submission_request_hash returns a scalar `text`, not a
  // table -- `select * from fn(...)` names that column after the function
  // itself, not "request_hash"; must alias explicitly.
  const result = await withPersiRole("persi_app", (db) => db.execute<{ requestHash: string }>(sql`
    select public.canonical_native_submission_request_hash(${checkoutId}::uuid, ${expectedVersion}::bigint) as "requestHash"
  `));
  return result[0].requestHash;
}

export interface SubmitNativeCheckoutInput {
  checkoutId: string;
  expectedVersion: bigint;
  idempotencyKey: string;
  customerId?: string | null;
  guestToken?: string;
  expectedPiiFingerprint: string;
  expectedDestinationFingerprint: string;
  orderId: string;
  correlationId: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  billingAddress: NativeOrderAddressInput;
  shippingAddress: NativeOrderAddressInput;
  taxId?: { type: "cpf" | "cnpj"; ciphertext: string; fingerprint: string; masked: string } | null;
}

export interface SubmitNativeCheckoutResult {
  [key: string]: unknown;
  orderId: string;
  orderNumber: string;
  orderStatus: "pending" | "confirmed" | "cancelled" | "completed";
  checkoutStatus: string;
  checkoutVersion: bigint;
}

// Idempotent (submit_native_checkout's own contract): the SAME checkoutId +
// idempotencyKey + submission hash always converges on the SAME native
// order, never a duplicate. Callers MUST NOT hand-roll the submission hash
// -- always resolve it via computeNativeCheckoutSubmissionHash immediately
// before calling this, against the SAME expectedVersion, so the hash
// reflects the checkout's true current state.
export async function submitNativeCheckout(input: SubmitNativeCheckoutInput): Promise<SubmitNativeCheckoutResult> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const submissionHash = await computeNativeCheckoutSubmissionHash(input.checkoutId, input.expectedVersion);
  const result = await withPersiRole("persi_app", (db) => db.execute<SubmitNativeCheckoutResult>(sql`
    select order_id::text as "orderId", order_number as "orderNumber", order_status as "orderStatus",
      checkout_status as "checkoutStatus", checkout_version as "checkoutVersion"
    from public.submit_native_checkout(
      ${input.checkoutId}::uuid, ${input.expectedVersion}::bigint, ${input.idempotencyKey}::text, ${submissionHash}::text,
      ${input.customerId ?? null}::uuid, ${guestFingerprint}::text,
      ${input.expectedPiiFingerprint}::text, ${input.expectedDestinationFingerprint}::text,
      ${input.orderId}::uuid, ${input.correlationId}::uuid,
      ${input.contactName}::text, ${input.contactEmail}::text, ${input.contactPhone ?? null}::text,
      ${JSON.stringify(toAddressJson(input.billingAddress))}::jsonb, ${JSON.stringify(toAddressJson(input.shippingAddress))}::jsonb,
      ${input.taxId?.type ?? null}::text, ${input.taxId?.ciphertext ?? null}::text,
      ${input.taxId?.fingerprint ?? null}::text, ${input.taxId?.masked ?? null}::text
    )
  `));
  return result[0];
}

export interface NativeCheckoutOwnershipRow {
  [key: string]: unknown;
  id: string;
  cartId: string;
  customerId: string | null;
  status: string;
}

// Gate 3 staging (2026-09-24): an ownership pre-check that called
// readNativeCheckout (below) purely to read owner/cartId/status failed
// closed with an unlogged 42501 -- that query joins inventory_reservations
// (line ~24 below), and persi_app has NO select grant there
// (20260902230000_native_checkout_foundation.sql:308 grants only
// checkout_sessions/checkout_session_items/checkout_shipping_quotes to
// persi_app/persi_worker). readNativeCheckout had zero real callers before
// that pre-check was added, so the gap was latent. This function touches
// only checkout_sessions -- do not widen it to join another table without
// confirming persi_app's grant first.
export async function readNativeCheckoutOwnership(checkoutId: string): Promise<NativeCheckoutOwnershipRow | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCheckoutOwnershipRow>(sql`
    select id::text as "id", cart_id::text as "cartId", customer_id::text as "customerId", status
    from public.checkout_sessions where id=${checkoutId}::uuid
  `));
  return result[0] ?? null;
}

export async function readNativeCheckout(checkoutId: string): Promise<NativeCheckoutReadModel | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCheckoutReadModel>(sql`
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
  `));
  return result[0] ?? null;
}
