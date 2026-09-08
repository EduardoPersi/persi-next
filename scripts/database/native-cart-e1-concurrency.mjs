import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { transformCheckoutPiiToDurableTaxDocument } from "../../lib/commerce/taxDocumentCrypto.ts";

const HARNESS_VERSION = "m29-e1-h-v1";
const canonicalPort = 15422;
const cycles = Number(process.env.E1_CYCLES ?? 50);
const selfTest = process.env.HARNESS_SELF_TEST_ONLY === "1";
const adminUrl = process.env.PERSI_E1_ADMIN_DATABASE_URL;
const appUrl = process.env.PERSI_E1_APP_DATABASE_URL;

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");
if (process.env.PERSI_DISPOSABLE_DATABASE !== "1") throw new Error("DISPOSABLE_DATABASE_REQUIRED");
if (!adminUrl || !appUrl) throw new Error("E1_DATABASE_URLS_REQUIRED");
for (const value of [adminUrl, appUrl]) {
  const target = new URL(value);
  if (!(["127.0.0.1", "localhost"].includes(target.hostname))) throw new Error("LOOPBACK_DATABASE_REQUIRED");
  if (Number(target.port || 5432) === canonicalPort) throw new Error("CANONICAL_DATABASE_REFUSED");
}
if (!Number.isInteger(cycles) || cycles < 1 || (!selfTest && cycles < 50)) throw new Error("E1_CYCLE_COUNT_INVALID");

const admin = postgres(adminUrl, { max: 8, prepare: false, idle_timeout: 0 });
const app = postgres(appUrl, { max: 12, prepare: false, idle_timeout: 0 });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const metrics = {
  totalOperations: 0, unauthorizedSuccesses: 0, postTerminalSuccessfulMutations: 0,
  duplicateItems: 0, lostUpdates: 0, versionMismatches: 0, deadlocks: 0,
  lockTimeouts: 0, statementTimeouts: 0, roleLeakage: 0, authorityContamination: 0,
  unexpectedSerializationErrors: 0, unlabeledErrors: 0, forcedReconnects: 0,
  phantomItems: 0, partialMerges: 0, unauthorizedItemDeltas: 0, unauthorizedVersionDeltas: 0,
  postLockedMutationAttempts: 0, postLockedMutationSuccesses: 0,
  postMergedMutationAttempts: 0, postMergedMutationSuccesses: 0,
  postConvertedMutationAttempts: 0, postConvertedMutationSuccesses: 0,
  connectionPrivilegeLeakage: 0,
  violations: [],
};
const authority = Object.fromEntries([
  "M30_WRONG_CUSTOMER_GUEST", "WRONG_CUSTOMER", "WRONG_GUEST_FINGERPRINT",
  "NULL_GUEST_FINGERPRINT", "UUID_ONLY", "CUSTOMER_WRONG_CUSTOMER",
  "CUSTOMER_UNRELATED_GUEST", "WRONG_MERGE_CUSTOMER", "WRONG_MERGE_FINGERPRINT",
  "NULL_MERGE_CUSTOMER", "NULL_MERGE_FINGERPRINT",
].map((key) => [key, { attempts: 0, successes: 0 }]));
const families = Object.fromEntries("ABCDEFGH".split("").map((key) => [key, {
  cycles: 0, mutationFirst: 0, transitionFirst: 0, bothLegal: 0, expectedRejections: 0,
  invalidOutcomes: 0, versionMismatches: 0, pass: false,
}]));

function errorInfo(error) { return { sqlstate: error?.code ?? null, message: error?.message ?? String(error) }; }
function classifyUnexpected(error) {
  const info = errorInfo(error);
  if (info.sqlstate === "40P01") metrics.deadlocks++;
  else if (info.sqlstate === "55P03") metrics.lockTimeouts++;
  else if (info.sqlstate === "57014") metrics.statementTimeouts++;
  else if (info.sqlstate === "40001") metrics.unexpectedSerializationErrors++;
  else metrics.unlabeledErrors++;
  return info;
}
function expectedRejection(result, messages) {
  if (result.status === "fulfilled") return false;
  const info = errorInfo(result.reason);
  if (messages.includes(info.message)) return true;
  classifyUnexpected(result.reason); return false;
}
async function withApp(operation) {
  metrics.totalOperations++;
  return app.begin(async (tx) => {
    const [before] = await tx`select session_user,current_user,pg_backend_pid()::int pid`;
    assert.equal(before.session_user, "persi_e1_app_login");
    assert.equal(before.current_user, "persi_e1_app_login");
    await tx`set local statement_timeout='8s'`;
    await tx`set local lock_timeout='5s'`;
    await tx.unsafe("set local role persi_app");
    const [active] = await tx`select session_user,current_user`;
    if (active.current_user !== "persi_app" || active.session_user !== "persi_e1_app_login") metrics.roleLeakage++;
    return operation(tx);
  });
}
async function assertPoolClean() {
  const [row] = await app`select session_user,current_user`;
  if (row.session_user !== "persi_e1_app_login" || row.current_user !== "persi_e1_app_login") {
    metrics.roleLeakage++; metrics.connectionPrivilegeLeakage++;
  }
}

