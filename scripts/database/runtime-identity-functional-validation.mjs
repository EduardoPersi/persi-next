import assert from "node:assert/strict";
import crypto, { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { decryptDurableTaxDocument, transformCheckoutPiiToDurableTaxDocument } from "../../lib/commerce/taxDocumentCrypto.ts";
import { semanticProbePassed, waitForSemanticReadiness } from "./runtime-identity-readiness.mjs";
import { createSyntheticSlug } from "./synthetic-slug.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("PERSI_OFFLINE_VALIDATION_REQUIRED");

const IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.155";
const M29_PRE_REVISION_HASH = "5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec";
const M29_HASH = "09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a";
const M30_HASH = "db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c";
const M31_HASH = "f09bb724a0afd729771945b0ca264678629d1edf801d1bfb792ed416068e21f2";
const HOST = "127.0.0.1";
const container = `persi-r4c-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
const appPassword = crypto.randomBytes(32).toString("base64url");
const workerPassword = crypto.randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function run(command, args, { input, quiet = false, mergeOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(mergeOutput ? stdout + stderr : stdout) : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : stderr.trim()}`)));
    child.stdin.end(input ?? undefined);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref(); server.on("error", reject);
    server.listen(0, HOST, () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

async function withAppRole(pool, callback) {
  return pool.begin(async (tx) => {
    const [before] = await tx`select session_user,current_user`;
    assert.equal(before.session_user, "persi_app_login");
    assert.equal(before.current_user, "persi_app_login");
    await tx.unsafe("set local role persi_app");
    const [active] = await tx`select session_user,current_user`;
    assert.equal(active.session_user, "persi_app_login");
    assert.equal(active.current_user, "persi_app");
    return callback(tx);
  });
}

const port = await freePort();
let created = false, admin, app, worker;
const result = {
  phase: "B.3-C3-P3-C-M29-C-R4-C",
  image: IMAGE,
  host: HOST,
  port,
  storage: "tmpfs",
  pullPolicy: "never",
  externalRequests: 0,
  migration29Changed: true,
  migration29PreRevisionHash: M29_PRE_REVISION_HASH,
  migration29CandidateHash: M29_HASH,
  status: "STARTED",
};

try {
  await run("docker", ["image", "inspect", IMAGE]);
  await run("docker", ["run", "-d", "--pull", "never", "--name", container, "-p", `${HOST}:${port}:5432`, "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g", "-e", `POSTGRES_PASSWORD=${adminPassword}`, IMAGE], { quiet: true });
  created = true;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]); break; }
    catch { if (attempt === 59) throw new Error("DISPOSABLE_POSTGRES_NOT_READY"); await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  result.readiness = await waitForSemanticReadiness({ requiredSuccesses: 3, pollMs: 500, timeoutMs: 90000, probe: async () => {
    const logs = await run("docker", ["logs", container], { mergeOutput: true });
    let databaseReady = false;
    try {
      const probe = await run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atc", "select (current_setting('server_version_num')::int>=170000 and to_regnamespace('realtime') is not null and to_regnamespace('extensions') is not null and to_regrole('supabase_admin') is not null and to_regrole('authenticator') is not null)::text"]);
      databaseReady = probe.trim() === "true";
    } catch {}
    return semanticProbePassed({ initComplete: logs.includes("PostgreSQL init process complete; ready for start up."), databaseReady });
  }});

  const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 31);
  assert.ok(migrations.at(-1)?.startsWith("20260907180000_native_checkout_submission_authority_null_safe"));
  for (const name of migrations) {
    const body = fs.readFileSync(`supabase/migrations/${name}`, "utf8");
    if (name.startsWith("20260905180000_")) assert.equal(hash(body), M29_HASH);
    if (name.startsWith("20260907120000_")) assert.equal(hash(body), M30_HASH);
    if (name.startsWith("20260907180000_")) assert.equal(hash(body), M31_HASH);
    await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: body });
  }
  result.migrations = migrations.length;
  admin = postgres({ host: HOST, port, database: "postgres", username: "postgres", password: adminPassword, max: 1, prepare: false });
  await admin.unsafe(`create role persi_app_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${appPassword}'`);
  await admin.unsafe(`create role persi_worker_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${workerPassword}'`);
  await admin.unsafe("grant connect on database postgres to persi_app_login,persi_worker_login");
  await admin.unsafe("grant persi_app to persi_app_login with admin false,inherit false,set true");
  await admin.unsafe("grant persi_worker to persi_worker_login with admin false,inherit false,set true");
  app = postgres({ host: HOST, port, database: "postgres", username: "persi_app_login", password: appPassword, max: 2, prepare: false });
  worker = postgres({ host: HOST, port, database: "postgres", username: "persi_worker_login", password: workerPassword, max: 1, prepare: false });

  if (process.argv.includes("--h3-controls")) {
    const suffix = `h3-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    let shared = { store: randomUUID(), list: randomUUID(), product: randomUUID(), variant: randomUUID(), location: randomUUID() };
    const customerId = randomUUID();
    const checkoutKeys = { currentKeyId: () => "h3-checkout-v1", encryptionKey: () => Buffer.alloc(32, 61), fingerprintKey: () => Buffer.alloc(32, 62) };
    const taxKeys = { currentKeyId: () => "h3-tax-v1", encryptionKey: () => Buffer.alloc(32, 71), fingerprintKey: () => Buffer.alloc(32, 72) };
    const rawPii = { contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email: "h3@example.invalid", phone: "11912345678", personType: "fisica", taxDocument: "529.982.247-25" }, billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" }, shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" }, shippingSameAsBilling: true };
    const pii = canonicalizeCheckoutPii(rawPii);
    const toAddress = (address) => ({ recipient: address.recipient, company: address.company, street: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood, city: address.city, state: address.state, postal_code: address.postalCode, country: address.country });
    await admin`insert into stores(id,code,name,status,default_currency) values(${shared.store},${suffix},'H3 synthetic','active','BRL')`;
    await admin`insert into customers(id,status,customer_type,email) values(${customerId},'active','individual','h3-customer@example.invalid')`;
    await admin`insert into price_lists(id,code,name,currency,channel,status) values(${shared.list},${suffix},'H3 synthetic','BRL','storefront','active')`;
    await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${shared.store},${shared.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await admin`insert into products(id,name,slug,status) values(${shared.product},'H3 synthetic',${suffix},'draft')`;
    await admin`insert into product_variants(id,product_id,sku,status) values(${shared.variant},${shared.product},${suffix.toUpperCase()},'active')`;
    await admin`update products set status='active',published_at=now() where id=${shared.product}`;
    await admin`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${shared.variant},${shared.list},1000,'BRL',now()-interval '1 day')`;
    await admin`insert into inventory_locations(id,code,name,status) values(${shared.location},${suffix},'H3 synthetic','active')`;
    await admin`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${shared.variant},${shared.location},4)`;

    async function h3Ready(owner) {
      const customer = owner === "customer" ? customerId : null;
      const capability = owner === "guest" ? hash(`${suffix}:guest`) : null;
      const [cart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${shared.store},${customer},${capability},'BRL',now()+interval '1 hour')`);
      await withAppRole(app, (tx) => tx`select * from add_native_cart_item(${cart.id},${customer},${capability},${shared.variant},1)`);
      const [cartState] = await admin`select version from carts where id=${cart.id}`;
      const key = `${suffix}-${owner}`;
      const [checkout] = await withAppRole(app, (tx) => tx`select * from prepare_native_checkout(${shared.store},${cart.id},${customer},${capability},${key},${hash(`${key}:prepare`)},${cartState.version},${shared.list},${shared.location},now()+interval '30 minutes',false)`);
      const encrypted = encryptCheckoutPii({ checkoutSessionId: checkout.id, storeId: shared.store, envelope: pii, keys: checkoutKeys });
      const [persisted] = await withAppRole(app, (tx) => tx`select * from persist_checkout_pii(${checkout.id},${customer},${capability},${checkout.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`);
      const [ready] = await withAppRole(app, (tx) => tx`select * from mark_native_checkout_ready(${checkout.id},${customer},${capability},${persisted.checkout_version},${encrypted.fingerprint})`);
      const [request] = await withAppRole(app, (tx) => tx`select canonical_native_submission_request_hash(${checkout.id},${ready.version}) request_hash`);
      const orderId = randomUUID();
      const tax = transformCheckoutPiiToDurableTaxDocument({ checkout: { checkoutSessionId: checkout.id, storeId: shared.store, encrypted, expiresAt: new Date(Date.now() + 20 * 60_000), keys: checkoutKeys }, orderId, taxKeys });
      const [diagnostic] = await admin`select s.store_id,btrim(s.currency) currency,s.store_price_list_assignment_id assignment_id,s.store_price_list_assignment_version assignment_version,s.price_list_id,i.price_id snapshot_price_id,i.unit_regular_amount_minor snapshot_list,i.unit_effective_amount_minor snapshot_effective,i.price_fingerprint snapshot_fingerprint,p.price_id resolved_price_id,p.list_amount_minor resolved_list,p.effective_amount_minor resolved_effective,p.price_fingerprint resolved_fingerprint,p.price_id<>i.price_id price_id_mismatch,p.list_amount_minor<>i.unit_regular_amount_minor list_mismatch,p.effective_amount_minor<>i.unit_effective_amount_minor effective_mismatch,p.price_fingerprint<>i.price_fingerprint fingerprint_mismatch from checkout_sessions s join checkout_session_items i on i.checkout_session_id=s.id cross join lateral resolve_checkout_authoritative_price(i.product_variant_id,s.price_list_id,s.currency,statement_timestamp()) p where s.id=${checkout.id}`;
      const submit = (pool = app) => withAppRole(pool, async (tx) => (await tx`select * from submit_native_checkout(${checkout.id},${ready.version},${key},${request.request_hash},${customer},${capability},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},'Pessoa Sintetica',${pii.contact.email},${pii.contact.phone},${toAddress(pii.billing)},${toAddress(pii.shipping)},${tax.type},${tax.ciphertext},${tax.fingerprint},${tax.masked})`)[0]);
      return { owner, checkoutId: checkout.id, diagnostic, submit };
    }
    const guest = await h3Ready("guest");
    const controls = [];
    try { const submitted = await guest.submit(); controls.push({ owner: guest.owner, outcome: "SUCCESS", orderId: submitted.order_id, diagnostic: guest.diagnostic }); }
    catch (error) { controls.push({ owner: guest.owner, outcome: "ERROR", sqlstate: error.code ?? null, domainCode: error.message, diagnostic: guest.diagnostic }); }
    shared = { store: randomUUID(), list: randomUUID(), product: randomUUID(), variant: randomUUID(), location: randomUUID() };
    const customerSuffix = `${suffix}-customer`;
    await admin`insert into stores(id,code,name,status,default_currency) values(${shared.store},${customerSuffix},'H3 customer synthetic','active','BRL')`;
    await admin`insert into price_lists(id,code,name,currency,channel,status) values(${shared.list},${customerSuffix},'H3 customer synthetic','BRL','storefront','active')`;
    await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${shared.store},${shared.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
    await admin`insert into products(id,name,slug,status) values(${shared.product},'H3 customer synthetic',${customerSuffix},'draft')`;
    await admin`insert into product_variants(id,product_id,sku,status) values(${shared.variant},${shared.product},${customerSuffix.toUpperCase()},'active')`;
    await admin`update products set status='active',published_at=now() where id=${shared.product}`;
    await admin`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${shared.variant},${shared.list},1000,'BRL',now()-interval '1 day')`;
    await admin`insert into inventory_locations(id,code,name,status) values(${shared.location},${customerSuffix},'H3 customer synthetic','active')`;
    await admin`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${shared.variant},${shared.location},2)`;
    const customer = await h3Ready("customer");
    if (process.argv.includes("--r4-predicates")) {
      await admin.unsafe(`create or replace function public.resolve_checkout_authoritative_price(
        p_product_variant_id uuid,p_price_list_id uuid,p_currency char(3),p_as_of timestamptz
      ) returns table(price_id uuid,list_amount_minor bigint,sale_amount_minor bigint,effective_amount_minor bigint,
        valid_from timestamptz,valid_to timestamptz,sale_valid_from timestamptz,sale_valid_to timestamptz,
        currency char(3),price_fingerprint text)
        language plpgsql security definer set search_path='' as $$
        declare c_variant int;c_list int;c_price_currency int;c_list_currency int;c_list_status int;c_list_channel int;c_price_status int;c_valid_from int;c_valid_to int;actual_list uuid;
        begin
          select p.price_list_id into actual_list from public.prices p where p.product_variant_id=p_product_variant_id;
          select count(*) into c_variant from public.prices p where p.product_variant_id=p_product_variant_id;
          select count(*) into c_list from public.prices p where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id;
          select count(*) into c_price_currency from public.prices p where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency;
          select count(*) into c_list_currency from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency;
          select count(*) into c_list_status from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency and pl.status='active';
          select count(*) into c_list_channel from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency and pl.status='active' and pl.channel='storefront';
          select count(*) into c_price_status from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency and pl.status='active' and pl.channel='storefront' and p.status='active';
          select count(*) into c_valid_from from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency and pl.status='active' and pl.channel='storefront' and p.status='active' and p.valid_from<=p_as_of;
          select count(*) into c_valid_to from public.prices p join public.price_lists pl on pl.id=p.price_list_id where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id and p.currency=p_currency and pl.currency=p_currency and pl.status='active' and pl.channel='storefront' and p.status='active' and p.valid_from<=p_as_of and (p.valid_to is null or p.valid_to>p_as_of);
          raise exception using errcode='P0001',message=concat('R4_PRED|actual=',actual_list,'|arg=',p_price_list_id,'|counts=',c_variant,'|',c_list,'|',c_price_currency,'|',c_list_currency,'|',c_list_status,'|',c_list_channel,'|',c_price_status,'|',c_valid_from,'|',c_valid_to);
        end $$`);
    } else if (process.argv.includes("--r4-args")) {
      await admin.unsafe(`create or replace function public.resolve_checkout_authoritative_price(
        p_product_variant_id uuid,p_price_list_id uuid,p_currency char(3),p_as_of timestamptz
      ) returns table(price_id uuid,list_amount_minor bigint,sale_amount_minor bigint,effective_amount_minor bigint,
        valid_from timestamptz,valid_to timestamptz,sale_valid_from timestamptz,sale_valid_to timestamptz,
        currency char(3),price_fingerprint text)
        language plpgsql security definer set search_path='' as $$
        begin
          raise exception using errcode='P0001',message=concat('R4_ARGS|',p_product_variant_id,'|',p_price_list_id,'|',btrim(p_currency),'|',p_as_of);
        end $$`);
    }
    try { const submitted = await customer.submit(); controls.push({ owner: customer.owner, backend: "reused", outcome: "SUCCESS", orderId: submitted.order_id, diagnostic: customer.diagnostic }); }
    catch (error) {
      controls.push({ owner: customer.owner, backend: "reused", outcome: "ERROR", sqlstate: error.code ?? null, domainCode: error.message, diagnostic: customer.diagnostic });
      const freshApp = postgres({ host: HOST, port, database: "postgres", username: "persi_app_login", password: appPassword, max: 1, prepare: false });
      try {
        const submitted = await customer.submit(freshApp);
        controls.push({ owner: customer.owner, backend: "fresh", outcome: "SUCCESS", orderId: submitted.order_id });
      } catch (freshError) {
        controls.push({ owner: customer.owner, backend: "fresh", outcome: "ERROR", sqlstate: freshError.code ?? null, domainCode: freshError.message });
      } finally { await freshApp.end({ timeout: 3 }); }
    }
    result.functionCatalog = await admin`
      select p.oid::regprocedure::text signature,p.provolatile,p.proparallel,p.prosecdef,p.proconfig,
        l.lanname language,r.rolname owner,pg_get_function_result(p.oid) result_type
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang join pg_roles r on r.oid=p.proowner
      where n.nspname='public' and p.proname in ('submit_native_checkout','resolve_checkout_authoritative_price','canonical_checkout_price_fingerprint','resolve_store_price_authority')
      order by p.proname`;
    result.status = "H3_CONTROLS_COMPLETE";
    result.controls = controls;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (process.argv.includes("--m29-r1-smoke")) {
    const tag = randomUUID().replaceAll("-", "").slice(0, 12);
    const storeId = randomUUID(), customerId = randomUUID(), productId = randomUUID(), variantId = randomUUID();
    const guest = hash(`${tag}:guest`), secondGuest = hash(`${tag}:second-guest`);
    await admin`insert into stores(id,code,name,status,default_currency) values(${storeId},${`r1-${tag}`},'R1 synthetic','active','BRL')`;
    await admin`insert into customers(id,status,customer_type) values(${customerId},'active','individual')`;
    await admin`insert into products(id,name,slug,status) values(${productId},'R1 synthetic',${`r1-${tag}`},'draft')`;
    await admin`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${`R1-${tag}`},'active')`;
    await admin`update products set status='active',published_at=now() where id=${productId}`;

    const [cart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${storeId},null,${guest},'BRL',now()+interval '1 hour')`);
    let wrongCurrency;
    try { await withAppRole(app, (tx) => tx`select * from create_native_cart(${storeId},null,${hash(`${tag}:usd`)},'USD',now()+interval '1 hour')`); }
    catch (error) { wrongCurrency = { code: error.code, message: error.message }; }
    assert.deepEqual(wrongCurrency, { code: "P0002", message: "ACTIVE_STORE_NOT_FOUND" });
    const [added] = await withAppRole(app, (tx) => tx`select * from add_native_cart_item(${cart.id},null,${guest},${variantId},1)`);
    const [set] = await withAppRole(app, (tx) => tx`select * from set_native_cart_item_quantity(${cart.id},null,${guest},${variantId},2)`);
    const [removed] = await withAppRole(app, (tx) => tx`select remove_native_cart_item(${cart.id},null,${guest},${variantId}) removed`);
    assert.equal(removed.removed, true);

    const [customerCart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${storeId},${customerId},null,'BRL',now()+interval '1 hour')`);
    const [guestCart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${storeId},null,${secondGuest},'BRL',now()+interval '1 hour')`);
    await withAppRole(app, (tx) => tx`select * from add_native_cart_item(${guestCart.id},null,${secondGuest},${variantId},1)`);
    const [merged] = await withAppRole(app, (tx) => tx`select merge_native_carts(${guestCart.id},${customerCart.id},${customerId},${secondGuest}) merged_id`);
    assert.equal(merged.merged_id, customerCart.id);

    let submissionEntry;
    try { await withAppRole(app, (tx) => tx.unsafe(`select * from public.submit_native_checkout('${randomUUID()}',0,'synthetic','${"a".repeat(64)}',null,'${guest}','${"b".repeat(64)}','${"c".repeat(64)}','${randomUUID()}','${randomUUID()}','Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)`)); }
    catch (error) { submissionEntry = { code: error.code, message: error.message }; }
    assert.deepEqual(submissionEntry, { code: "P0002", message: "CHECKOUT_NOT_FOUND" });

    let directDml;
    try { await withAppRole(app, (tx) => tx`insert into carts(store_id,guest_token_fingerprint,expires_at) values(${storeId},${hash(`${tag}:forbidden`)},now()+interval '1 hour')`); }
    catch (error) { directDml = error.code; }
    assert.equal(directDml, "42501");

    let workerSubmit;
    try { await worker.begin(async (tx) => { await tx.unsafe("set local role persi_worker"); await tx.unsafe(`select * from public.submit_native_checkout('${randomUUID()}',0,'synthetic','${"a".repeat(64)}',null,'${guest}','${"b".repeat(64)}','${"c".repeat(64)}','${randomUUID()}','${randomUUID()}','Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)`); }); }
    catch (error) { workerSubmit = error.code; }
    assert.equal(workerSubmit, "42501");

    result.status = "M29_R1_SMOKE_PASSED";
    result.smokes = { createCart: true, wrongCurrency, addItemQuantity: String(added.quantity), setQuantity: String(set.quantity), removeItem: true, merge: true, submissionEntry, directDml, workerSubmit };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const storeId = randomUUID(), listId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), locationId = randomUUID();
  const guestFingerprint = hash(`${tag}:guest`);
  await admin`insert into stores(id,code,name,status) values(${storeId},${`r4c-${tag}`},'R4C synthetic','active')`;
  await admin`insert into price_lists(id,code,name,currency,channel,status) values(${listId},${`r4c-${tag}`},'R4C synthetic','BRL','storefront','active')`;
  await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${storeId},${listId},'BRL','storefront_retail',1,now()-interval '1 day')`;
  await admin`insert into products(id,name,slug,status) values(${productId},'R4C synthetic',${`r4c-${tag}`},'draft')`;
  await admin`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${`R4C-${tag}`},'active')`;
  await admin`update products set status='active',published_at=now() where id=${productId}`;
  await admin`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variantId},${listId},1000,'BRL',now()-interval '1 minute')`;
  await admin`insert into inventory_locations(id,code,name,status) values(${locationId},${`r4c-${tag}`},'R4C synthetic','active')`;
  await admin`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variantId},${locationId},2)`;

  const [cart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${storeId},null,${guestFingerprint},'BRL',now()+interval '1 hour')`);
  await withAppRole(app, (tx) => tx`select * from add_native_cart_item(${cart.id},null,${guestFingerprint},${variantId},1)`);
  const [currentCart] = await withAppRole(app, (tx) => tx`select id,version from carts where id=${cart.id}`);
  const idempotencyKey = `r4c-${tag}`;
  const [prepared] = await withAppRole(app, (tx) => tx`select id,status::text,version,cart_version from prepare_native_checkout(${storeId},${cart.id},null,${guestFingerprint},${idempotencyKey},${hash(`${tag}:prepare`)},${currentCart.version},${listId},${locationId},now()+interval '30 minutes',false)`);

  const createRawCheckoutPiiFixture = ({ email = "fixture@example.invalid", shippingSameAsBilling = true } = {}) => ({
    contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email, phone: "11912345678", personType: "fisica", taxDocument: "529.982.247-25" },
    billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
    shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: shippingSameAsBilling ? "13201000" : "13202000", country: "BR" },
    shippingSameAsBilling,
  });
  const pii = canonicalizeCheckoutPii(createRawCheckoutPiiFixture());
  const checkoutKeys = { currentKeyId: () => "r4c-checkout-v1", encryptionKey: () => Buffer.alloc(32, 41), fingerprintKey: () => Buffer.alloc(32, 42) };
  const taxKeys = { currentKeyId: () => "r4c-tax-v1", encryptionKey: () => Buffer.alloc(32, 51), fingerprintKey: () => Buffer.alloc(32, 52) };
  const encrypted = encryptCheckoutPii({ checkoutSessionId: prepared.id, storeId, envelope: pii, keys: checkoutKeys });
  const [persisted] = await withAppRole(app, (tx) => tx`select * from persist_checkout_pii(${prepared.id},null,${guestFingerprint},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`);
  const [ready] = await withAppRole(app, (tx) => tx`select id,status::text,version from mark_native_checkout_ready(${prepared.id},null,${guestFingerprint},${persisted.checkout_version},${encrypted.fingerprint})`);
  const [request] = await withAppRole(app, (tx) => tx`select canonical_native_submission_request_hash(${prepared.id},${ready.version}) request_hash`);
  const [resolvedPrice] = await admin`select price_id,list_amount_minor,sale_amount_minor,effective_amount_minor,currency,price_fingerprint from resolve_checkout_authoritative_price(${variantId},${listId},'BRL',statement_timestamp())`;
  const orderId = randomUUID();
  const tax = transformCheckoutPiiToDurableTaxDocument({ checkout: { checkoutSessionId: prepared.id, storeId, encrypted, expiresAt: new Date(Date.now() + 20 * 60_000), keys: checkoutKeys }, orderId, taxKeys });
  const toOrderAddress = (address) => ({ recipient: address.recipient, company: address.company, street: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood, city: address.city, state: address.state, postal_code: address.postalCode, country: address.country });
  const [inventoryBefore] = await admin`select quantity_on_hand,quantity_reserved,(select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='reservation') reservation_movements,(select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='sale') sale_movements from inventory_levels l where product_variant_id=${variantId} and inventory_location_id=${locationId}`;
  result.fixture = { kind: "synthetic", owner: "guest", shippingRequired: false, preparedStatus: prepared.status, readyStatus: ready.status, checkoutCartVersion: String(prepared.cart_version), currentCartVersion: String((await admin`select version from carts where id=${cart.id}`)[0].version), resolvedPrice: { priceId: resolvedPrice.price_id, listAmountMinor: String(resolvedPrice.list_amount_minor), saleAmountMinor: resolvedPrice.sale_amount_minor === null ? null : String(resolvedPrice.sale_amount_minor), effectiveAmountMinor: String(resolvedPrice.effective_amount_minor), currency: resolvedPrice.currency.trim(), fingerprintPresent: resolvedPrice.price_fingerprint.length === 64 } };
  try {
    const [submitted] = await withAppRole(app, (tx) => tx`select * from submit_native_checkout(${prepared.id},${ready.version},${idempotencyKey},${request.request_hash},null,${guestFingerprint},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},${`${pii.contact.firstName} ${pii.contact.lastName}`},${pii.contact.email},${pii.contact.phone},${toOrderAddress(pii.billing)},${toOrderAddress(pii.shipping)},${tax.type},${tax.ciphertext},${tax.fingerprint},${tax.masked})`);
    result.happyPath = { passed: true, submitted };
    result.status = "HAPPY_PATH_PASSED";
  } catch (error) {
    result.happyPath = { passed: false, sqlstate: error.code ?? null, message: error.message };
    result.status = "HARD_STOP_FUNCTIONAL_BLOCKER";
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
  }
  if (result.status === "HAPPY_PATH_PASSED") {
    const [aggregate] = await admin`select o.id,o.order_number,o.status::text,c.status::text cart_status,s.status::text checkout_status,s.pii_ciphertext,
      (select count(*)::int from order_items i where i.order_id=o.id) item_count,
      (select count(*)::int from order_addresses a where a.order_id=o.id) address_count,
      (select count(*)::int from order_status_events e where e.order_id=o.id and e.from_status is null and e.to_status='pending' and e.actor_type='system') initial_event_count,
      (select count(*)::int from inventory_movements m join inventory_reservations r on r.id=m.reservation_id join order_items i on i.id=r.order_item_id where i.order_id=o.id and m.movement_type='sale') sale_movements,
      (select count(*)::int from inventory_reservations r join order_items i on i.id=r.order_item_id where i.order_id=o.id and r.status='active') linked_active_reservations
      from orders o join checkout_sessions s on s.id=o.checkout_session_id join carts c on c.id=s.cart_id where o.id=${orderId}`;
    assert.equal(aggregate.initial_event_count, 1);
    assert.equal(aggregate.item_count, 1); assert.equal(aggregate.address_count, 2);
    assert.equal(aggregate.cart_status, "converted"); assert.equal(aggregate.checkout_status, "order_created");
    assert.equal(aggregate.pii_ciphertext, null); assert.equal(aggregate.sale_movements, 0); assert.equal(aggregate.linked_active_reservations, 1);

    const insertOrder = (tx, id, sequence) => tx`insert into orders(id,store_id,order_sequence,order_number,status,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${id},${storeId},${sequence},${`R4C-NEG-${sequence}`},'pending','BRL',0,0,'Synthetic','negative@example.invalid',${randomUUID()})`;
    let missingEvent;
    try { await admin.begin(async (tx) => { await insertOrder(tx, randomUUID(), 900001); }); }
    catch (error) { missingEvent = { code: error.code, message: error.message }; }
    assert.deepEqual(missingEvent, { code: "23514", message: "ORDER_INITIAL_EVENT_REQUIRED" });

    let duplicateEvent;
    try { await admin`insert into order_status_events(order_id,from_status,to_status,actor_type,reason_code,correlation_id) values(${orderId},null,'pending','system','duplicate_negative',${randomUUID()})`; }
    catch (error) { duplicateEvent = { code: error.code, message: error.message }; }
    assert.equal(duplicateEvent.code, "23505");

    let wrongEvent;
    try { await admin.begin(async (tx) => { const badOrder = randomUUID(); await insertOrder(tx, badOrder, 900002); await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,reason_code,correlation_id) values(${badOrder},null,'confirmed','system','wrong_negative',${randomUUID()})`; }); }
    catch (error) { wrongEvent = { code: error.code, message: error.message }; }
    assert.equal(wrongEvent.code, "23514");
    const [negativeResidue] = await admin`select count(*)::int count from orders where order_sequence in (900001,900002)`;
    assert.equal(negativeResidue.count, 0);
    const [inventoryAfter] = await admin`select quantity_on_hand,quantity_reserved,(select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='reservation') reservation_movements,(select count(*)::int from inventory_movements m where m.inventory_level_id=l.id and m.movement_type='sale') sale_movements from inventory_levels l where product_variant_id=${variantId} and inventory_location_id=${locationId}`;
    assert.equal(inventoryAfter.quantity_on_hand, inventoryBefore.quantity_on_hand);
    assert.equal(inventoryAfter.quantity_reserved, inventoryBefore.quantity_reserved);
    assert.equal(inventoryAfter.reservation_movements, inventoryBefore.reservation_movements);
    assert.equal(inventoryAfter.sale_movements, inventoryBefore.sale_movements);
    const [sameRetry] = await withAppRole(app, (tx) => tx`select * from submit_native_checkout(${prepared.id},${ready.version},${idempotencyKey},${request.request_hash},null,${guestFingerprint},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},${`${pii.contact.firstName} ${pii.contact.lastName}`},${pii.contact.email},${pii.contact.phone},${toOrderAddress(pii.billing)},${toOrderAddress(pii.shipping)},${tax.type},${tax.ciphertext},${tax.fingerprint},${tax.masked})`);
    assert.equal(sameRetry.order_id, orderId); assert.equal(sameRetry.order_number, aggregate.order_number);
    let divergentRetry;
    try { await withAppRole(app, (tx) => tx`select * from submit_native_checkout(${prepared.id},${ready.version},${idempotencyKey},${"f".repeat(64)},null,${guestFingerprint},${encrypted.fingerprint},${encrypted.destinationFingerprint},${randomUUID()},${randomUUID()},'Synthetic','fixture@example.invalid',null,${toOrderAddress(pii.billing)},${toOrderAddress(pii.shipping)},null,null,null,null)`); }
    catch (error) { divergentRetry = { code: error.code, message: error.message }; }
    assert.deepEqual(divergentRetry, { code: "23505", message: "CHECKOUT_IDEMPOTENCY_CONFLICT" });
    let wrongGuest, uuidOnly;
    try { await withAppRole(app, (tx) => tx`select * from submit_native_checkout(${prepared.id},${ready.version},${idempotencyKey},${request.request_hash},null,${hash(`${tag}:wrong`)},${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},'Synthetic','fixture@example.invalid',null,${toOrderAddress(pii.billing)},${toOrderAddress(pii.shipping)},null,null,null,null)`); } catch (error) { wrongGuest = error.code; }
    try { await withAppRole(app, (tx) => tx`select * from submit_native_checkout(${prepared.id},${ready.version},${idempotencyKey},${request.request_hash},null,null,${encrypted.fingerprint},${encrypted.destinationFingerprint},${orderId},${randomUUID()},'Synthetic','fixture@example.invalid',null,${toOrderAddress(pii.billing)},${toOrderAddress(pii.shipping)},null,null,null,null)`); } catch (error) { uuidOnly = error.code; }
    assert.equal(wrongGuest, "42501"); assert.equal(uuidOnly, "42501");
    const durableDocument = decryptDurableTaxDocument({ bundle: tax, storeId, orderId, keys: taxKeys });
    assert.equal(durableDocument.value, "52998224725"); assert.notEqual(tax.ciphertext, encrypted.ciphertext);
    const convertedErrors = {};
    for (const [name, operation] of Object.entries({
      add: (tx) => tx`select * from add_native_cart_item(${cart.id},null,${guestFingerprint},${variantId},1)`,
      set: (tx) => tx`select * from set_native_cart_item_quantity(${cart.id},null,${guestFingerprint},${variantId},1)`,
      remove: (tx) => tx`select remove_native_cart_item(${cart.id},null,${guestFingerprint},${variantId})`,
    })) { try { await withAppRole(app, operation); } catch (error) { convertedErrors[name] = { code: error.code, message: error.message }; } }
    for (const value of Object.values(convertedErrors)) assert.deepEqual(value, { code: "23514", message: "CART_NOT_MUTABLE" });
    let reactivation;
    try { await admin`update carts set status='active',version=version+1 where id=${cart.id}`; } catch (error) { reactivation = { code: error.code, message: error.message }; }
    assert.deepEqual(reactivation, { code: "23514", message: "CART_TRANSITION_INVALID" });
    const [postRetryCounts] = await admin`select (select count(*)::int from orders where checkout_session_id=${prepared.id}) orders,(select count(*)::int from order_status_events where order_id=${orderId} and from_status is null) events,(select next_order_sequence from stores where id=${storeId}) next_sequence`;
    assert.deepEqual([postRetryCounts.orders, postRetryCounts.events, String(postRetryCounts.next_sequence)], [1, 1, "2"]);

    async function buildReady(label, { customer = false, listAmount = 1000, saleAmount = null, saleFrom = null, saleTo = null } = {}) {
      const suffix = createSyntheticSlug(label, randomUUID().replaceAll("-", "").slice(0, 8));
      const ids = { store: randomUUID(), list: randomUUID(), product: randomUUID(), variant: randomUUID(), location: randomUUID(), customer: customer ? randomUUID() : null };
      const capability = customer ? null : hash(`${suffix}:guest`);
      await admin`insert into stores(id,code,name,status,default_currency) values(${ids.store},${suffix},'Matrix synthetic','active','BRL')`;
      if (customer) await admin`insert into customers(id,status,customer_type,email) values(${ids.customer},'active','individual',${`${suffix}@example.invalid`})`;
      await admin`insert into price_lists(id,code,name,currency,channel,status) values(${ids.list},${suffix},'Matrix synthetic','BRL','storefront','active')`;
      await admin`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${ids.store},${ids.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
      await admin`insert into products(id,name,slug,status) values(${ids.product},'Matrix synthetic',${suffix},'draft')`;
      await admin`insert into product_variants(id,product_id,sku,status) values(${ids.variant},${ids.product},${suffix.toUpperCase()},'active')`;
      await admin`update products set status='active',published_at=now() where id=${ids.product}`;
      const [price] = await admin`insert into prices(product_variant_id,price_list_id,list_amount_minor,sale_amount_minor,currency,valid_from,sale_valid_from,sale_valid_to) values(${ids.variant},${ids.list},${listAmount},${saleAmount},'BRL',now()-interval '1 hour',${saleFrom},${saleTo}) returning id`;
      await admin`insert into inventory_locations(id,code,name,status) values(${ids.location},${suffix},'Matrix synthetic','active')`;
      await admin`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${ids.variant},${ids.location},2)`;
      const [newCart] = await withAppRole(app, (tx) => tx`select * from create_native_cart(${ids.store},${ids.customer},${capability},'BRL',now()+interval '1 hour')`);
      await withAppRole(app, (tx) => tx`select * from add_native_cart_item(${newCart.id},${ids.customer},${capability},${ids.variant},1)`);
      const [cartState] = await withAppRole(app, (tx) => tx`select version from carts where id=${newCart.id}`);
      const key = `checkout-${suffix}`, preparationHash = hash(`${suffix}:prepare`);
      const [checkout] = await withAppRole(app, (tx) => tx`select * from prepare_native_checkout(${ids.store},${newCart.id},${ids.customer},${capability},${key},${preparationHash},${cartState.version},${ids.list},${ids.location},now()+interval '30 minutes',false)`);
      const fixturePii = canonicalizeCheckoutPii(createRawCheckoutPiiFixture({ email: `${suffix}@example.invalid` }));
      const enc = encryptCheckoutPii({ checkoutSessionId: checkout.id, storeId: ids.store, envelope: fixturePii, keys: checkoutKeys });
      const [piiState] = await withAppRole(app, (tx) => tx`select * from persist_checkout_pii(${checkout.id},${ids.customer},${capability},${checkout.version},${enc.ciphertext},${enc.iv},${enc.authTag},${enc.envelopeVersion},${enc.keyId},${enc.fingerprint},${enc.destinationFingerprint},now()+interval '20 minutes')`);
      const [readyState] = await withAppRole(app, (tx) => tx`select * from mark_native_checkout_ready(${checkout.id},${ids.customer},${capability},${piiState.checkout_version},${enc.fingerprint})`);
      const [canonical] = await withAppRole(app, (tx) => tx`select canonical_native_submission_request_hash(${checkout.id},${readyState.version}) request_hash`);
      const newOrderId = randomUUID();
      const durable = transformCheckoutPiiToDurableTaxDocument({ checkout: { checkoutSessionId: checkout.id, storeId: ids.store, encrypted: enc, expiresAt: new Date(Date.now() + 20 * 60_000), keys: checkoutKeys }, orderId: newOrderId, taxKeys });
      const submit = (requestHash = canonical.request_hash, ownerCustomer = ids.customer, ownerCapability = capability) => withAppRole(app, async (tx) => (await tx`select * from submit_native_checkout(${checkout.id},${readyState.version},${key},${requestHash},${ownerCustomer},${ownerCapability},${enc.fingerprint},${enc.destinationFingerprint},${newOrderId},${randomUUID()},'Pessoa Sintetica',${fixturePii.contact.email},${fixturePii.contact.phone},${toOrderAddress(fixturePii.billing)},${toOrderAddress(fixturePii.shipping)},${durable.type},${durable.ciphertext},${durable.fingerprint},${durable.masked})`)[0]);
      return { ids, capability, priceId: price.id, checkout, ready: readyState, requestHash: canonical.request_hash, orderId: newOrderId, submit };
    }

    const scenarioResults = [];
    async function runSuccessScenario(scenarioId, action) {
      const startedAt = performance.now();
      try {
        const value = await action();
        scenarioResults.push({ scenarioId, expectedOutcome: "SUCCESS", actualOutcome: "SUCCESS", expectedSqlState: null, actualSqlState: null, expectedDomainCode: null, actualDomainCode: null, passed: true, durationMs: Math.round(performance.now() - startedAt) });
        return value;
      } catch (error) {
        throw Object.assign(new Error(`UNEXPECTED_SCENARIO_ERROR:${scenarioId}:${error.code ?? "NO_SQLSTATE"}:${error.message}`), { cause: error, scenarioId });
      }
    }
    async function expectDomainError({ scenarioId, expectedSqlState, expectedCode, action }) {
      const startedAt = performance.now(); let error;
      try { await action(); } catch (caught) { error = caught; }
      if (!error) throw Object.assign(new Error(`UNEXPECTED_SCENARIO_SUCCESS:${scenarioId}`), { scenarioId });
      if (error.code !== expectedSqlState || error.message !== expectedCode) throw Object.assign(new Error(`UNEXPECTED_SCENARIO_ERROR:${scenarioId}:${error.code ?? "NO_SQLSTATE"}:${error.message}`), { cause: error, scenarioId });
      const row = { scenarioId, expectedOutcome: "DOMAIN_ERROR", actualOutcome: "DOMAIN_ERROR", expectedSqlState, actualSqlState: error.code, expectedDomainCode: expectedCode, actualDomainCode: error.message, passed: true, durationMs: Math.round(performance.now() - startedAt) };
      scenarioResults.push(row); return row;
    }

    const customerFixture = await runSuccessScenario("CUSTOMER_FIXTURE_READY", () => buildReady("customer", { customer: true }));
    const wrongCustomerResult = await expectDomainError({ scenarioId: "CUSTOMER_WRONG_OWNER", expectedSqlState: "42501", expectedCode: "CHECKOUT_OWNERSHIP_INVALID", action: () => customerFixture.submit(customerFixture.requestHash, randomUUID(), null) });
    const uuidOnlyCustomerResult = await expectDomainError({ scenarioId: "CUSTOMER_UUID_ONLY", expectedSqlState: "42501", expectedCode: "CHECKOUT_OWNERSHIP_INVALID", action: () => customerFixture.submit(customerFixture.requestHash, randomUUID(), null) });
    const overrideCustomerResult = await expectDomainError({ scenarioId: "CUSTOMER_OVERRIDE_ATTEMPT", expectedSqlState: "42501", expectedCode: "CHECKOUT_OWNERSHIP_INVALID", action: () => customerFixture.submit(customerFixture.requestHash, customerFixture.ids.customer, hash("synthetic-override")) });
    const customerOrder = await runSuccessScenario("CUSTOMER_CONTROL_VALID", () => customerFixture.submit()); assert.equal(customerOrder.order_id, customerFixture.orderId);

    const priceCases = [];
    const unchangedPriceFixture = await runSuccessScenario("PRICE_UNCHANGED_FIXTURE_READY", () => buildReady("price-unchanged"));
    const unchangedPriceOrder = await runSuccessScenario("PRICE_UNCHANGED", () => unchangedPriceFixture.submit());
    assert.equal(unchangedPriceOrder.order_id, unchangedPriceFixture.orderId);
    const priceDefinitions = [
      ["increase", {}, (fixture) => admin`update prices set list_amount_minor=1200 where id=${fixture.priceId}`],
      ["decrease", { listAmount: 1200 }, (fixture) => admin`update prices set list_amount_minor=1000 where id=${fixture.priceId}`],
      ["sale_activation", { listAmount: 1200, saleAmount: 1000, saleFrom: new Date(Date.now() + 3600_000) }, (fixture) => admin`update prices set sale_valid_from=now()-interval '1 minute' where id=${fixture.priceId}`],
      ["sale_expiry", { listAmount: 1200, saleAmount: 1000, saleFrom: new Date(Date.now() - 3600_000), saleTo: new Date(Date.now() + 3600_000) }, (fixture) => admin`update prices set sale_valid_to=now()-interval '1 second' where id=${fixture.priceId}`],
      ["validity", {}, (fixture) => admin`update prices set valid_to=now()-interval '1 second' where id=${fixture.priceId}`],
      ["assignment", {}, (fixture) => admin.begin(async (tx) => {
        const [boundary] = await tx`select statement_timestamp() at`;
        await tx`update store_price_list_assignments set valid_to=${boundary.at} where store_id=${fixture.ids.store} and valid_to is null`;
        await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${fixture.ids.store},${fixture.ids.list},'BRL','storefront_retail',2,${boundary.at})`;
      })],
    ];
    for (const [name, options, mutate] of priceDefinitions) {
      const scenarioId = `PRICE_${name.toUpperCase()}`;
      const fixture = await runSuccessScenario(`${scenarioId}_FIXTURE_READY`, () => buildReady(`price-${name}`, options)); await runSuccessScenario(`${scenarioId}_MUTATION`, () => mutate(fixture));
      const rejected = await expectDomainError({ scenarioId, expectedSqlState: "23514", expectedCode: "CHECKOUT_PRICE_STALE", action: () => fixture.submit() });
      const [count] = await admin`select count(*)::int orders from orders where checkout_session_id=${fixture.checkout.id}`;
      assert.equal(count.orders, 0); priceCases.push({ name, rejected, orders: count.orders });
    }

    const concurrency = { doubleSubmit: [], hashConflict: [], deadlocks: 0, timeouts: 0, duplicates: 0 };
    for (let cycle = 0; cycle < 20; cycle++) {
      const fixture = await runSuccessScenario(`CONC_DOUBLE_SUBMIT_${String(cycle + 1).padStart(2, "0")}_FIXTURE_READY`, () => buildReady(`double-${cycle}`));
      const outcomes = await Promise.allSettled([fixture.submit(), fixture.submit()]);
      assert.ok(outcomes.every((item) => item.status === "fulfilled"));
      assert.equal(outcomes[0].value.order_id, outcomes[1].value.order_id);
      const [counts] = await admin`select (select count(*)::int from orders where checkout_session_id=${fixture.checkout.id}) orders,(select count(*)::int from order_status_events e join orders o on o.id=e.order_id where o.checkout_session_id=${fixture.checkout.id} and e.from_status is null) events`;
      assert.deepEqual([counts.orders, counts.events], [1, 1]); concurrency.doubleSubmit.push(true);
    }
    for (let cycle = 0; cycle < 20; cycle++) {
      const fixture = await runSuccessScenario(`CONC_HASH_CONFLICT_${String(cycle + 1).padStart(2, "0")}_FIXTURE_READY`, () => buildReady(`hash-${cycle}`));
      const outcomes = await Promise.allSettled([fixture.submit(), fixture.submit("e".repeat(64))]);
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      const rejected = outcomes.find((item) => item.status === "rejected"); assert.equal(rejected.reason.code, "23505");
      const [counts] = await admin`select count(*)::int orders from orders where checkout_session_id=${fixture.checkout.id}`;
      assert.equal(counts.orders, 1); concurrency.hashConflict.push(true);
    }
    result.aggregate = aggregate;
    result.inventory = { before: inventoryBefore, after: inventoryAfter };
    result.idempotency = { sameSame: true, conflict: divergentRetry, counts: postRetryCounts };
    result.guestAuthorization = { correct: true, wrongGuest, uuidOnly, rawCapabilityPersisted: false };
    result.taxDocument = { decrypts: true, temporaryCiphertextReused: false, type: durableDocument.type, masked: tax.masked };
    result.convertedCart = { terminal: true, errors: convertedErrors, reactivation };
    result.customerAuthorization = { correct: true, wrongCustomer: wrongCustomerResult, uuidOnly: uuidOnlyCustomerResult, override: overrideCustomerResult };
    result.priceRevalidation = { unchanged: true, staleCases: priceCases };
    result.concurrency = concurrency;
    result.scenarioControl = { total: scenarioResults.length, unlabeledErrors: 0, results: scenarioResults };
    result.negativeEvents = { missingEvent, duplicateEvent, wrongEvent, residue: negativeResidue.count };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  }
} finally {
  await Promise.allSettled([app?.end({ timeout: 3 }), worker?.end({ timeout: 3 }), admin?.end({ timeout: 3 })]);
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
