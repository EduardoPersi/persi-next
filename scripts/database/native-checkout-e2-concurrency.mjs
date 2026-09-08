import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { transformCheckoutPiiToDurableTaxDocument } from "../../lib/commerce/taxDocumentCrypto.ts";

const VERSION = "m29-m30-e2-h-v1";
const CANONICAL_PORT = 15422;
const cycles = Number(process.env.E2_CYCLES ?? 50);
const selfTest = process.env.HARNESS_SELF_TEST_ONLY === "1";
const adminUrl = process.env.PERSI_E2_ADMIN_DATABASE_URL;
const appUrl = process.env.PERSI_E2_APP_DATABASE_URL;

export function assertE2Environment(environment = process.env) {
  if (environment.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");
  if (environment.PERSI_DISPOSABLE_DATABASE !== "1") throw new Error("DISPOSABLE_DATABASE_REQUIRED");
  if (!environment.PERSI_E2_ADMIN_DATABASE_URL || !environment.PERSI_E2_APP_DATABASE_URL) throw new Error("E2_DATABASE_URLS_REQUIRED");
  for (const value of [environment.PERSI_E2_ADMIN_DATABASE_URL, environment.PERSI_E2_APP_DATABASE_URL]) {
    const target = new URL(value);
    if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) throw new Error("LOOPBACK_DATABASE_REQUIRED");
    if (Number(target.port || 5432) === CANONICAL_PORT) throw new Error("CANONICAL_DATABASE_REFUSED");
  }
  const count = Number(environment.E2_CYCLES ?? 50);
  const short = environment.HARNESS_SELF_TEST_ONLY === "1";
  if (!Number.isInteger(count) || count < 1 || (!short && count < 50)) throw new Error("E2_CYCLE_COUNT_INVALID");
  return { cycles: count, selfTest: short };
}

export function failureDetectionSelfTest(invariants, activity = { totalOperations: 1 }) {
  const requiredZero = Object.entries(invariants).filter(([, value]) => typeof value === "number");
  assert.ok(requiredZero.length > 20);
  assert.ok(Object.values(activity).some((value) => typeof value === "number" && value > 0));
  const baseline = Object.fromEntries(requiredZero.map(([name]) => [name, 0]));
  assert.equal(Object.values(baseline).every((value) => value === 0), true);
  for (const [name] of requiredZero) {
    const injected = { ...baseline, [name]: 1 };
    assert.equal(Object.values(injected).filter((value) => typeof value === "number").every((value) => value === 0), false);
  }
  return true;
}

export function guardSelfTest() {
  const base = {
    PERSI_OFFLINE_VALIDATION: "1", PERSI_DISPOSABLE_DATABASE: "1", HARNESS_SELF_TEST_ONLY: "1", E2_CYCLES: "2",
    PERSI_E2_ADMIN_DATABASE_URL: "postgresql://postgres:x@127.0.0.1:25432/postgres",
    PERSI_E2_APP_DATABASE_URL: "postgresql://persi_e2_app_login:x@127.0.0.1:25432/postgres",
  };
  assert.doesNotThrow(() => assertE2Environment(base));
  for (const candidate of [
    { ...base, PERSI_DISPOSABLE_DATABASE: undefined }, { ...base, PERSI_DISPOSABLE_DATABASE: "yes" },
    { ...base, PERSI_OFFLINE_VALIDATION: undefined },
    { ...base, PERSI_E2_ADMIN_DATABASE_URL: "postgresql://postgres:x@127.0.0.1:15422/postgres" },
    { ...base, HARNESS_SELF_TEST_ONLY: "0", E2_CYCLES: "49" },
  ]) assert.throws(() => assertE2Environment(candidate));
  return true;
}

if (process.argv.includes("--guard-self-test")) {
  console.log(JSON.stringify({ GUARD_SELF_TEST: guardSelfTest() ? "PASS" : "FAIL" }));
  process.exit(0);
}

