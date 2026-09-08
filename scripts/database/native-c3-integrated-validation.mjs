import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");

const sql = postgres(localDatabaseUrl(), { max: 1, prepare: false });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rollback = "EXPECTED_P3C_DIAGNOSTIC_ROLLBACK";
let result;

try {
  await sql.begin(async (tx) => {
    const tag = randomUUID().replaceAll("-", "").slice(0, 12);
    const storeId = randomUUID(), listId = randomUUID(), productId = randomUUID();
    const variantId = randomUUID(), locationId = randomUUID(), cartId = randomUUID();
    const guestFingerprint = hash(`${tag}:guest`);

    await tx`insert into stores(id,code,name,status) values(${storeId},${`c3-${tag}`},'C3 synthetic','active')`;
    await tx`insert into price_lists(id,code,name,currency,channel,status) values(${listId},${`c3-${tag}`},'C3 synthetic','BRL','storefront','active')`;
    await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${storeId},${listId},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await tx`insert into products(id,name,slug,status,published_at) values(${productId},'C3 synthetic',${`c3-${tag}`},'active',now())`;
    await tx`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${`C3-${tag}`},'active')`;
    await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variantId},${listId},1000,'BRL',now()-interval '1 minute')`;
    await tx`insert into inventory_locations(id,code,name,status) values(${locationId},${`c3-${tag}`},'C3 synthetic','active')`;
    await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variantId},${locationId},1)`;
    await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cartId},${storeId},${guestFingerprint},now()+interval '1 hour')`;
    await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cartId},${variantId},1)`;

    const prepared = await tx`select id,status::text,version from prepare_native_checkout(${storeId},${cartId},null,${guestFingerprint},${`c3-idempotency-${tag}`},${hash(`${tag}:request`)},0,${listId},${locationId},now()+interval '30 minutes',false)`;
    assert.equal(prepared[0].status, "validating");

    const pii = canonicalizeCheckoutPii({
      contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email: "fixture@example.invalid", phone: "11912345678", personType: "fisica", taxDocument: "529.982.247-25" },
      billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
      shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
      shippingSameAsBilling: true,
    });
    const keys = { currentKeyId: () => "c3-local-v1", encryptionKey: () => Buffer.alloc(32, 31), fingerprintKey: () => Buffer.alloc(32, 32) };
    const encrypted = encryptCheckoutPii({ checkoutSessionId: prepared[0].id, storeId, envelope: pii, keys });
    const persisted = await tx`select * from persist_checkout_pii(${prepared[0].id},null,${guestFingerprint},${prepared[0].version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`;
    const ready = await tx`select id,status::text,version from mark_native_checkout_ready(${prepared[0].id},null,${guestFingerprint},${persisted[0].checkout_version},${encrypted.fingerprint})`;
    let readyMutationError = null;
    try {
      await tx.savepoint((sp) => sp`select * from persist_checkout_pii(${prepared[0].id},null,${guestFingerprint},${ready[0].version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`);
    } catch (error) { readyMutationError = error.message; }
    result = { checkoutCreationPrimitive: "prepare_native_checkout", preparedStatus: prepared[0].status, piiPersisted: persisted.length === 1, readyStatus: ready[0].status, readyMutationError, compositionPossible: ready[0].status === "ready" };
    throw new Error(rollback);
  });
} catch (error) {
  if (error.message !== rollback) throw error;
} finally {
  await sql.end({ timeout: 5 });
}

console.log(JSON.stringify(result, null, 2));
assert.equal(result.compositionPossible, true);
assert.equal(result.readyMutationError, "CHECKOUT_STATE_INVALID");
