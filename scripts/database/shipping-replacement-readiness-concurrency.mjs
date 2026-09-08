import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { assertFixtureBaseline, captureFixtureBaseline, cleanupFixtureRun } from "./fixture-isolation.mjs";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const injectFailure = process.argv.includes("--inject-fixture-failure");
const url = localDatabaseUrl();
const setup = postgres(url, { max: 1, prepare: false });
const replacementConnection = postgres(url, { max: 1, prepare: false });
const readinessConnection = postgres(url, { max: 1, prepare: false });
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const requestedCycles = injectFailure ? 1 : 50;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const keys = { currentKeyId: () => "r2e-v1", encryptionKey: () => Buffer.alloc(32, 91), fingerprintKey: () => Buffer.alloc(32, 92) };
const baseline = await captureFixtureBaseline(setup);
let finalFixtureBaseline;
const counters = {
  cyclesRequested: injectFailure ? 0 : 50, cyclesCompleted: 0, readinessFirst: 0, replacementFirst: 0,
  safeRejection: 0, bothSuccess: 0, readyA: 0, readyB: 0, safeNotReady: 0,
  mixedReady: 0, tamperedReady: 0, wrongDestinationReady: 0, readyWithoutEvidence: 0,
  readyWithExpiredEvidence: 0, crossCheckout: 0, crossStore: 0, deadlocks: 0, timeouts: 0,
  lostUpdates: 0, unexpectedErrors: 0, overselling: 0, onHandRaceDelta: 0,
  reservedRaceDelta: 0, reservationMovementRaceDelta: 0, saleMovementDelta: 0,
  orderWrites: 0, orderItemWrites: 0, piiMutations: 0, priceMutations: 0,
  duplicateEvidence: 0, duplicateQuoteAssociation: 0,
};

const piiFor = (cycle) => canonicalizeCheckoutPii({
  contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email: `r2e-${cycle}@example.invalid`, phone: "11912345678", personType: "fisica", taxDocument: "52998224725" },
  billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
  shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
  shippingSameAsBilling: true,
});

async function createFixture(cycle) {
  const tag = `${runId}-${cycle}`, store = randomUUID(), list = randomUUID(), product = randomUUID();
  const variant = randomUUID(), location = randomUUID(), cart = randomUUID(), guest = hash(`${tag}:guest`);
  await setup.begin(async (tx) => {
    await tx`insert into stores(id,code,name,status) values(${store},${`r2e-s-${tag}`},'R2E','active')`;
    await tx`insert into price_lists(id,code,name,currency,channel,status) values(${list},${`r2e-p-${tag}`},'R2E','BRL','storefront','active')`;
    await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${list},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await tx`insert into products(id,name,slug,status,published_at) values(${product},'R2E',${`r2e-product-${tag}`},'active',now())`;
    await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`R2E-${tag}`},'active')`;
    await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${list},1000,'BRL',now()-interval '1 minute')`;
    await tx`insert into inventory_locations(id,code,name,status) values(${location},${`r2e-l-${tag}`},'R2E','active')`;
    await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${location},2)`;
    await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
    await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant},1)`;
  });
  const prepared = (await setup`select id,status::text,version from prepare_native_checkout(${store},${cart},null,${guest},${`r2e-checkout-${tag}`},${hash(`${tag}:request`)},0,${list},${location},now()+interval '30 minutes',true,'initial',null,'melhor_envio','a','carrier-a','service-a',100,'13201000',${"1".repeat(64)},${"2".repeat(64)},'v1',now()+interval '20 minutes',1,null)`)[0];
  const encrypted = encryptCheckoutPii({ checkoutSessionId: prepared.id, storeId: store, envelope: piiFor(cycle), keys });
  const persisted = (await setup`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`)[0];
  const expiresA = new Date(Date.now() + 20 * 60_000);
  const evidenceA = (await setup`select * from create_native_shipping_evidence(${prepared.id},null,${guest},${persisted.checkout_version},${`r2e-a-${tag}`},null,'melhor_envio','a','carrier-a','service-a',100,'13201000',${encrypted.destinationFingerprint},${hash(`${tag}:inputs-a`)},${expiresA},1,null)`)[0];
  await setup`select * from replace_native_checkout_shipping_quote(${prepared.id},null,${guest},${persisted.checkout_version},${evidenceA.id},'quote-a')`;
  return { tag, store, list, product, variant, location, cart, guest, checkout: prepared.id, version: persisted.checkout_version, encrypted, evidenceA };
}

