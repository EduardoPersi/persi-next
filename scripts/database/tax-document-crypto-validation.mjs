import assert from "node:assert/strict";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import {
  decryptDurableTaxDocument,
  encryptDurableTaxDocument,
} from "../../lib/commerce/taxDocumentCrypto.ts";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");

const sql = postgres(localDatabaseUrl(), {
  max: 1,
  prepare: false,
});
const storeId = crypto.randomUUID();
const cartId = crypto.randomUUID();
const checkoutId = crypto.randomUUID();
const orderId = crypto.randomUUID();
const correlationId = crypto.randomUUID();
const canonicalDigits = "52998224725";
const encryptionKey = Buffer.alloc(32, 91);
const fingerprintKey = Buffer.alloc(32, 92);
const keys = {
  currentKeyId: () => "tax-local-v1",
  encryptionKey: () => encryptionKey,
  fingerprintKey: () => fingerprintKey,
};
const bundle = encryptDurableTaxDocument({
  document: { type: "cpf", value: canonicalDigits },
  storeId,
  orderId,
  keys,
});

let persisted = false;
let decrypted = false;
let plaintextAbsent = false;
try {
  await sql.begin(async (tx) => {
    await tx`insert into public.stores(id,code,name,status) values(${storeId},${`tax-${storeId}`},'Synthetic Tax Store','active')`;
    await tx`insert into public.carts(id,store_id,guest_token_fingerprint,expires_at) values(${cartId},${storeId},${"a".repeat(64)},now()+interval '1 hour')`;
    await tx`insert into public.checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at) values(${checkoutId},${storeId},${cartId},'open','BRL',${`tax-${checkoutId}`},${"b".repeat(64)},0,false,now()+interval '30 minutes')`;
    await tx`insert into public.orders(id,store_id,checkout_session_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,tax_id_type,tax_id_ciphertext,tax_id_fingerprint,tax_id_masked,correlation_id) values(${orderId},${storeId},${checkoutId},1,${`TAX-${orderId}`},'BRL',0,0,'Synthetic Person','fixture@example.invalid',${bundle.type},${bundle.ciphertext},${bundle.fingerprint},${bundle.masked},${correlationId})`;
    await tx`insert into public.order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${correlationId})`;
    const rows = await tx`select tax_id_type,tax_id_ciphertext,tax_id_fingerprint,tax_id_masked from public.orders where id=${orderId}`;
    assert.equal(rows.length, 1);
    persisted = rows[0].tax_id_type === "cpf" && rows[0].tax_id_masked === "***.***.***-25";
    plaintextAbsent = !JSON.stringify(rows[0]).includes(canonicalDigits);
    const recovered = decryptDurableTaxDocument({
      bundle: {
        type: rows[0].tax_id_type,
        ciphertext: rows[0].tax_id_ciphertext,
        fingerprint: rows[0].tax_id_fingerprint,
        masked: rows[0].tax_id_masked,
      },
      storeId,
      orderId,
      keys,
    });
    decrypted = recovered.value === canonicalDigits;
    throw new Error("EXPECTED_FIXTURE_ROLLBACK");
  });
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("EXPECTED_FIXTURE_ROLLBACK")) throw error;
} finally {
  const remaining = await sql`select count(*)::int as count from public.stores where id=${storeId}`;
  await sql.end({ timeout: 5 });
  assert.equal(remaining[0].count, 0);
}

assert.equal(persisted, true);
assert.equal(plaintextAbsent, true);
assert.equal(decrypted, true);
console.log(JSON.stringify({ persisted, plaintextAbsent, decrypted, fixtureRolledBack: true }));