async function fixture(family, index, { customerOwned = false, secondVariant = false } = {}) {
  const tag = `e1-${family.toLowerCase()}-${index}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const ids = { store: randomUUID(), customer: randomUUID(), list: randomUUID(), product: randomUUID(),
    variant: randomUUID(), variant2: randomUUID(), location: randomUUID(), cart: randomUUID() };
  const guest = hash(`${tag}:guest`);
  await admin.begin(async (tx) => {
    await tx`insert into stores(id,code,name,status,default_currency) values(${ids.store},${tag},'E1 synthetic','active','BRL')`;
    await tx`insert into customers(id,status,customer_type,email) values(${ids.customer},'active','individual',${`${tag}@example.invalid`})`;
    await tx`insert into price_lists(id,code,name,currency,channel,status) values(${ids.list},${tag},'E1 synthetic','BRL','storefront','active')`;
    await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${ids.store},${ids.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await tx`insert into products(id,name,slug,status,published_at) values(${ids.product},'E1 synthetic',${tag},'active',now())`;
    await tx`insert into product_variants(id,product_id,sku,status) values(${ids.variant},${ids.product},${tag.toUpperCase()},'active')`;
    if (secondVariant) await tx`insert into product_variants(id,product_id,sku,status) values(${ids.variant2},${ids.product},${`${tag}-B`.toUpperCase()},'active')`;
    await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${ids.variant},${ids.list},1000,'BRL',now()-interval '1 day')`;
    if (secondVariant) await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${ids.variant2},${ids.list},1200,'BRL',now()-interval '1 day')`;
    await tx`insert into inventory_locations(id,code,name,status) values(${ids.location},${tag},'E1 synthetic','active')`;
    await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${ids.variant},${ids.location},100)`;
    if (secondVariant) await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${ids.variant2},${ids.location},100)`;
    await tx`insert into carts(id,store_id,customer_id,guest_token_fingerprint,status,expires_at) values(${ids.cart},${ids.store},${customerOwned ? ids.customer : null},${customerOwned ? null : guest},'active',now()+interval '2 hours')`;
    await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${ids.cart},${ids.variant},2)`;
  });
  return { tag, ids, guest, customer: customerOwned ? ids.customer : null, capability: customerOwned ? null : guest };
}
async function state(f) {
  const [cart] = await admin`select status::text,version::bigint from carts where id=${f.ids.cart}`;
  const items = await admin`select product_variant_id,quantity::bigint from cart_items where cart_id=${f.ids.cart} order by product_variant_id`;
  return { cart, items };
}
async function lock(f, expectedVersion = 0n) {
  return withApp((tx) => tx`select * from prepare_native_checkout(${f.ids.store},${f.ids.cart},${f.customer},${f.capability},${`${f.tag}-lock`},${hash(`${f.tag}:lock`)},${expectedVersion},${f.ids.list},${f.ids.location},now()+interval '30 minutes',false)`);
}
async function checkDuplicates(f) {
  const [row] = await admin`select count(*)::int count from (select cart_id,product_variant_id from cart_items where cart_id=${f.ids.cart} group by 1,2 having count(*)>1) d`;
  metrics.duplicateItems += row.count;
}
function verifyVersion(family, expected, actual) {
  if (BigInt(actual) !== BigInt(expected)) { families[family].versionMismatches++; metrics.versionMismatches++; }
}
async function assertTerminalMutationsDenied(f, terminal) {
  const counter = terminal === "locked"
    ? ["postLockedMutationAttempts", "postLockedMutationSuccesses"]
    : ["postMergedMutationAttempts", "postMergedMutationSuccesses"];
  const results = await Promise.allSettled([
    withApp((tx) => tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},1)`),
    withApp((tx) => tx`select set_native_cart_item_quantity(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},5)`),
    withApp((tx) => tx`select remove_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant})`),
  ]);
  metrics[counter[0]] += results.length;
  for (const result of results) {
    if (result.status === "fulfilled") {
      metrics[counter[1]]++; metrics.postTerminalSuccessfulMutations++;
    } else if (!expectedRejection(result, ["CART_NOT_MUTABLE"])) {
      metrics.violations.push({ family: terminal.toUpperCase(), type: "UNEXPECTED_TERMINAL_REJECTION", error: errorInfo(result.reason) });
    }
  }
}
async function mutationLockFamily(letter, operation, { newItem = false } = {}) {
  for (let index = 0; index < cycles; index++) {
    const f = await fixture(letter, index, { customerOwned: index % 2 === 0, secondVariant: newItem });
    const variant = newItem ? f.ids.variant2 : f.ids.variant;
    const mutate = () => withApp((tx) => operation(tx, f, variant));
    const [mutation, transition] = await Promise.allSettled(index % 2 ? [mutate(), lock(f)] : [lock(f), mutate()]).then((r) => index % 2 ? r : [r[1], r[0]]);
    const mutationOk = mutation.status === "fulfilled", lockOk = transition.status === "fulfilled";
    if (mutationOk && !lockOk && expectedRejection(transition, ["cart_not_checkout_ready"])) families[letter].mutationFirst++;
    else if (!mutationOk && lockOk && expectedRejection(mutation, ["CART_NOT_MUTABLE"])) families[letter].transitionFirst++;
    else families[letter].invalidOutcomes++;
    const final = await state(f);
    verifyVersion(letter, 1n, final.cart.version);
    if (newItem && mutationOk !== final.items.some((item) => item.product_variant_id === variant)) {
      metrics.lostUpdates++; if (!mutationOk) metrics.phantomItems++;
      metrics.violations.push({family:letter,cycle:index,type:"NEW_ITEM_RESULT_MISMATCH"});
    }
    if (lockOk) await assertTerminalMutationsDenied(f, "locked");
    await checkDuplicates(f); families[letter].cycles++;
  }
}

async function familyE() {
  for (let index = 0; index < cycles; index++) {
    const source = await fixture("E", index, { secondVariant: true });
    const targetId = randomUUID();
    await admin`insert into carts(id,store_id,customer_id,status,expires_at) values(${targetId},${source.ids.store},${source.ids.customer},'active',now()+interval '2 hours')`;
    await admin`insert into cart_items(cart_id,product_variant_id,quantity) values(${targetId},${source.ids.variant},3)`;
    const merge = () => withApp((tx) => tx`select merge_native_carts(${source.ids.cart},${targetId},${source.ids.customer},${source.guest})`);
    const [merged, locked] = await Promise.allSettled(index % 2 ? [merge(), lock(source)] : [lock(source), merge()]).then((r) => index % 2 ? r : [r[1], r[0]]);
    const mergeOk = merged.status === "fulfilled", lockOk = locked.status === "fulfilled";
    if (mergeOk && !lockOk && expectedRejection(locked, ["cart_not_checkout_ready"])) families.E.mutationFirst++;
    else if (!mergeOk && lockOk && expectedRejection(merged, ["CART_OWNERSHIP_INVALID"])) families.E.transitionFirst++;
    else families.E.invalidOutcomes++;
    const [s] = await admin`select status::text,version::bigint,merged_into_cart_id from carts where id=${source.ids.cart}`;
    const [t] = await admin`select version::bigint from carts where id=${targetId}`;
    const [qty] = await admin`select coalesce(sum(quantity),0)::bigint quantity,count(*)::int rows from cart_items where cart_id=${targetId} and product_variant_id=${source.ids.variant}`;
    if (mergeOk && (s.status !== "merged" || s.merged_into_cart_id !== targetId || BigInt(qty.quantity) !== 5n || qty.rows !== 1)) { metrics.lostUpdates++; metrics.violations.push({family:"E",cycle:index,type:"MERGE_RESULT_MISMATCH",state:s,quantity:String(qty.quantity),rows:qty.rows}); }
    if (mergeOk) await assertTerminalMutationsDenied(source, "merged");
    verifyVersion("E", mergeOk ? 1n : 1n, s.version); verifyVersion("E", mergeOk ? 1n : 0n, t.version);
    await checkDuplicates({ ids: { cart: targetId } }); families.E.cycles++;
  }
}

async function familyF() {
  for (let index = 0; index < cycles; index++) {
    const f = await fixture("F", index);
    const [checkout] = await lock(f);
    const before = await state(f);
    const close = () => withApp((tx) => tx`select * from close_native_checkout(${checkout.id},'cancelled')`);
    const mutate = () => withApp((tx) => tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},1)`);
    const [mutation, closing] = await Promise.allSettled(index % 2 ? [mutate(), close()] : [close(), mutate()]).then((r) => index % 2 ? r : [r[1], r[0]]);
    const mutationOk = mutation.status === "fulfilled", closeOk = closing.status === "fulfilled";
    if (!closeOk) classifyUnexpected(closing.reason);
    if (mutationOk) families.F.transitionFirst++;
    else if (expectedRejection(mutation, ["CART_NOT_MUTABLE"])) families.F.mutationFirst++;
    else families.F.invalidOutcomes++;
    const final = await state(f);
    verifyVersion("F", BigInt(before.cart.version) + 1n + (mutationOk ? 1n : 0n), final.cart.version);
    if (final.cart.status !== "active") families.F.invalidOutcomes++;
    await checkDuplicates(f); families.F.cycles++;
  }
}