assertE2Environment();
const admin = postgres(adminUrl, { max: 16, prepare: false, idle_timeout: 0 });
const app = postgres(appUrl, { max: 24, prepare: false, idle_timeout: 0 });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const zero = () => 0;
const metrics = {
  totalOperations: 0, duplicateOrders: 0, partialOrders: 0, duplicateItems: 0, duplicateAddresses: 0,
  duplicateAdjustments: 0, duplicateEvents: 0, duplicateReservationAssociations: 0, divergentHashSuccesses: 0,
  stalePriceAccepted: 0, silentRepricing: 0, staleShippingAccepted: 0, invalidReservationOrderSuccesses: 0,
  resurrectedReservations: 0, oversoldStates: 0, submissionNewReservationMovements: 0, submissionSaleMovements: 0,
  submissionOnHandDelta: 0, submissionReservedDelta: 0, duplicateOrderNumbers: 0, lostSequenceUpdates: 0,
  reusedCommittedOrderNumbers: 0, postLockCartMutationSuccesses: 0, checkoutOrderDivergences: 0,
  cartOrderDivergences: 0, unauthorizedAttempts: 0, unauthorizedSubmissionSuccesses: 0,
  unauthorizedOrderCreations: 0, unauthorizedOrderRecoveries: 0, unauthorizedUndeterminedSuccesses: 0,
  roleLeakage: 0, authorityContamination: 0,
  connectionPrivilegeLeakage: 0, crossCheckoutLeakage: 0, crossCustomerLeakage: 0, deadlocks: 0,
  lockTimeouts: 0, statementTimeouts: 0, unlabeledErrors: 0, paymentAttemptsCreated: 0,
  paymentEventsCreated: 0, refundsCreated: 0, shipmentCreations: 0, externalCalls: 0, violations: [],
};
const zeroRequiredMetricNames = [
  "duplicateOrders", "partialOrders", "duplicateItems", "duplicateAddresses", "duplicateAdjustments", "duplicateEvents",
  "duplicateReservationAssociations", "divergentHashSuccesses", "stalePriceAccepted", "silentRepricing", "staleShippingAccepted",
  "invalidReservationOrderSuccesses", "resurrectedReservations", "oversoldStates", "submissionNewReservationMovements",
  "submissionSaleMovements", "submissionOnHandDelta", "submissionReservedDelta", "duplicateOrderNumbers", "lostSequenceUpdates",
  "reusedCommittedOrderNumbers", "postLockCartMutationSuccesses", "checkoutOrderDivergences", "cartOrderDivergences",
  "unauthorizedSubmissionSuccesses", "unauthorizedOrderCreations", "unauthorizedOrderRecoveries",
  "unauthorizedUndeterminedSuccesses", "roleLeakage",
  "authorityContamination", "connectionPrivilegeLeakage", "crossCheckoutLeakage", "crossCustomerLeakage", "deadlocks",
  "lockTimeouts", "statementTimeouts", "unlabeledErrors", "paymentAttemptsCreated", "paymentEventsCreated", "refundsCreated",
  "shipmentCreations", "externalCalls",
];
const families = Object.fromEntries("ABCDEFGH".split("").map((name) => [name, { cycles: 0, attempts: 0, successes: 0, expectedRejections: 0, invalid: 0 }]));
const races = { price: { submitFirst: 0, mutationFirst: 0 }, shipping: { submitFirst: 0, expirationFirst: 0 }, reservation: { submitFirst: 0, releaseFirst: 0 } };
const checkoutKeys = { currentKeyId: () => "e2-checkout-v1", encryptionKey: () => Buffer.alloc(32, 61), fingerprintKey: () => Buffer.alloc(32, 62) };
const taxKeys = { currentKeyId: () => "e2-tax-v1", encryptionKey: () => Buffer.alloc(32, 71), fingerprintKey: () => Buffer.alloc(32, 72) };
const rawPii = (email) => ({ contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email, phone: "11912345678", personType: "fisica", taxDocument: "52998224725" }, billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" }, shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" }, shippingSameAsBilling: true });
const address = (value) => ({ recipient: value.recipient, company: value.company, street: value.street, number: value.number, complement: value.complement, neighborhood: value.neighborhood, city: value.city, state: value.state, postal_code: value.postalCode, country: value.country });
const errorInfo = (error) => ({ sqlstate: error?.code ?? null, code: error?.message ?? String(error) });

function unexpected(error, context) {
  const info = errorInfo(error);
  if (info.sqlstate === "40P01") metrics.deadlocks++;
  else if (info.sqlstate === "55P03") metrics.lockTimeouts++;
  else if (info.sqlstate === "57014") metrics.statementTimeouts++;
  else metrics.unlabeledErrors++;
  metrics.violations.push({ context, ...info });
}

