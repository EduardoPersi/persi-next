import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_CATALOG_WEBHOOK_BYTES, parseWooWebhookSignal, verifyWooWebhookSignature } from "../lib/catalog/webhookSecurity.ts";
import { normalizeStatus } from "../scripts/database/catalog-import/normalize.mjs";

test("webhook valida HMAC no corpo bruto e rejeita assinatura inválida", () => {
  const body=Buffer.from('{"id":123,"date_modified_gmt":"2026-08-24T12:00:00"}'),secret="test-secret",signature=createHmac("sha256",secret).update(body).digest("base64");
  assert.equal(verifyWooWebhookSignature(body,signature,secret),true);
  assert.equal(verifyWooWebhookSignature(body,`${signature.slice(0,-2)}xx`,secret),false);
  assert.equal(verifyWooWebhookSignature(Buffer.from(`${body} `),signature,secret),false);
  assert.deepEqual(parseWooWebhookSignal(JSON.parse(body)),{externalEntityId:"123",sourceChangedAt:"2026-08-24T12:00:00Z"});
  assert.equal(MAX_CATALOG_WEBHOOK_BYTES,65536);
});

test("archive policy não faz hard delete e reutiliza mapping no republish", async () => {
  assert.deepEqual(normalizeStatus("trash"),{status:"archived",publishedAt:null});
  assert.deepEqual(normalizeStatus("private"),{status:"draft",publishedAt:null});
  assert.equal(normalizeStatus("publish","2024-02-03T12:34:56").status,"active");
  const importer=await readFile(new URL("../scripts/database/catalog-import/import.mjs",import.meta.url),"utf8");
  assert.match(importer,/archived_at/);assert.match(importer,/where id=\$\{productId\}/);assert.doesNotMatch(importer,/delete from public\.products/);
});

test("readiness mantém webhook como sinal e protege operação", async () => {
  const route=await readFile(new URL("../app/api/internal/catalog-sync/webhook/route.ts",import.meta.url),"utf8"),worker=await readFile(new URL("../scripts/database/catalog-import/incremental-core.mjs",import.meta.url),"utf8"),health=await readFile(new URL("../app/api/internal/catalog-sync/health/route.ts",import.meta.url),"utf8");
  assert.match(route,/application\/json/);assert.match(route,/status: 202/);assert.match(route,/x-wc-webhook-delivery-id/);
  assert.match(worker,/for update skip locked/);assert.match(worker,/STALE_LEASE_RECOVERED/);assert.match(worker,/interval '5 minutes'/);
  assert.match(health,/private, no-store/);assert.match(health,/timingSafeEqual/);
});