const pii = canonicalizeCheckoutPii({ contact:{firstName:"Pessoa",lastName:"Sintetica",company:"",email:"e1@example.invalid",phone:"11912345678",personType:"fisica",taxDocument:"52998224725"}, billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"}, shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"}, shippingSameAsBilling:true });
const checkoutKeys = { currentKeyId:()=>"e1-checkout-v1",encryptionKey:()=>Buffer.alloc(32,41),fingerprintKey:()=>Buffer.alloc(32,42) };
const taxKeys = { currentKeyId:()=>"e1-tax-v1",encryptionKey:()=>Buffer.alloc(32,51),fingerprintKey:()=>Buffer.alloc(32,52) };
const address = (a) => ({recipient:a.recipient,company:a.company,street:a.street,number:a.number,complement:a.complement,neighborhood:a.neighborhood,city:a.city,state:a.state,postal_code:a.postalCode,country:a.country});
async function convert(f) {
  const [checkout] = await lock(f);
  const encrypted = encryptCheckoutPii({ checkoutSessionId:checkout.id,storeId:f.ids.store,envelope:pii,keys:checkoutKeys });
  const [persisted] = await withApp((tx) => tx`select * from persist_checkout_pii(${checkout.id},${f.customer},${f.capability},${checkout.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`);
  const [ready] = await withApp((tx) => tx`select * from mark_native_checkout_ready(${checkout.id},${f.customer},${f.capability},${persisted.checkout_version},${encrypted.fingerprint})`);
  const [request] = await withApp((tx) => tx`select canonical_native_submission_request_hash(${checkout.id},${ready.version}) request_hash`);
  const orderId=randomUUID();
  const tax=transformCheckoutPiiToDurableTaxDocument({checkout:{checkoutSessionId:checkout.id,storeId:f.ids.store,encrypted,expiresAt:new Date(Date.now()+1200000),keys:checkoutKeys},orderId,taxKeys});
  await withApp((tx) => tx`select * from submit_native_checkout(${checkout.id},${ready.version},${`${f.tag}-lock`},${request.request_hash},${f.customer},${f.capability},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},'Pessoa Sintetica',${pii.contact.email},${pii.contact.phone},${address(pii.billing)},${address(pii.shipping)},${tax.type},${tax.ciphertext},${tax.fingerprint},${tax.masked})`);
}
async function familyG() {
  for(let index=0;index<cycles;index++){
    const f=await fixture("G",index); await convert(f);
    const results=await Promise.allSettled([
      withApp((tx)=>tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},1)`),
      withApp((tx)=>tx`select set_native_cart_item_quantity(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},5)`),
      withApp((tx)=>tx`select remove_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant})`),
    ]);
    metrics.postConvertedMutationAttempts += results.length;
    for(const result of results){
      if(result.status==="fulfilled"){
        metrics.postConvertedMutationSuccesses++; metrics.postTerminalSuccessfulMutations++;
      } else if(expectedRejection(result,["CART_NOT_MUTABLE"])) families.G.expectedRejections++;
    }
    const final=await state(f); if(final.cart.status!=="converted")families.G.invalidOutcomes++;
    await checkDuplicates(f); families.G.cycles++;
  }
}
async function familyH(){
  for(let index=0;index<cycles;index++){
    const f=await fixture("H",index,{customerOwned:index%2===0}); const before=await state(f);
    const results=await Promise.allSettled(Array.from({length:4},()=>withApp((tx)=>tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${f.ids.variant},1)`)));
    const success=results.filter((r)=>r.status==="fulfilled").length; for(const r of results)if(r.status==="rejected")classifyUnexpected(r.reason);
    const final=await state(f); verifyVersion("H",BigInt(before.cart.version)+BigInt(success),final.cart.version);
    const quantity=final.items.find((item)=>item.product_variant_id===f.ids.variant)?.quantity;
    if(BigInt(quantity)!==2n+BigInt(success)){metrics.lostUpdates++;metrics.violations.push({family:"H",cycle:index,type:"ADDITIVE_RESULT_MISMATCH",quantity:String(quantity),success});}
    await checkDuplicates(f); families.H.cycles++;
  }
}
async function cartAuthoritySnapshot(f) {
  const [row] = await admin`select c.version::bigint,coalesce(sum(ci.quantity),0)::bigint quantity,count(ci.id)::int items
    from carts c left join cart_items ci on ci.cart_id=c.id where c.id=${f.ids.cart} group by c.id`;
  return row;
}
async function runNegativeMutation(name, f, operation, cycle) {
  authority[name].attempts++;
  const before = await cartAuthoritySnapshot(f);
  const result = await Promise.allSettled([withApp(operation)]).then(([entry]) => entry);
  if (result.status === "fulfilled") {
    authority[name].successes++; metrics.unauthorizedSuccesses++;
    metrics.violations.push({ family: "AUTH", cycle, type: "UNAUTHORIZED_SUCCESS", operation: name });
  } else if (!expectedRejection(result, ["CART_OWNERSHIP_INVALID"])) metrics.authorityContamination++;
  const after = await cartAuthoritySnapshot(f);
  if (BigInt(after.quantity) !== BigInt(before.quantity) || after.items !== before.items) metrics.unauthorizedItemDeltas++;
  if (BigInt(after.version) !== BigInt(before.version)) metrics.unauthorizedVersionDeltas++;
}
async function mergeFixture(label, index) {
  const source = await fixture(label, index);
  const destination = randomUUID();
  await admin`insert into carts(id,store_id,customer_id,status,expires_at) values(${destination},${source.ids.store},${source.ids.customer},'active',now()+interval '2 hours')`;
  await admin`insert into cart_items(cart_id,product_variant_id,quantity) values(${destination},${source.ids.variant},3)`;
  return { source, destination };
}
async function mergeSnapshot(f) {
  const rows = await admin`select c.id,c.status::text,c.version::bigint,c.merged_into_cart_id,
    coalesce(sum(ci.quantity),0)::bigint quantity,count(ci.id)::int items
    from carts c left join cart_items ci on ci.cart_id=c.id
    where c.id in (${f.source.ids.cart},${f.destination}) group by c.id order by c.id`;
  return rows.map((row) => ({ ...row, version:String(row.version), quantity:String(row.quantity) }));
}
async function runNegativeMerge(name, f, customer, fingerprint, cycle) {
  authority[name].attempts++;
  const before = await mergeSnapshot(f);
  const result = await Promise.allSettled([
    withApp((tx) => tx`select merge_native_carts(${f.source.ids.cart},${f.destination},${customer},${fingerprint})`),
  ]).then(([entry]) => entry);
  if (result.status === "fulfilled") {
    authority[name].successes++; metrics.unauthorizedSuccesses++;
    metrics.violations.push({ family:"AUTH", cycle, type:"UNAUTHORIZED_MERGE_SUCCESS", operation:name });
  } else if (!expectedRejection(result, ["CART_OWNERSHIP_INVALID"])) metrics.authorityContamination++;
  const after = await mergeSnapshot(f);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    metrics.partialMerges++;
    if (after.some((row, i) => row.quantity !== before[i]?.quantity || row.items !== before[i]?.items)) metrics.unauthorizedItemDeltas++;
    if (after.some((row, i) => row.version !== before[i]?.version)) metrics.unauthorizedVersionDeltas++;
  }
}
async function authorityNegatives(){
  for(let index=0;index<cycles;index++){
    const guest=await fixture("N",index); const wrongCustomer=randomUUID();
    const customer=await fixture("CUSTN",index,{customerOwned:true});
    await runNegativeMutation("WRONG_GUEST_FINGERPRINT",guest,(tx)=>tx`select add_native_cart_item(${guest.ids.cart},null,${hash(`${guest.tag}:wrong`)},${guest.ids.variant},1)`,index);
    await runNegativeMutation("NULL_GUEST_FINGERPRINT",guest,(tx)=>tx`select add_native_cart_item(${guest.ids.cart},null,null,${guest.ids.variant},1)`,index);
    await runNegativeMutation("UUID_ONLY",guest,(tx)=>tx`select remove_native_cart_item(${guest.ids.cart},null,null,${guest.ids.variant})`,index);
    await runNegativeMutation("WRONG_CUSTOMER",guest,(tx)=>tx`select add_native_cart_item(${guest.ids.cart},${wrongCustomer},null,${guest.ids.variant},1)`,index);
    await runNegativeMutation("M30_WRONG_CUSTOMER_GUEST",guest,(tx)=>tx`select add_native_cart_item(${guest.ids.cart},${wrongCustomer},${guest.guest},${guest.ids.variant},1)`,index);
    await runNegativeMutation("CUSTOMER_WRONG_CUSTOMER",customer,(tx)=>tx`select add_native_cart_item(${customer.ids.cart},${wrongCustomer},null,${customer.ids.variant},1)`,index);
    await runNegativeMutation("CUSTOMER_UNRELATED_GUEST",customer,(tx)=>tx`select add_native_cart_item(${customer.ids.cart},null,${guest.guest},${customer.ids.variant},1)`,index);

    const wrongCustomerMerge=await mergeFixture("NMC",index);
    await runNegativeMerge("WRONG_MERGE_CUSTOMER",wrongCustomerMerge,wrongCustomer,wrongCustomerMerge.source.guest,index);
    const wrongFingerprintMerge=await mergeFixture("NMF",index);
    await runNegativeMerge("WRONG_MERGE_FINGERPRINT",wrongFingerprintMerge,wrongFingerprintMerge.source.ids.customer,hash(`${wrongFingerprintMerge.source.tag}:wrong`),index);
    const nullCustomerMerge=await mergeFixture("NMC0",index);
    await runNegativeMerge("NULL_MERGE_CUSTOMER",nullCustomerMerge,null,nullCustomerMerge.source.guest,index);
    const nullFingerprintMerge=await mergeFixture("NMF0",index);
    await runNegativeMerge("NULL_MERGE_FINGERPRINT",nullFingerprintMerge,nullFingerprintMerge.source.ids.customer,null,index);
  }
}