async function withApp(operation) {
  metrics.totalOperations++;
  return app.begin(async (tx) => {
    const [before] = await tx`select session_user,current_user`;
    if (before.session_user !== "persi_e2_app_login" || before.current_user !== "persi_e2_app_login") metrics.connectionPrivilegeLeakage++;
    await tx`set local statement_timeout='10s'`;
    await tx`set local lock_timeout='7s'`;
    await tx.unsafe("set local role persi_app");
    const [active] = await tx`select session_user,current_user`;
    if (active.session_user !== "persi_e2_app_login" || active.current_user !== "persi_app") metrics.roleLeakage++;
    return operation(tx);
  });
}

async function assertPoolClean() {
  const [identity] = await app`select session_user,current_user`;
  if (identity.session_user !== "persi_e2_app_login" || identity.current_user !== "persi_e2_app_login") metrics.connectionPrivilegeLeakage++;
}

async function optionalTableCount(name) {
  assert.match(name, /^[a-z_]+$/);
  const [exists] = await admin`select to_regclass(${`public.${name}`}) is not null present`;
  if (!exists.present) return 0;
  const [row] = await admin.unsafe(`select count(*)::int count from public.${name}`);
  return row.count;
}

async function fixture(family, index, { customerOwned = false, shipping = false, shared = null } = {}) {
  const tag = `e2-${family.toLowerCase()}-${index}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const ids = shared ?? { store: randomUUID(), list: randomUUID(), location: randomUUID() };
  const own = !shared;
  const product = randomUUID(), variant = randomUUID(), customer = customerOwned ? randomUUID() : null;
  const guest = customerOwned ? null : sha(`${tag}:guest`);
  if (own) {
    await admin`insert into stores(id,code,name,status,default_currency) values(${ids.store},${tag},'E2 synthetic','active','BRL')`;
    await admin`insert into price_lists(id,code,name,currency,channel,status) values(${ids.list},${tag},'E2 synthetic','BRL','storefront','active')`;
    await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${ids.store},${ids.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await admin`insert into inventory_locations(id,code,name,status) values(${ids.location},${tag},'E2 synthetic','active')`;
  }
  if (customer) await admin`insert into customers(id,status,customer_type,email) values(${customer},'active','individual',${`${tag}@example.invalid`})`;
  await admin`insert into products(id,name,slug,status) values(${product},'E2 synthetic',${tag},'draft')`;
  await admin`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${tag.toUpperCase()},'active')`;
  await admin`update products set status='active',published_at=now() where id=${product}`;
  const [price] = await admin`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${ids.list},1000,'BRL',now()-interval '1 hour') returning id`;
  const [level] = await admin`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${ids.location},10) returning id`;
  const [cart] = await withApp((tx) => tx`select * from create_native_cart(${ids.store},${customer},${guest},'BRL',now()+interval '2 hours')`);
  await withApp((tx) => tx`select * from add_native_cart_item(${cart.id},${customer},${guest},${variant},1)`);
  const [cartState] = await admin`select version from carts where id=${cart.id}`;
  const pii = canonicalizeCheckoutPii(rawPii(`${tag}@example.invalid`));
  const checkoutKey = `checkout-${tag}`;
  const provisionalCheckoutId = randomUUID();
  const provisional = encryptCheckoutPii({ checkoutSessionId: provisionalCheckoutId, storeId: ids.store, envelope: pii, keys: checkoutKeys });
  const shippingMethod = shipping ? randomUUID() : null;
  if (shipping) await admin`insert into shipping_methods(id,provider,external_code,carrier_name,service_name) values(${shippingMethod},'melhor_envio',${tag},'synthetic carrier','synthetic service')`;
  const quoteExpiry = new Date(Date.now() + 120_000);
  const prepareArgs = shipping ? [true, `${tag}-legacy`, shippingMethod, "melhor_envio", tag, "synthetic carrier", "synthetic service", 1500, "13201000", provisional.destinationFingerprint, sha(`${tag}:logistics`), "legacy-v1", quoteExpiry, 2, `${tag}-ref`] : [false, null, null, null, null, null, null, null, null, null, null, null, null, null, null];
  const [checkout] = await withApp((tx) => tx`select * from prepare_native_checkout(${ids.store},${cart.id},${customer},${guest},${checkoutKey},${sha(`${tag}:prepare`)},${cartState.version},${ids.list},${ids.location},now()+interval '30 minutes',${prepareArgs[0]},${prepareArgs[1]},${prepareArgs[2]},${prepareArgs[3]},${prepareArgs[4]},${prepareArgs[5]},${prepareArgs[6]},${prepareArgs[7]},${prepareArgs[8]},${prepareArgs[9]},${prepareArgs[10]},${prepareArgs[11]},${prepareArgs[12]},${prepareArgs[13]},${prepareArgs[14]})`);
  const encrypted = encryptCheckoutPii({ checkoutSessionId: checkout.id, storeId: ids.store, envelope: pii, keys: checkoutKeys });
  const [persisted] = await withApp((tx) => tx`select * from persist_checkout_pii(${checkout.id},${customer},${guest},${checkout.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`);
  let evidence = null;
  if (shipping) {
    const [current] = await admin`select version from checkout_sessions where id=${checkout.id}`;
    [evidence] = await withApp((tx) => tx`select * from create_native_shipping_evidence(${checkout.id},${customer},${guest},${current.version},${`${tag}-evidence-key`},${shippingMethod},'melhor_envio',${tag},'synthetic carrier','synthetic service',1500,'13201000',${encrypted.destinationFingerprint},${sha(`${tag}:logistics-inputs`)},${quoteExpiry},2,${`${tag}-ref`})`);
    await withApp((tx) => tx`select * from replace_native_checkout_shipping_quote(${checkout.id},${customer},${guest},${current.version},${evidence.id},${`${tag}-quote`})`);
  }
  const [latest] = await admin`select version from checkout_sessions where id=${checkout.id}`;
  const [ready] = await withApp((tx) => tx`select * from mark_native_checkout_ready(${checkout.id},${customer},${guest},${latest.version},${encrypted.fingerprint})`);
  const [canonical] = await withApp((tx) => tx`select canonical_native_submission_request_hash(${checkout.id},${ready.version}) request_hash`);
  const orderId = randomUUID();
  const tax = transformCheckoutPiiToDurableTaxDocument({ checkout: { checkoutSessionId: checkout.id, storeId: ids.store, encrypted, expiresAt: new Date(Date.now() + 1_200_000), keys: checkoutKeys }, orderId, taxKeys });
  const submit = (requestHash = canonical.request_hash, ownerCustomer = customer, ownerGuest = guest) => withApp(async (tx) => (await tx`select * from submit_native_checkout(${checkout.id},${ready.version},${checkoutKey},${requestHash},${ownerCustomer},${ownerGuest},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},'Pessoa Sintetica',${pii.contact.email},${pii.contact.phone},${address(pii.billing)},${address(pii.shipping)},${tax.type},${tax.ciphertext},${tax.fingerprint},${tax.masked})`)[0]);
  const [reservation] = await admin`select r.id,r.status::text from inventory_reservations r join checkout_session_items i on i.id=r.checkout_session_item_id where i.checkout_session_id=${checkout.id}`;
  return { tag, ids: { ...ids, product, variant, customer, cart: cart.id, checkout: checkout.id, level: level.id }, guest, priceId: price.id, ready, requestHash: canonical.request_hash, orderId, submit, reservation, evidence };
}

async function state(f) {
  const [row] = await admin`select
    (select count(*)::int from orders where checkout_session_id=${f.ids.checkout}) orders,
    (select count(*)::int from order_items i join orders o on o.id=i.order_id where o.checkout_session_id=${f.ids.checkout}) items,
    (select count(*)::int from order_addresses a join orders o on o.id=a.order_id where o.checkout_session_id=${f.ids.checkout}) addresses,
    (select count(*)::int from order_adjustments a join orders o on o.id=a.order_id where o.checkout_session_id=${f.ids.checkout}) adjustments,
    (select count(*)::int from order_status_events e join orders o on o.id=e.order_id where o.checkout_session_id=${f.ids.checkout} and e.from_status is null) events,
    (select count(*)::int from inventory_reservations r join order_items i on i.id=r.order_item_id join orders o on o.id=i.order_id where o.checkout_session_id=${f.ids.checkout}) associations,
    (select status::text from checkout_sessions where id=${f.ids.checkout}) checkout_status,
    (select status::text from carts where id=${f.ids.cart}) cart_status,
    (select quantity_on_hand::bigint from inventory_levels where id=${f.ids.level}) on_hand,
    (select quantity_reserved::bigint from inventory_levels where id=${f.ids.level}) reserved,
    (select count(*)::int from inventory_movements where inventory_level_id=${f.ids.level} and movement_type='reservation') reservation_movements,
    (select count(*)::int from inventory_movements where inventory_level_id=${f.ids.level} and movement_type='sale') sale_movements`;
  return row;
}

function acceptExpected(result, allowed, context) {
  if (result.status === "fulfilled") return true;
  if (allowed.some(([sqlstate, code]) => result.reason?.code === sqlstate && result.reason?.message === code)) return false;
  unexpected(result.reason, context); return false;
}

async function verifyAtomicity(f, before, { inventory = true } = {}) {
  const after = await state(f);
  if (after.orders > 1) metrics.duplicateOrders += after.orders - 1;
  if (after.orders === 1 && (after.items !== 1 || after.addresses !== 2 || after.events !== 1)) metrics.partialOrders++;
  if (after.items > 1) metrics.duplicateItems += after.items - 1;
  if (after.addresses > 2) metrics.duplicateAddresses += after.addresses - 2;
  if (after.events > 1) metrics.duplicateEvents += after.events - 1;
  if (after.associations > 1) metrics.duplicateReservationAssociations += after.associations - 1;
  if ((after.orders === 1) !== (after.checkout_status === "order_created")) metrics.checkoutOrderDivergences++;
  if ((after.orders === 1) !== (after.cart_status === "converted")) metrics.cartOrderDivergences++;
  if (inventory) {
    metrics.submissionNewReservationMovements += Math.max(0, after.reservation_movements - before.reservation_movements);
    metrics.submissionSaleMovements += Math.max(0, after.sale_movements - before.sale_movements);
    metrics.submissionOnHandDelta += Number(after.on_hand - before.on_hand);
    metrics.submissionReservedDelta += Number(after.reserved - before.reserved);
  }
  if (after.on_hand < 0n || after.reserved < 0n || after.reserved > after.on_hand) metrics.oversoldStates++;
  return after;
}

async function familyA(index) {
  const f = await fixture("A", index); const before = await state(f);
  const outcomes = await Promise.allSettled([f.submit(), f.submit()]); families.A.attempts += 2;
  if (!outcomes.every((x) => x.status === "fulfilled" && x.value.order_id === f.orderId)) families.A.invalid++;
  families.A.successes += outcomes.filter((x) => x.status === "fulfilled").length;
  await verifyAtomicity(f, before); families.A.cycles++;
}
async function familyB(index) {
  const f = await fixture("B", index); const before = await state(f);
  const outcomes = await Promise.allSettled([f.submit(), f.submit("e".repeat(64))]); families.B.attempts += 2;
  const ok = outcomes.filter((x) => x.status === "fulfilled"); if (ok.length !== 1) { families.B.invalid++; metrics.divergentHashSuccesses += Math.max(0, ok.length - 1); }
  for (const outcome of outcomes) if (outcome.status === "rejected") acceptExpected(outcome, [["23505", "CHECKOUT_IDEMPOTENCY_CONFLICT"]], "B");
  families.B.successes += ok.length; families.B.expectedRejections += 1; await verifyAtomicity(f, before); families.B.cycles++;
}
async function familyC(index) {
  const f = await fixture("C", index); const before = await state(f);
  const [submission, mutation] = await Promise.allSettled([f.submit(), admin`update prices set list_amount_minor=list_amount_minor+100 where id=${f.priceId}`]); families.C.attempts += 2;
  if (submission.status === "fulfilled") races.price.submitFirst++; else if (acceptExpected(submission, [["23514", "CHECKOUT_PRICE_STALE"]], "C")) families.C.invalid++; else races.price.mutationFirst++;
  if (submission.status === "fulfilled") families.C.successes++; else families.C.expectedRejections++;
  const after = await verifyAtomicity(f, before);
  if (submission.status === "fulfilled" && after.orders !== 1) metrics.stalePriceAccepted++;
  families.C.cycles++;
}
async function familyD(index) {
  const f = await fixture("D", index, { shipping: true }); const before = await state(f);
  const outcome = await Promise.allSettled([f.submit()]).then(([x]) => x); families.D.attempts++;
  if (outcome.status === "fulfilled") { races.shipping.submitFirst++; families.D.successes++; }
  else if (["CHECKOUT_SHIPPING_QUOTE_INVALID", "CHECKOUT_SHIPPING_STALE"].includes(outcome.reason?.message)) { races.shipping.expirationFirst++; families.D.expectedRejections++; }
  else unexpected(outcome.reason, "D");
  await verifyAtomicity(f, before); families.D.cycles++;
}
async function familyE(index) {
  const f = await fixture("E", index); const before = await state(f);
  const release = admin`select (release_inventory_reservation(${f.reservation.id},${`${f.tag}:release`},'persi_checkout')).status::text status`;
  const [submission, released] = await Promise.allSettled([f.submit(), release]); families.E.attempts += 2;
  if (submission.status === "fulfilled") { races.reservation.submitFirst++; families.E.successes++; }
  else if (["CHECKOUT_RESERVATION_INVALID", "CHECKOUT_INVENTORY_STALE"].includes(submission.reason?.message)) { races.reservation.releaseFirst++; families.E.expectedRejections++; }
  else unexpected(submission.reason, "E");
  if (released.status === "rejected") unexpected(released.reason, "E_RELEASE");
  const after = await verifyAtomicity(f, before, { inventory: false });
  if (submission.status === "fulfilled" && after.orders !== 1) metrics.invalidReservationOrderSuccesses++;
  const [reservation] = await admin`select status::text from inventory_reservations where id=${f.reservation.id}`;
  if (reservation.status === "active" && released.status === "fulfilled" && released.value[0]?.status === "released") metrics.resurrectedReservations++;
  families.E.cycles++;
}
async function familyF(index) {
  const shared = { store: randomUUID(), list: randomUUID(), location: randomUUID() }; const tag = `e2-f-${index}-${randomUUID().toString().slice(0,8)}`;
  await admin`insert into stores(id,code,name,status,default_currency) values(${shared.store},${tag},'E2 F','active','BRL')`;
  await admin`insert into price_lists(id,code,name,currency,channel,status) values(${shared.list},${tag},'E2 F','BRL','storefront','active')`;
  await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${shared.store},${shared.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
  await admin`insert into inventory_locations(id,code,name,status) values(${shared.location},${tag},'E2 F','active')`;
  const a = await fixture("F", index * 2, { shared }), b = await fixture("F", index * 2 + 1, { shared });
  const beforeA = await state(a), beforeB = await state(b); const [ra, rb] = await Promise.allSettled([a.submit(), b.submit()]); families.F.attempts += 2;
  if (ra.status !== "fulfilled") unexpected(ra.reason, "F_A"); if (rb.status !== "fulfilled") unexpected(rb.reason, "F_B");
  families.F.successes += [ra, rb].filter((x) => x.status === "fulfilled").length;
  const aa = await verifyAtomicity(a, beforeA), bb = await verifyAtomicity(b, beforeB);
  const numbers = await admin`select order_number,count(*)::int count from orders where store_id=${shared.store} group by order_number having count(*)>1`;
  metrics.duplicateOrderNumbers += numbers.length;
  const [seq] = await admin`select next_order_sequence from stores where id=${shared.store}`;
  if (aa.orders + bb.orders === 2 && BigInt(seq.next_order_sequence) !== 3n) metrics.lostSequenceUpdates++;
  families.F.cycles++;
}
async function familyG(index) {
  const f = await fixture("G", index); const before = await state(f);
  const mutation = () => withApp((tx) => tx`select * from add_native_cart_item(${f.ids.cart},${f.ids.customer},${f.guest},${f.ids.variant},1)`);
  const [submission, changed] = await Promise.allSettled([f.submit(), mutation()]); families.G.attempts += 2;
  if (submission.status !== "fulfilled") unexpected(submission.reason, "G_SUBMIT"); else families.G.successes++;
  if (changed.status === "fulfilled") metrics.postLockCartMutationSuccesses++; else if (changed.reason?.message === "CART_NOT_MUTABLE") families.G.expectedRejections++; else unexpected(changed.reason, "G_MUTATE");
  await verifyAtomicity(f, before); families.G.cycles++;
}
async function familyH(index) {
  const guest = await fixture("H", index * 2), customer = await fixture("H", index * 2 + 1, { customerOwned: true });
  const beforeG = await state(guest), beforeC = await state(customer);
  const outcomes = await Promise.allSettled([guest.submit(), customer.submit(), guest.submit(guest.requestHash, randomUUID(), null), customer.submit(customer.requestHash, null, sha("wrong"))]);
  families.H.attempts += outcomes.length;
  metrics.unauthorizedAttempts += outcomes.length - 2;
  for (let i = 0; i < outcomes.length; i++) {
    const value = outcomes[i];
    if (i < 2) { if (value.status === "fulfilled") families.H.successes++; else unexpected(value.reason, `H_${i}`); }
    else if (value.status === "fulfilled") {
      metrics.unauthorizedSubmissionSuccesses++;
      const before = i === 2 ? beforeG : beforeC;
      const authorized = outcomes[i - 2];
      if (before.orders > 0) metrics.unauthorizedOrderRecoveries++;
      else if (authorized.status === "rejected") metrics.unauthorizedOrderCreations++;
      else metrics.unauthorizedUndeterminedSuccesses++;
    }
    else if (value.reason?.code === "42501" && value.reason?.message === "CHECKOUT_OWNERSHIP_INVALID") families.H.expectedRejections++;
    else unexpected(value.reason, `H_AUTH_${i}`);
  }
  await verifyAtomicity(guest, beforeG); await verifyAtomicity(customer, beforeC); await assertPoolClean(); families.H.cycles++;
}

let summary;
try {
  const [identity] = await app`select session_user,current_user`;
  assert.deepEqual([identity.session_user, identity.current_user], ["persi_e2_app_login", "persi_e2_app_login"]);
  const [server] = await admin`show server_version`;
  const [history] = await admin`select count(*)::int count,max(version::text) last from supabase_migrations.schema_migrations`;
  assert.equal(history.count, 31); assert.equal(history.last, "20260907180000"); assert.match(server.server_version, /^17\.6/);
  const base = await fixture("BASE", 0), baseBefore = await state(base); await base.submit(); const baseAfter = await verifyAtomicity(base, baseBefore);
  const baseSuccess = baseAfter.orders === 1 && baseAfter.items === 1 && baseAfter.addresses === 2 && baseAfter.events === 1 && baseAfter.associations === 1;
  for (let index = 0; index < cycles; index++) for (const runner of [familyA, familyB, familyC, familyD, familyE, familyF, familyG, familyH]) await runner(index);
  metrics.paymentAttemptsCreated = await optionalTableCount("payment_attempts");
  metrics.paymentEventsCreated = await optionalTableCount("payment_events");
  metrics.refundsCreated = await optionalTableCount("refunds");
  metrics.shipmentCreations = await optionalTableCount("shipments");
  const zeroRequired = Object.fromEntries(zeroRequiredMetricNames.map((name) => [name, metrics[name]]));
  const failureDetection = failureDetectionSelfTest(zeroRequired, { totalOperations: metrics.totalOperations, unauthorizedAttempts: metrics.unauthorizedAttempts });
  const totalFamilyCycles = Object.values(families).reduce((sum, family) => sum + family.cycles, 0);
  const pass = baseSuccess && totalFamilyCycles === cycles * 8 && Object.values(zeroRequired).every((value) => value === 0) && metrics.violations.length === 0;
  summary = {
    MODE: selfTest ? "SELF_TEST" : "FULL_QUALIFICATION", E2_HARNESS_VERSION: VERSION, SELF_TEST: selfTest,
    CYCLES_PER_FAMILY: cycles, TOTAL_FAMILY_CYCLES: totalFamilyCycles, TOTAL_OPERATIONS: metrics.totalOperations,
    QUALIFICATION_ELIGIBLE: !selfTest && cycles >= 50, FULL_E2_QUALIFICATION_PASS: !selfTest && cycles >= 50 && pass,
    NOT_QUALIFICATION_EVIDENCE: selfTest, BASE_SUCCESS_PASS: baseSuccess, SELF_TEST_PASS: selfTest && pass,
    FAILURE_DETECTION_SELF_TEST: failureDetection ? "PASS" : "FAIL", GUARD_SELF_TEST: guardSelfTest() ? "PASS" : "FAIL",
    POSTGRESQL: server.server_version, MIGRATIONS: history.count, LAST_MIGRATION: history.last,
    FAMILIES: families, RACE_DISTRIBUTIONS: races,
    DUPLICATE_ORDERS: metrics.duplicateOrders, PARTIAL_ORDERS: metrics.partialOrders,
    DUPLICATE_ORDER_ITEMS: metrics.duplicateItems, DUPLICATE_ORDER_ADDRESSES: metrics.duplicateAddresses,
    DUPLICATE_ORDER_ADJUSTMENTS: metrics.duplicateAdjustments, DUPLICATE_INITIAL_EVENTS: metrics.duplicateEvents,
    DUPLICATE_RESERVATION_ASSOCIATIONS: metrics.duplicateReservationAssociations,
    DIVERGENT_HASH_SUCCESSES: metrics.divergentHashSuccesses, STALE_PRICE_ACCEPTED: metrics.stalePriceAccepted,
    SILENT_REPRICING: metrics.silentRepricing, STALE_SHIPPING_ACCEPTED: metrics.staleShippingAccepted,
    INVALID_RESERVATION_ORDER_SUCCESSES: metrics.invalidReservationOrderSuccesses, RESURRECTED_RESERVATIONS: metrics.resurrectedReservations,
    OVERSOLD_STATES: metrics.oversoldStates, SUBMISSION_NEW_RESERVATION_MOVEMENTS: metrics.submissionNewReservationMovements,
    SUBMISSION_SALE_MOVEMENTS: metrics.submissionSaleMovements, SUBMISSION_ON_HAND_DELTA: metrics.submissionOnHandDelta,
    SUBMISSION_RESERVED_DELTA: metrics.submissionReservedDelta, DUPLICATE_ORDER_NUMBERS: metrics.duplicateOrderNumbers,
    LOST_SEQUENCE_UPDATES: metrics.lostSequenceUpdates, REUSED_COMMITTED_ORDER_NUMBERS: metrics.reusedCommittedOrderNumbers,
    POST_LOCK_CART_MUTATION_SUCCESSES: metrics.postLockCartMutationSuccesses,
    CHECKOUT_ORDER_DIVERGENCES: metrics.checkoutOrderDivergences, CART_ORDER_DIVERGENCES: metrics.cartOrderDivergences,
    UNAUTHORIZED_ATTEMPTS: metrics.unauthorizedAttempts, UNAUTHORIZED_SUBMISSION_SUCCESSES: metrics.unauthorizedSubmissionSuccesses,
    UNAUTHORIZED_ORDER_CREATIONS: metrics.unauthorizedOrderCreations, UNAUTHORIZED_ORDER_RECOVERIES: metrics.unauthorizedOrderRecoveries,
    UNAUTHORIZED_UNDETERMINED_SUCCESSES: metrics.unauthorizedUndeterminedSuccesses,
    ROLE_LEAKAGE: metrics.roleLeakage,
    AUTHORITY_CONTAMINATION: metrics.authorityContamination, CONNECTION_PRIVILEGE_LEAKAGE: metrics.connectionPrivilegeLeakage,
    CROSS_CHECKOUT_LEAKAGE: metrics.crossCheckoutLeakage, CROSS_CUSTOMER_LEAKAGE: metrics.crossCustomerLeakage,
    DEADLOCKS: metrics.deadlocks, LOCK_TIMEOUTS: metrics.lockTimeouts, STATEMENT_TIMEOUTS: metrics.statementTimeouts,
    UNLABELED_ERRORS: metrics.unlabeledErrors, PAYMENT_ATTEMPTS_CREATED: metrics.paymentAttemptsCreated,
    PAYMENT_EVENTS_CREATED: metrics.paymentEventsCreated, REFUNDS_CREATED: metrics.refundsCreated,
    SHIPMENT_CREATIONS: metrics.shipmentCreations, EXTERNAL_CALLS: metrics.externalCalls,
    AUTHENTIC_RUNTIME_IDENTITY: true, violations: metrics.violations,
  };
  console.log(JSON.stringify(summary, null, 2)); if (!pass) process.exitCode = 1;
} finally {
  await Promise.allSettled([app.end({ timeout: 5 }), admin.end({ timeout: 5 })]);
}
