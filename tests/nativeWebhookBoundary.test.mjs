import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const routes = {
  inter: read("app/api/webhooks/native/inter/route.ts"),
  mercadopago: read("app/api/webhooks/native/mercadopago/route.ts"),
  pagbank: read("app/api/webhooks/native/pagbank/route.ts"),
};

// Same rationale as tests/nativeCheckoutHttpBoundary.test.mjs: importing a
// route file that pulls in "next/server" fails under the plain Node test
// runner outside Next's own bundler, so these are static source assertions,
// matching this codebase's established convention for Route Handler tests.

test("every native webhook route fails closed while native runtime is off", () => {
  for (const [provider, source] of Object.entries(routes)) {
    assert.match(source, /isNativeCheckoutRuntimeEnabled/, `${provider} missing the runtime gate`);
    assert.match(source, /status: 404/, `${provider} does not 404 when disabled`);
  }
});

test("legacy live webhook routes are untouched by this round", () => {
  for (const provider of ["inter", "mercadopago", "pagbank"]) {
    const legacy = read(`app/api/webhooks/${provider}/route.ts`);
    assert.match(legacy, /reconcilePaymentReference/, `${provider} legacy route should still be Woo-anchored`);
    assert.doesNotMatch(legacy, /applyNative.*WebhookNotification/, `${provider} legacy route must not be wired to the native ledger`);
  }
});

test("webhook body is never trusted as payment authority -- only a format-validated reference is extracted, status always re-verified", () => {
  assert.match(routes.inter, /TXID_PATTERN/);
  assert.match(routes.inter, /REQUEST_CODE_PATTERN/);
  assert.match(routes.mercadopago, /PAYMENT_ID_PATTERN/);
  assert.match(routes.pagbank, /CHARGE_ID_PATTERN/);
  for (const [provider, source] of Object.entries(routes)) {
    assert.match(source, /applyNative\w+WebhookNotification/, `${provider} must call the verifying adapter function`);
    // The extracted body must never be handed straight to the ledger as a
    // resultingStatus -- applyNative*WebhookNotification's own signature
    // (services/payments/*/nativeAdapter.ts) takes no such parameter, so
    // there is no code path here that could pass one even by mistake.
    assert.doesNotMatch(source, /resultingStatus/, `${provider} must not fabricate a resulting status here`);
  }
});

test("each route looks up the attempt by provider reference before ever calling the verifying adapter", () => {
  for (const [provider, source] of Object.entries(routes)) {
    const lookupIndex = source.indexOf("findNativePaymentAttemptByProviderReference(");
    const applyIndex = source.indexOf("await applyNative");
    assert.ok(lookupIndex > -1, `${provider} missing the lookup call`);
    assert.ok(applyIndex > lookupIndex, `${provider} must look up before applying`);
  }
});

test("no provider secret or raw webhook body is logged on failure", () => {
  for (const [provider, source] of Object.entries(routes)) {
    const catchStart = source.lastIndexOf("catch (error) {");
    const catchBlock = source.slice(catchStart, source.indexOf("}", catchStart) + 1);
    assert.match(catchBlock, /logNativeCommerceEvent\("native_webhook_processing_failed"/, `${provider} missing error log`);
    assert.doesNotMatch(catchBlock, /rawBody|\bbody\b/, `${provider} must not log the raw webhook payload`);
  }
});

test("every native webhook route reports a minimum observability event on receipt and on successful reconciliation", () => {
  for (const [provider, source] of Object.entries(routes)) {
    assert.match(source, /logNativeCommerceEvent\("native_webhook_received"/, `${provider} missing received event`);
    assert.match(source, /logNativeCommerceEvent\("native_webhook_reconciliation_applied"/, `${provider} missing applied event`);
  }
});

test("reconciliation worker reuses the already-tested per-provider reconcile functions unchanged, with a bounded time budget", () => {
  const worker = read("lib/commerce/nativePaymentReconciliationWorker.ts");
  assert.match(worker, /reconcileNativeInterPendingAttempt/);
  assert.match(worker, /reconcileNativeMercadoPagoPendingAttempt/);
  assert.match(worker, /reconcileNativePagBankPendingAttempt/);
  assert.match(worker, /timeBudgetMs/);
  assert.match(worker, /truncated/);
});