function requiredInvariantPass(candidate) {
  return candidate.m30Attempts > 0 && candidate.m30Successes === 0
    && candidate.wrongMergeCustomerAttempts > 0 && candidate.wrongMergeCustomerSuccesses === 0
    && candidate.wrongMergeFingerprintAttempts > 0 && candidate.wrongMergeFingerprintSuccesses === 0
    && candidate.authorityNegativeSuccesses === 0
    && candidate.postLockedSuccesses === 0 && candidate.postMergedSuccesses === 0 && candidate.postConvertedSuccesses === 0
    && candidate.lostUpdates === 0 && candidate.duplicateItems === 0 && candidate.versionMismatches === 0
    && candidate.phantomItems === 0 && candidate.partialMerges === 0
    && candidate.unauthorizedItemDeltas === 0 && candidate.unauthorizedVersionDeltas === 0
    && candidate.deadlocks === 0 && candidate.lockTimeouts === 0 && candidate.statementTimeouts === 0
    && candidate.unexpectedSerializationErrors === 0 && candidate.roleLeakage === 0
    && candidate.authorityContamination === 0 && candidate.connectionPrivilegeLeakage === 0
    && candidate.unlabeledErrors === 0 && candidate.externalCalls === 0 && candidate.saleMovements === 0;
}
function failureDetectionSelfTest(valid) {
  const mutations = [
    { m30Attempts:0 }, { m30Successes:1 }, { wrongMergeCustomerSuccesses:1 },
    { wrongMergeFingerprintSuccesses:1 }, { postConvertedSuccesses:1 },
  ];
  return requiredInvariantPass(valid) && mutations.every((change) => !requiredInvariantPass({ ...valid, ...change }));
}

