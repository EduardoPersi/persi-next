import "server-only";

import { sql } from "drizzle-orm";
import {
  canonicalizeCheckoutPii,
  decryptCheckoutPii,
  encryptCheckoutPii,
  environmentCheckoutPiiKeys,
  type CanonicalCheckoutPIIEnvelope,
  type CheckoutPiiKeyProvider,
} from "@/lib/commerce/checkoutPii";
import { withPersiRole } from "./nativeCommerceAuthority";
import { hashGuestCartToken } from "./nativeCart";

// Every function below runs as persi_app (lib/db/nativeCommerceAuthority.ts,
// docs/database/88) -- persist_checkout_pii, read_checkout_pii_envelope,
// clear_checkout_pii, and the checkout_sessions SELECT policy are all
// persi_app-only.

type CheckoutOwner = { customerId: string; guestToken?: never } | { customerId?: null; guestToken: string };

type InternalCheckoutPiiRow = {
  checkoutId: string; storeId: string; checkoutVersion: bigint; piiCiphertext: string;
  piiIv: string; piiAuthTag: string; piiEnvelopeVersion: number; piiKeyId: string;
  piiFingerprint: string; piiDestinationFingerprint: string; piiExpiresAt: Date;
};

function ownerValues(owner: CheckoutOwner) {
  return {
    customerId: owner.customerId ?? null,
    guestFingerprint: owner.guestToken ? hashGuestCartToken(owner.guestToken) : null,
  };
}
export async function persistNativeCheckoutPii(input: {
  checkoutId: string;
  expectedVersion: bigint;
  owner: CheckoutOwner;
  pii: unknown;
  keys?: CheckoutPiiKeyProvider;
  now?: Date;
}) {
  const context = await withPersiRole("persi_app", (db) => db.execute<{ checkoutId: string; storeId: string; expiresAt: Date }>(sql`
    select id::text "checkoutId",store_id::text "storeId",expires_at "expiresAt"
    from public.checkout_sessions where id=${input.checkoutId}::uuid
  `));
  const checkout = context[0];
  if (!checkout) throw new Error("CHECKOUT_NOT_FOUND");
  const now = input.now ?? new Date();
  // getDatabase().execute() (drizzle-orm's postgres-js raw-execute path)
  // returns timestamptz columns as strings, not Date instances, regardless
  // of the generic type parameter passed to .execute<T>() -- that generic
  // is a compile-time assertion only, never a runtime coercion. Found here
  // because this function had ZERO callers before this round (B.3-I is the
  // first functional exercise of the checkout-PII wrapper chain); real
  // callers elsewhere in lib/db/ that only ever pass such fields back out
  // as strings (never call Date methods on them) never hit this.
  const checkoutExpiresAt = new Date(checkout.expiresAt);
  const piiExpiresAt = new Date(Math.min(checkoutExpiresAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000));
  if (piiExpiresAt.getTime() <= now.getTime()) throw new Error("CHECKOUT_PII_EXPIRED");
  const envelope = canonicalizeCheckoutPii(input.pii);
  const encrypted = encryptCheckoutPii({
    checkoutSessionId: checkout.checkoutId, storeId: checkout.storeId,
    envelope, keys: input.keys ?? environmentCheckoutPiiKeys(),
  });
  const owner = ownerValues(input.owner);
  const rows = await withPersiRole("persi_app", (db) => db.execute<{ checkoutId: string; checkoutVersion: bigint; expiresAt: Date }>(sql`
    select checkout_id::text "checkoutId",checkout_version "checkoutVersion",expires_at "expiresAt"
    from public.persist_checkout_pii(
      ${checkout.checkoutId}::uuid,${owner.customerId}::uuid,${owner.guestFingerprint}::text,
      ${input.expectedVersion}::bigint,${encrypted.ciphertext}::text,${encrypted.iv}::text,
      ${encrypted.authTag}::text,${encrypted.envelopeVersion}::integer,${encrypted.keyId}::text,
      ${encrypted.fingerprint}::text,${encrypted.destinationFingerprint}::text,${piiExpiresAt.toISOString()}::timestamptz)
  `));
  // fingerprint/destinationFingerprint are what a caller needs next
  // (mark_native_checkout_ready's expectedPiiFingerprint,
  // submit_native_checkout's expectedPiiFingerprint/
  // expectedDestinationFingerprint) — already computed above via
  // encryptCheckoutPii, just not previously returned (this function had no
  // caller before this round to notice the gap).
  return {
    checkoutId: rows[0].checkoutId, checkoutVersion: rows[0].checkoutVersion, expiresAt: rows[0].expiresAt,
    fingerprint: encrypted.fingerprint, destinationFingerprint: encrypted.destinationFingerprint, hasPii: true as const,
  };
}

