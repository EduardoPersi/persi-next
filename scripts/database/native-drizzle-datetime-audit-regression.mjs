// ACCELERATED ROUND — Track B: Drizzle Date/time + error.cause audit.
// Real local Postgres. Proves the two REAL_BUG fixes this track made:
//   1. lib/db/nativeCheckoutPii.ts's decryptNativeCheckoutPii used to pass a
//      raw driver STRING (typed Date, actually a string at runtime -- see
//      getDatabase().execute()'s documented caveat) straight into
//      decryptCheckoutPii, which calls .getTime() on it -- a guaranteed
//      TypeError the first time this function was ever exercised (it had
//      zero callers before this audit).
//   2. lib/db/nativePriceAuthority.ts's resolveStorePriceAuthority/
//      readCheckoutPriceAuthority had the identical defect: valid_from/
//      valid_to come back as strings, but createAuthorityPriceFingerprint
//      (the natural downstream consumer, matched by field name) calls
//      .toISOString() on them.
// Neither function has a real production caller yet (both are dormant,
// qualified-but-unwired code, same class of gap doc 79 fixed for
// persistNativeCheckoutPii) -- this script is what would have caught both
// before a future caller does, by actually round-tripping through real
// Postgres instead of asserting on source text.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import { createNativeCart, addNativeCartItem } from "../../lib/db/nativeCart.ts";
import { prepareNativeCheckout } from "../../lib/db/nativeCheckout.ts";
import { persistNativeCheckoutPii, decryptNativeCheckoutPii } from "../../lib/db/nativeCheckoutPii.ts";
import { resolveStorePriceAuthority, createAuthorityPriceFingerprint } from "../../lib/db/nativePriceAuthority.ts";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");
if (process.env.DATABASE_URL) throw new Error("REFUSING_TO_USE_ENV_DATABASE_URL_THIS_SCRIPT_MUST_TARGET_LOCAL_ONLY");
process.env.DATABASE_URL = localDatabaseUrl();

const sql = postgres(localDatabaseUrl(), { max: 5, prepare: false });
const results = {};

// ---------- resolveStorePriceAuthority: validFrom/validTo are real Date instances, fingerprinting doesn't throw ----------
{
  const storeId = randomUUID(), listId = randomUUID(), tag = `aud-${randomUUID().slice(0, 8)}`;
  await sql`insert into stores(id,code,name,status,default_currency) values(${storeId},${tag},'Audit Store','active','BRL')`;
  await sql`insert into price_lists(id,code,name,currency,channel,status) values(${listId},${tag},'Audit List','BRL','storefront','active')`;
  await sql`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${storeId},${listId},'BRL','storefront_retail',1,now()-interval '1 day')`;

  const snapshot = await resolveStorePriceAuthority({ storeId, currency: "BRL", asOf: new Date() });
  const validFromIsDate = snapshot.validFrom instanceof Date && !Number.isNaN(snapshot.validFrom.getTime());
  const validToIsNull = snapshot.validTo === null;

  let fingerprintThrew = false;
  try {
    createAuthorityPriceFingerprint({
      storeId, commercialContext: snapshot.commercialContext, assignmentId: snapshot.assignmentId,
      assignmentVersion: snapshot.assignmentVersion, priceListId: snapshot.priceListId, currency: snapshot.currency,
      asOf: new Date(), priceId: randomUUID(), priceValidFrom: snapshot.validFrom, priceValidTo: snapshot.validTo,
      regularAmountMinor: 1000n, effectiveAmountMinor: 1000n,
    });
  } catch {
    fingerprintThrew = true;
  }
  results.resolveStorePriceAuthority_validFromIsRealDate = validFromIsDate;
  results.resolveStorePriceAuthority_validToNullHandledSafely = validToIsNull;
  results.createAuthorityPriceFingerprint_fedDirectlyFromSnapshot_doesNotThrow = !fingerprintThrew;
}