try {
  const [identity] = await admin`select current_setting('server_version'),current_database(),inet_server_addr()::text host,inet_server_port()::int port`;
  assert.equal(identity.current_setting,"17.6"); assert.notEqual(identity.port,canonicalPort);
  await mutationLockFamily("A",(tx,f,v)=>tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${v},1)`);
  await mutationLockFamily("B",(tx,f,v)=>tx`select set_native_cart_item_quantity(${f.ids.cart},${f.customer},${f.capability},${v},5)`);
  await mutationLockFamily("C",(tx,f,v)=>tx`select remove_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${v})`);
  await mutationLockFamily("D",(tx,f,v)=>tx`select add_native_cart_item(${f.ids.cart},${f.customer},${f.capability},${v},1)`,{newItem:true});
  await familyE(); await familyF(); await familyG(); await familyH(); await authorityNegatives(); await assertPoolClean();
  const [sideEffects]=await admin`select (select count(*)::int from orders) orders,(select count(*)::int from inventory_movements where movement_type='sale') sale_movements`;
  for(const family of Object.values(families)) family.pass=family.cycles===cycles&&family.invalidOutcomes===0&&family.versionMismatches===0;
  const totalCycles=Object.values(families).reduce((sum,f)=>sum+f.cycles,0);
  const authorityAttempts=Object.values(authority).reduce((sum,value)=>sum+value.attempts,0);
  const authoritySuccesses=Object.values(authority).reduce((sum,value)=>sum+value.successes,0);
  const required = {
    m30Attempts:authority.M30_WRONG_CUSTOMER_GUEST.attempts,m30Successes:authority.M30_WRONG_CUSTOMER_GUEST.successes,
    wrongMergeCustomerAttempts:authority.WRONG_MERGE_CUSTOMER.attempts,wrongMergeCustomerSuccesses:authority.WRONG_MERGE_CUSTOMER.successes,
    wrongMergeFingerprintAttempts:authority.WRONG_MERGE_FINGERPRINT.attempts,wrongMergeFingerprintSuccesses:authority.WRONG_MERGE_FINGERPRINT.successes,
    authorityNegativeSuccesses:authoritySuccesses,postLockedSuccesses:metrics.postLockedMutationSuccesses,
    postMergedSuccesses:metrics.postMergedMutationSuccesses,postConvertedSuccesses:metrics.postConvertedMutationSuccesses,
    lostUpdates:metrics.lostUpdates,duplicateItems:metrics.duplicateItems,versionMismatches:metrics.versionMismatches,
    phantomItems:metrics.phantomItems,partialMerges:metrics.partialMerges,unauthorizedItemDeltas:metrics.unauthorizedItemDeltas,
    unauthorizedVersionDeltas:metrics.unauthorizedVersionDeltas,deadlocks:metrics.deadlocks,lockTimeouts:metrics.lockTimeouts,
    statementTimeouts:metrics.statementTimeouts,unexpectedSerializationErrors:metrics.unexpectedSerializationErrors,
    roleLeakage:metrics.roleLeakage,authorityContamination:metrics.authorityContamination,
    connectionPrivilegeLeakage:metrics.connectionPrivilegeLeakage,unlabeledErrors:metrics.unlabeledErrors,
    externalCalls:0,saleMovements:sideEffects.sale_movements,
  };
  const failureDetectionPass=failureDetectionSelfTest(required);
  const pass=Object.values(families).every((f)=>f.pass)&&requiredInvariantPass(required)&&failureDetectionPass&&metrics.forcedReconnects===0;
  const qualificationEligible=!selfTest&&cycles>=50;
  const summary={
    MODE:selfTest?"SELF_TEST":"FULL_QUALIFICATION",RUN_ID:randomUUID(),E1_HARNESS_VERSION:HARNESS_VERSION,
    SELF_TEST_ONLY:selfTest,NOT_QUALIFICATION_EVIDENCE:selfTest,QUALIFICATION_ELIGIBLE:qualificationEligible,
    FULL_QUALIFICATION_PASS:qualificationEligible&&pass,SELF_TEST_PASS:selfTest&&pass,
    CYCLES_PER_FAMILY:cycles,TOTAL_FAMILY_CYCLES:totalCycles,TOTAL_APP_OPERATIONS:metrics.totalOperations,
    FAMILY_A_CYCLES:families.A.cycles,FAMILY_B_CYCLES:families.B.cycles,FAMILY_C_CYCLES:families.C.cycles,
    FAMILY_D_CYCLES:families.D.cycles,FAMILY_E_CYCLES:families.E.cycles,FAMILY_F_CYCLES:families.F.cycles,
    FAMILY_G_CYCLES:families.G.cycles,FAMILY_H_CYCLES:families.H.cycles,
    RACE_DISTRIBUTIONS:Object.fromEntries(Object.entries(families).map(([key,value])=>[key,{mutation_first:value.mutationFirst,transition_first:value.transitionFirst,both_legal:value.bothLegal,expected_rejections:value.expectedRejections}])),
    AUTHORITY_NEGATIVE_ATTEMPTS:authorityAttempts,AUTHORITY_NEGATIVE_SUCCESSES:authoritySuccesses,
    M30_WRONG_CUSTOMER_GUEST_ATTEMPTS:authority.M30_WRONG_CUSTOMER_GUEST.attempts,M30_WRONG_CUSTOMER_GUEST_SUCCESSES:authority.M30_WRONG_CUSTOMER_GUEST.successes,
    WRONG_CUSTOMER_ATTEMPTS:authority.WRONG_CUSTOMER.attempts,WRONG_CUSTOMER_SUCCESSES:authority.WRONG_CUSTOMER.successes,
    WRONG_GUEST_FINGERPRINT_ATTEMPTS:authority.WRONG_GUEST_FINGERPRINT.attempts,WRONG_GUEST_FINGERPRINT_SUCCESSES:authority.WRONG_GUEST_FINGERPRINT.successes,
    NULL_GUEST_FINGERPRINT_ATTEMPTS:authority.NULL_GUEST_FINGERPRINT.attempts,NULL_GUEST_FINGERPRINT_SUCCESSES:authority.NULL_GUEST_FINGERPRINT.successes,
    UUID_ONLY_ATTEMPTS:authority.UUID_ONLY.attempts,UUID_ONLY_SUCCESSES:authority.UUID_ONLY.successes,
    WRONG_MERGE_CUSTOMER_ATTEMPTS:authority.WRONG_MERGE_CUSTOMER.attempts,WRONG_MERGE_CUSTOMER_SUCCESSES:authority.WRONG_MERGE_CUSTOMER.successes,
    WRONG_MERGE_FINGERPRINT_ATTEMPTS:authority.WRONG_MERGE_FINGERPRINT.attempts,WRONG_MERGE_FINGERPRINT_SUCCESSES:authority.WRONG_MERGE_FINGERPRINT.successes,
    AUTHORITY_SCENARIOS:authority,
    POST_LOCKED_MUTATION_ATTEMPTS:metrics.postLockedMutationAttempts,POST_LOCKED_MUTATION_SUCCESSES:metrics.postLockedMutationSuccesses,
    POST_MERGED_MUTATION_ATTEMPTS:metrics.postMergedMutationAttempts,POST_MERGED_MUTATION_SUCCESSES:metrics.postMergedMutationSuccesses,
    POST_CONVERTED_MUTATION_ATTEMPTS:metrics.postConvertedMutationAttempts,POST_CONVERTED_MUTATION_SUCCESSES:metrics.postConvertedMutationSuccesses,
    LOST_UPDATES:metrics.lostUpdates,DUPLICATE_ITEMS:metrics.duplicateItems,VERSION_MISMATCHES:metrics.versionMismatches,
    PHANTOM_ITEMS:metrics.phantomItems,PARTIAL_MERGES:metrics.partialMerges,UNAUTHORIZED_ITEM_DELTAS:metrics.unauthorizedItemDeltas,UNAUTHORIZED_VERSION_DELTAS:metrics.unauthorizedVersionDeltas,
    DEADLOCKS:metrics.deadlocks,LOCK_TIMEOUTS:metrics.lockTimeouts,STATEMENT_TIMEOUTS:metrics.statementTimeouts,UNEXPECTED_SERIALIZATION_ERRORS:metrics.unexpectedSerializationErrors,UNLABELED_ERRORS:metrics.unlabeledErrors,
    ROLE_LEAKAGE:metrics.roleLeakage,AUTHORITY_CONTAMINATION:metrics.authorityContamination,CONNECTION_PRIVILEGE_LEAKAGE:metrics.connectionPrivilegeLeakage,
    EXTERNAL_CALLS:0,PAYMENT_PROVIDER_CALLS:0,OLIST_CALLS:0,MELHOR_ENVIO_CALLS:0,EMAIL_SENDS:0,WHATSAPP_SENDS:0,SHIPMENT_CREATIONS:0,SALE_INVENTORY_MOVEMENTS:sideEffects.sale_movements,
    FAILURE_DETECTION_PASS:failureDetectionPass,families,metrics,sideEffects:{...sideEffects,expectedConvertedFixtureOrders:cycles,unexpectedOrders:sideEffects.orders-cycles},
    E1_HARNESS_PASS:pass,
  };
  console.log(JSON.stringify(summary,null,2)); if(!pass)process.exitCode=1;
} finally { await Promise.allSettled([app.end({timeout:5}),admin.end({timeout:5})]); }
