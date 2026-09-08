import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration="supabase/migrations/20260904010000_secure_checkout_pii_foundation.sql";
test("P3-A stores only a complete encrypted envelope and no plaintext address columns",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/num_nonnulls\([\s\S]*?\) in \(0,9\)/);
  assert.match(sql,/AES-256-GCM/); assert.doesNotMatch(sql,/add column (first_name|email|phone|street|tax_document)/i);
});
test("PII operations are owner checked, optimistic and browser denied",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/s\.version<>p_expected_version/); assert.match(sql,/CHECKOUT_OWNER_DENIED/);
  assert.match(sql,/revoke all on function[\s\S]*from public,anon,authenticated/); assert.doesNotMatch(sql,/to anon|to authenticated/);
});
test("ready is immutable, cleanup minimized, and destination change deletes stale quotes",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/old\.status not in \('open','validating'\)/); assert.match(sql,/CHECKOUT_PII_CLEANUP_STATE_INVALID/);
  assert.match(sql,/delete from public\.checkout_shipping_quotes/); assert.match(sql,/pii_destination_fingerprint=null/);
});
test("public checkout projection does not expose encrypted material",async()=>{
  const source=await readFile("lib/db/nativeCheckout.ts","utf8");
  const read=source.slice(source.indexOf("export async function readNativeCheckout"));
  assert.doesNotMatch(read,/piiCiphertext|piiIv|piiAuthTag|piiFingerprint/);
});
test("raw external provider error bodies are no longer logged",async()=>{
  for(const file of ["services/woocommerce/restClient.ts","services/payments/pagbank/client.ts","services/payments/mercadopago/client.ts"]){
    const source=await readFile(file,"utf8"); assert.match(source,/sanitizeProviderError/); assert.doesNotMatch(source,/body:\s*parsedBody|errorMessages:/);
  }
});