try {
  const [migrationHistory] = await setup`select count(*)::int count,max(version) last from supabase_migrations.schema_migrations`;
  assert.equal(migrationHistory.count, 28, "MIGRATION_HISTORY_MISMATCH");
  assert.equal(migrationHistory.last, "20260905130000", "LAST_MIGRATION_MISMATCH");
  console.log(JSON.stringify({ migrationHistory, fixtureBaselineS0: baseline }));
  const [setupPid, replacementPid, readinessPid] = await Promise.all([
    setup`select pg_backend_pid() pid`, replacementConnection`select pg_backend_pid() pid`, readinessConnection`select pg_backend_pid() pid`,
  ]);
  assert.equal(new Set([setupPid[0].pid, replacementPid[0].pid, readinessPid[0].pid]).size, 3, "INDEPENDENT_CONNECTIONS_REQUIRED");

  for (let cycle = 0; cycle < requestedCycles; cycle += 1) {
    const fixture = await createFixture(cycle);
    if (injectFailure) throw new Error("EXPECTED_R1D_R2E_INJECTED_FAILURE");
    const before = (await setup`select l.quantity_on_hand,l.quantity_reserved,
      (select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='reservation') reservation_movements,
      (select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='sale') sale_movements,
      (select count(*)::int from orders o where o.store_id=${fixture.store}) orders,
      (select count(*)::int from order_items oi join orders o on o.id=oi.order_id where o.store_id=${fixture.store}) order_items,
      s.pii_ciphertext,s.pii_iv,s.pii_auth_tag,s.pii_fingerprint,i.price_fingerprint,i.unit_effective_amount_minor
      from inventory_levels l join checkout_session_items i on i.product_variant_id=l.product_variant_id
      join checkout_sessions s on s.id=i.checkout_session_id where s.id=${fixture.checkout}`)[0];
    const expiresB = new Date(Date.now() + 25 * 60_000);
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const replace = (async () => { await barrier; return replacementConnection.begin(async (tx) => {
      await tx`set local lock_timeout='5s'`; await tx`set local statement_timeout='10s'`;
      const evidenceB = (await tx`select * from create_native_shipping_evidence(${fixture.checkout},null,${fixture.guest},${fixture.version},${`r2e-b-${fixture.tag}`},null,'melhor_envio','b','carrier-b','service-b',200,'13201000',${fixture.encrypted.destinationFingerprint},${hash(`${fixture.tag}:inputs-b`)},${expiresB},2,'replacement-b')`)[0];
      await tx`select * from replace_native_checkout_shipping_quote(${fixture.checkout},null,${fixture.guest},${fixture.version},${evidenceB.id},'quote-b')`;
      return evidenceB;
    }); })();
    const ready = (async () => { await barrier; return readinessConnection.begin(async (tx) => {
      await tx`set local lock_timeout='5s'`; await tx`set local statement_timeout='10s'`;
      return (await tx`select status::text from mark_native_checkout_ready(${fixture.checkout},null,${fixture.guest},${fixture.version},${fixture.encrypted.fingerprint})`)[0];
    }); })();
    release();
    const [replaceResult, readyResult] = await Promise.allSettled([replace, ready]);
    for (const result of [replaceResult, readyResult]) if (result.status === "rejected") {
      if (result.reason?.code === "40P01") counters.deadlocks += 1;
      else if (["55P03", "57014"].includes(result.reason?.code)) counters.timeouts += 1;
      else if (["40001", "23514"].includes(result.reason?.code) && ["CHECKOUT_VERSION_CONFLICT", "CHECKOUT_STATE_INVALID", "CHECKOUT_SHIPPING_QUOTE_INVALID"].includes(result.reason?.message)) counters.safeRejection += 1;
      else counters.unexpectedErrors += 1;
    }
    if (replaceResult.status === "fulfilled" && readyResult.status === "fulfilled") { counters.replacementFirst += 1; counters.bothSuccess += 1; }
    else if (readyResult.status === "fulfilled") counters.readinessFirst += 1;

    const final = (await setup`select s.status::text,s.store_id,s.currency,s.shipping_required,s.pii_destination_fingerprint,s.pii_ciphertext,s.pii_iv,s.pii_auth_tag,s.pii_fingerprint,
      q.id quote_id,q.shipping_evidence_id,q.shipping_method_id q_method,q.provider q_provider,q.external_service_code q_code,q.carrier_name q_carrier,q.service_name q_service,q.amount_minor q_amount,q.currency q_currency,q.destination_postcode q_postcode,q.destination_fingerprint q_destination,q.logistics_fingerprint,q.logistics_version q_version,q.estimated_delivery_days q_days,q.provider_quote_reference q_reference,q.quoted_at q_quoted,q.expires_at q_expires,
      e.id evidence_id,e.checkout_session_id e_checkout,e.store_id e_store,e.shipping_method_id e_method,e.provider e_provider,e.external_service_code e_code,e.carrier_name e_carrier,e.service_name e_service,e.amount_minor e_amount,e.currency e_currency,e.destination_postcode e_postcode,e.destination_fingerprint e_destination,e.logistics_inputs_fingerprint,e.logistics_version e_version,e.estimated_delivery_days e_days,e.provider_quote_reference e_reference,e.quoted_at e_quoted,e.expires_at e_expires,e.canonical_fingerprint,
      canonical_checkout_logistics_fingerprint(e.id,e.checkout_session_id,e.store_id,e.shipping_method_id,e.provider,e.external_service_code,e.carrier_name,e.service_name,e.amount_minor,e.currency,e.destination_postcode,e.destination_fingerprint,e.logistics_inputs_fingerprint,e.logistics_version,e.quoted_at,e.expires_at,e.estimated_delivery_days,e.provider_quote_reference) recomputed
      from checkout_sessions s left join checkout_shipping_quotes q on q.checkout_session_id=s.id and q.is_selected left join checkout_shipping_evidence e on e.id=q.shipping_evidence_id where s.id=${fixture.checkout}`)[0];
    if (final.status === "ready") {
      if (!final.evidence_id) counters.readyWithoutEvidence += 1;
      if (final.e_expires <= new Date()) counters.readyWithExpiredEvidence += 1;
      if (final.e_checkout !== fixture.checkout) counters.crossCheckout += 1;
      if (final.e_store !== fixture.store) counters.crossStore += 1;
      if (final.e_destination !== final.pii_destination_fingerprint) counters.wrongDestinationReady += 1;
      const coherent = final.shipping_evidence_id === final.evidence_id && final.logistics_fingerprint === final.canonical_fingerprint && final.canonical_fingerprint === final.recomputed
        && final.q_method === final.e_method && final.q_provider === final.e_provider && final.q_code === final.e_code && final.q_carrier === final.e_carrier
        && final.q_service === final.e_service && final.q_amount === final.e_amount && final.q_currency === final.e_currency && final.q_postcode === final.e_postcode
        && final.q_destination === final.e_destination && final.q_version === final.e_version && final.q_days === final.e_days && final.q_reference === final.e_reference
        && final.q_quoted.getTime() === final.e_quoted.getTime() && final.q_expires.getTime() === final.e_expires.getTime();
      if (!coherent) counters.mixedReady += 1;
      if (final.evidence_id === fixture.evidenceA.id) counters.readyA += 1; else counters.readyB += 1;
    } else counters.safeNotReady += 1;
    const after = (await setup`select l.quantity_on_hand,l.quantity_reserved,
      (select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='reservation') reservation_movements,
      (select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='sale') sale_movements,
      (select count(*)::int from orders o where o.store_id=${fixture.store}) orders,
      (select count(*)::int from order_items oi join orders o on o.id=oi.order_id where o.store_id=${fixture.store}) order_items,
      s.pii_ciphertext,s.pii_iv,s.pii_auth_tag,s.pii_fingerprint,i.price_fingerprint,i.unit_effective_amount_minor,
      (select count(*)::int from checkout_shipping_evidence e where e.checkout_session_id=s.id) evidence_count,
      (select count(*)::int from checkout_shipping_quotes q where q.checkout_session_id=s.id and q.is_selected) selected_quotes
      from inventory_levels l join checkout_session_items i on i.product_variant_id=l.product_variant_id
      join checkout_sessions s on s.id=i.checkout_session_id where s.id=${fixture.checkout}`)[0];
    counters.onHandRaceDelta += Number(after.quantity_on_hand - before.quantity_on_hand);
    counters.reservedRaceDelta += Number(after.quantity_reserved - before.quantity_reserved);
    counters.reservationMovementRaceDelta += after.reservation_movements - before.reservation_movements;
    counters.saleMovementDelta += after.sale_movements - before.sale_movements;
    counters.orderWrites += after.orders - before.orders; counters.orderItemWrites += after.order_items - before.order_items;
    if (["pii_ciphertext","pii_iv","pii_auth_tag","pii_fingerprint"].some((key) => after[key] !== before[key])) counters.piiMutations += 1;
    if (after.price_fingerprint !== before.price_fingerprint || after.unit_effective_amount_minor !== before.unit_effective_amount_minor) counters.priceMutations += 1;
    if (after.evidence_count > 2) counters.duplicateEvidence += after.evidence_count - 2;
    if (after.selected_quotes !== 1) counters.duplicateQuoteAssociation += 1;
    if (after.quantity_reserved > after.quantity_on_hand) counters.overselling += 1;
    counters.cyclesCompleted += 1;
  }
} catch (error) {
  if (!(injectFailure && error.message === "EXPECTED_R1D_R2E_INJECTED_FAILURE")) throw error;
  console.log("EXPECTED_R1D_R2E_INJECTED_FAILURE");
} finally {
  await setup.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from checkout_shipping_evidence where idempotency_key like ${`r2e-%-${runId}-%`}`;
  });
  await cleanupFixtureRun(setup, { storeCodePrefixes: [`r2e-s-${runId}-`], productSlugPrefixes: [`r2e-product-${runId}-`], locationCodePrefixes: [`r2e-l-${runId}-`], priceListCodePrefixes: [`r2e-p-${runId}-`] });
  finalFixtureBaseline = await captureFixtureBaseline(setup);
  assertFixtureBaseline(baseline, finalFixtureBaseline);
  console.log("FIXTURE_CLEANUP_PASS");
  await Promise.all([setup.end({ timeout: 5 }), replacementConnection.end({ timeout: 5 }), readinessConnection.end({ timeout: 5 })]);
}

if (injectFailure) console.log(JSON.stringify({ failureInjection: "PASS", baselineEqual: true, fixtureBaselineS0: baseline, fixtureBaselineS1: finalFixtureBaseline }));
else {
  console.log(JSON.stringify({ ...counters, independentConnections: 3, barrier: "PROMISE_SIMULTANEOUS_RELEASE", fixtureBaselineEqual: true, fixtureBaselineS0: baseline, fixtureBaselineS1: finalFixtureBaseline }, null, 2));
  for (const key of ["mixedReady","tamperedReady","wrongDestinationReady","readyWithoutEvidence","readyWithExpiredEvidence","crossCheckout","crossStore","deadlocks","timeouts","lostUpdates","unexpectedErrors","overselling","onHandRaceDelta","reservedRaceDelta","reservationMovementRaceDelta","saleMovementDelta","orderWrites","orderItemWrites","piiMutations","priceMutations","duplicateEvidence","duplicateQuoteAssociation"]) assert.equal(counters[key], 0, key);
  assert.equal(counters.cyclesCompleted, 50);
  assert.equal(counters.readyA + counters.readyB + counters.safeNotReady, 50);
}