export interface DecryptedNativeCheckoutPii {
  envelope: CanonicalCheckoutPIIEnvelope;
  fingerprint: string;
  destinationFingerprint: string;
}

export async function decryptNativeCheckoutPii(input: {
  checkoutId: string;
  owner: CheckoutOwner;
  keys?: CheckoutPiiKeyProvider;
  now?: Date;
}): Promise<DecryptedNativeCheckoutPii> {
  const owner = ownerValues(input.owner);
  const rows = await withPersiRole("persi_app", (db) => db.execute<InternalCheckoutPiiRow>(sql`
    select checkout_id::text "checkoutId",store_id::text "storeId",checkout_version "checkoutVersion",
      pii_ciphertext "piiCiphertext",pii_iv "piiIv",pii_auth_tag "piiAuthTag",
      pii_envelope_version "piiEnvelopeVersion",pii_key_id "piiKeyId",pii_fingerprint "piiFingerprint",
      pii_destination_fingerprint "piiDestinationFingerprint",pii_expires_at "piiExpiresAt"
    from public.read_checkout_pii_envelope(${input.checkoutId}::uuid,${owner.customerId}::uuid,${owner.guestFingerprint}::text)
  `));
  const row = rows[0];
  if (!row) throw new Error("CHECKOUT_PII_REQUIRED");
  // Same drizzle-orm postgres-js raw-execute caveat as persistNativeCheckoutPii
  // above: row.piiExpiresAt is a string at runtime despite the Date type
  // parameter, and decryptCheckoutPii calls .getTime() on it -- coerce here,
  // at the boundary, rather than push that responsibility onto every future
  // caller of this function (which, like persistNativeCheckoutPii before
  // B.3-I, had zero callers before this audit found it).
  const envelope = decryptCheckoutPii({
    checkoutSessionId: row.checkoutId, storeId: row.storeId, expiresAt: new Date(row.piiExpiresAt),
    encrypted: {
      ciphertext: row.piiCiphertext, iv: row.piiIv, authTag: row.piiAuthTag,
      envelopeVersion: row.piiEnvelopeVersion, keyId: row.piiKeyId,
      fingerprint: row.piiFingerprint, destinationFingerprint: row.piiDestinationFingerprint,
    },
    keys: input.keys ?? environmentCheckoutPiiKeys(), now: input.now,
  });
  // fingerprint/destinationFingerprint were already selected above (needed
  // internally to verify the ciphertext) but previously discarded on return
  // -- ACCELERATED-C's HTTP boundary is this function's first real caller,
  // and it needs exactly these two values to pass through to
  // submit_native_checkout's expectedPiiFingerprint/
  // expectedDestinationFingerprint unchanged, recomputing nothing.
  return { envelope, fingerprint: row.piiFingerprint, destinationFingerprint: row.piiDestinationFingerprint };
}

export async function clearNativeCheckoutPii(input: {
  checkoutId: string;
  expectedVersion: bigint;
  owner: CheckoutOwner;
}) {
  const owner = ownerValues(input.owner);
  const rows = await withPersiRole("persi_app", (db) => db.execute<{ checkoutId: string; checkoutVersion: bigint; cleared: boolean }>(sql`
    select checkout_id::text "checkoutId",checkout_version "checkoutVersion",cleared
    from public.clear_checkout_pii(${input.checkoutId}::uuid,${owner.customerId}::uuid,
      ${owner.guestFingerprint}::text,${input.expectedVersion}::bigint)
  `));
  return rows[0];
}
