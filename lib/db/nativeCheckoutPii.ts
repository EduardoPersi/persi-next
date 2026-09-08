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
import { getDatabase } from "./connection";
import { hashGuestCartToken } from "./nativeCart";

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
  const db = getDatabase();
  const context = await db.execute<{ checkoutId: string; storeId: string; expiresAt: Date }>(sql`
    select id::text "checkoutId",store_id::text "storeId",expires_at "expiresAt"
    from public.checkout_sessions where id=${input.checkoutId}::uuid
  `);
  const checkout = context[0];
  if (!checkout) throw new Error("CHECKOUT_NOT_FOUND");
  const now = input.now ?? new Date();
  const piiExpiresAt = new Date(Math.min(checkout.expiresAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000));
  if (piiExpiresAt.getTime() <= now.getTime()) throw new Error("CHECKOUT_PII_EXPIRED");
  const envelope = canonicalizeCheckoutPii(input.pii);
  const encrypted = encryptCheckoutPii({
    checkoutSessionId: checkout.checkoutId, storeId: checkout.storeId,
    envelope, keys: input.keys ?? environmentCheckoutPiiKeys(),
  });
  const owner = ownerValues(input.owner);
  const rows = await db.execute<{ checkoutId: string; checkoutVersion: bigint; expiresAt: Date }>(sql`
    select checkout_id::text "checkoutId",checkout_version "checkoutVersion",expires_at "expiresAt"
    from public.persist_checkout_pii(
      ${checkout.checkoutId}::uuid,${owner.customerId}::uuid,${owner.guestFingerprint}::text,
      ${input.expectedVersion}::bigint,${encrypted.ciphertext}::text,${encrypted.iv}::text,
      ${encrypted.authTag}::text,${encrypted.envelopeVersion}::integer,${encrypted.keyId}::text,
      ${encrypted.fingerprint}::text,${encrypted.destinationFingerprint}::text,${piiExpiresAt.toISOString()}::timestamptz)
  `);
  return { checkoutId: rows[0].checkoutId, checkoutVersion: rows[0].checkoutVersion, expiresAt: rows[0].expiresAt, hasPii: true as const };
}

export async function decryptNativeCheckoutPii(input: {
  checkoutId: string;
  owner: CheckoutOwner;
  keys?: CheckoutPiiKeyProvider;
  now?: Date;
}): Promise<CanonicalCheckoutPIIEnvelope> {
  const owner = ownerValues(input.owner);
  const rows = await getDatabase().execute<InternalCheckoutPiiRow>(sql`
    select checkout_id::text "checkoutId",store_id::text "storeId",checkout_version "checkoutVersion",
      pii_ciphertext "piiCiphertext",pii_iv "piiIv",pii_auth_tag "piiAuthTag",
      pii_envelope_version "piiEnvelopeVersion",pii_key_id "piiKeyId",pii_fingerprint "piiFingerprint",
      pii_destination_fingerprint "piiDestinationFingerprint",pii_expires_at "piiExpiresAt"
    from public.read_checkout_pii_envelope(${input.checkoutId}::uuid,${owner.customerId}::uuid,${owner.guestFingerprint}::text)
  `);
  const row = rows[0];
  if (!row) throw new Error("CHECKOUT_PII_REQUIRED");
  return decryptCheckoutPii({
    checkoutSessionId: row.checkoutId, storeId: row.storeId, expiresAt: row.piiExpiresAt,
    encrypted: {
      ciphertext: row.piiCiphertext, iv: row.piiIv, authTag: row.piiAuthTag,
      envelopeVersion: row.piiEnvelopeVersion, keyId: row.piiKeyId,
      fingerprint: row.piiFingerprint, destinationFingerprint: row.piiDestinationFingerprint,
    },
    keys: input.keys ?? environmentCheckoutPiiKeys(), now: input.now,
  });
}

export async function clearNativeCheckoutPii(input: {
  checkoutId: string;
  expectedVersion: bigint;
  owner: CheckoutOwner;
}) {
  const owner = ownerValues(input.owner);
  const rows = await getDatabase().execute<{ checkoutId: string; checkoutVersion: bigint; cleared: boolean }>(sql`
    select checkout_id::text "checkoutId",checkout_version "checkoutVersion",cleared
    from public.clear_checkout_pii(${input.checkoutId}::uuid,${owner.customerId}::uuid,
      ${owner.guestFingerprint}::text,${input.expectedVersion}::bigint)
  `);
  return rows[0];
}