// ---------- resolveStorePriceAuthority with a non-null validTo: still a real Date, fingerprint still safe ----------
{
  const storeId = randomUUID(), listId = randomUUID(), tag = `aud-${randomUUID().slice(0, 8)}`;
  await sql`insert into stores(id,code,name,status,default_currency) values(${storeId},${tag},'Audit Store B','active','BRL')`;
  await sql`insert into price_lists(id,code,name,currency,channel,status) values(${listId},${tag},'Audit List B','BRL','storefront','active')`;
  await sql`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from,valid_to) values(${storeId},${listId},'BRL','storefront_retail',1,now()-interval '1 day',now()+interval '1 day')`;

  const snapshot = await resolveStorePriceAuthority({ storeId, currency: "BRL", asOf: new Date() });
  const validToIsDate = snapshot.validTo instanceof Date && !Number.isNaN(snapshot.validTo.getTime());
  let fingerprintThrew = false;
  try {
    createAuthorityPriceFingerprint({
      storeId, commercialContext: snapshot.commercialContext, assignmentId: snapshot.assignmentId,
      assignmentVersion: snapshot.assignmentVersion, priceListId: snapshot.priceListId, currency: snapshot.currency,
      asOf: new Date(), priceId: randomUUID(), priceValidFrom: snapshot.validFrom, priceValidTo: snapshot.validTo,
      regularAmountMinor: 1000n, effectiveAmountMinor: 1000n,
    });
  } catch {
    fingerprintThrew = true;
  }
  results.resolveStorePriceAuthority_nonNullValidToIsRealDate = validToIsDate;
  results.createAuthorityPriceFingerprint_withNonNullValidTo_doesNotThrow = !fingerprintThrew;
}

// ---------- persistNativeCheckoutPii -> decryptNativeCheckoutPii round trip: real checkout, real Postgres ----------
{
  const tag = `aud-${randomUUID().slice(0, 8)}`;
  const storeId = randomUUID(), listId = randomUUID(), locationId = randomUUID(), productId = randomUUID(), variantId = randomUUID();
  await sql`insert into stores(id,code,name,status,default_currency) values(${storeId},${tag},'Audit Checkout Store','active','BRL')`;
  await sql`insert into price_lists(id,code,name,currency,channel,status) values(${listId},${tag},'Audit Checkout List','BRL','storefront','active')`;
  await sql`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${storeId},${listId},'BRL','storefront_retail',1,now()-interval '1 day')`;
  await sql`insert into inventory_locations(id,code,name,status) values(${locationId},${tag},'Audit Checkout Location','active')`;
  await sql`insert into products(id,name,slug,status) values(${productId},'Audit Checkout Product',${tag},'draft')`;
  await sql`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${tag.toUpperCase()},'active')`;
  await sql`update products set status='active', published_at=now() where id=${productId}`;
  await sql`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variantId},${listId},5000,'BRL',now()-interval '1 hour')`;
  await sql`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variantId},${locationId},10)`;

  const guestToken = "g".repeat(40) + tag;
  const cart = await createNativeCart({ storeId, guestToken, currency: "BRL", expiresAt: new Date(Date.now() + 2 * 3_600_000) });
  await addNativeCartItem({ cartId: cart.id, guestToken, productVariantId: variantId, quantity: 1n });
  const [cartState] = await sql`select version from carts where id = ${cart.id}`;

  const checkout = await prepareNativeCheckout({
    storeId, cartId: cart.id, customerId: null, cartVersion: cartState.version, priceListId: listId, inventoryLocationId: locationId,
    currency: "BRL", shippingRequired: false, idempotencyKey: randomUUID().replace(/-/g, ""), expiresAt: new Date(Date.now() + 1_800_000), guestToken,
  });

  const keys = { currentKeyId: () => "audit-v1", encryptionKey: () => Buffer.alloc(32, 61), fingerprintKey: () => Buffer.alloc(32, 62) };
  const pii = {
    contact: { firstName: "Pessoa", lastName: "Auditoria", company: "", email: `${tag}@example.invalid`, phone: "11912345678", personType: "fisica", taxDocument: "52998224725" },
    billing: { recipient: "Pessoa Auditoria", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
    shipping: { recipient: "Pessoa Auditoria", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
    shippingSameAsBilling: true,
  };

  await persistNativeCheckoutPii({ checkoutId: checkout.id, expectedVersion: checkout.version, owner: { guestToken }, pii, keys, now: new Date() });

  let decryptThrew = false, decryptedMatches = false;
  try {
    const decrypted = await decryptNativeCheckoutPii({ checkoutId: checkout.id, owner: { guestToken }, keys, now: new Date() });
    decryptedMatches = decrypted.envelope.contact.email === pii.contact.email && decrypted.envelope.billing.street === pii.billing.street
      && typeof decrypted.fingerprint === "string" && typeof decrypted.destinationFingerprint === "string";
  } catch {
    decryptThrew = true;
  }
  results.decryptNativeCheckoutPii_doesNotThrowOnRealRow = !decryptThrew;
  results.decryptNativeCheckoutPii_roundTripMatchesOriginal = decryptedMatches;
}

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every((value) => value === true);
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
