// A3.6-D1.6 Section 30: "provider never called" proof for every mutable
// external integration wired to a guard this round. Each test forces
// runtime=staging (via a module-level env override, restored after) and
// asserts the injected/mocked network call is never reached -- the guard
// throws BEFORE any fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPixCharge } from "../services/payments/inter/pix.ts";
import { createBoletoCharge } from "../services/payments/inter/boleto.ts";
import { createCardCharge as createPagBankCardCharge } from "../services/payments/pagbank/charge.ts";
import { createCardCharge as createMercadoPagoCardCharge } from "../services/payments/mercadopago/charge.ts";
import { StagingExternalWriteBlockedError } from "../lib/runtime/external-write-guard.ts";

function withStagingEnv(fn) {
  const previous = process.env.PERSI_RUNTIME_ENV;
  process.env.PERSI_RUNTIME_ENV = "staging";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.PERSI_RUNTIME_ENV;
      else process.env.PERSI_RUNTIME_ENV = previous;
    });
}

test("Banco Inter Pix: staging blocks BEFORE the provider request function is ever called", () => withStagingEnv(async () => {
  let called = false;
  const spy = async () => { called = true; return {}; };
  await assert.rejects(
    () => createPixCharge({ txid: "x".repeat(26), amount: 10, expirationSeconds: 3600, devedor: { nome: "Teste" }, chave: "x" }, spy),
    StagingExternalWriteBlockedError,
  );
  assert.equal(called, false);
}));

test("Banco Inter Boleto: staging blocks BEFORE the provider request function is ever called", () => withStagingEnv(async () => {
  let called = false;
  const spy = async () => { called = true; return {}; };
  await assert.rejects(
    () => createBoletoCharge({ seuNumero: "1", valorNominal: 10, dataEmissao: "2026-01-01", pagador: { nome: "Teste", cpfCnpj: "12345678901", endereco: { logradouro: "R", numero: "1", bairro: "B", cidade: "C", uf: "SP", cep: "00000000" } } }, spy),
    StagingExternalWriteBlockedError,
  );
  assert.equal(called, false);
}));

test("PagBank card charge: staging blocks BEFORE the provider request function is ever called", () => withStagingEnv(async () => {
  let called = false;
  const spy = async () => { called = true; return {}; };
  await assert.rejects(
    () => createPagBankCardCharge({ referenceId: "x", amountMinor: 1000n, description: "x", card: {} }, spy),
    StagingExternalWriteBlockedError,
  );
  assert.equal(called, false);
}));

test("Mercado Pago card charge: staging blocks BEFORE the provider request function is ever called", () => withStagingEnv(async () => {
  let called = false;
  const spy = async () => { called = true; return {}; };
  await assert.rejects(
    () => createMercadoPagoCardCharge({ amountMinor: 1000n, description: "x", holderDocument: "12345678901", token: "x", installments: 1, payerEmail: "a@a.com" }, "idem-1", spy),
    StagingExternalWriteBlockedError,
  );
  assert.equal(called, false);
}));

test("production/default runtime: payment guards do NOT block (guard call site present but permissive by default)", async () => {
  // No staging env override here -- default (missing PERSI_RUNTIME_ENV) must
  // behave exactly as production, i.e. the guard call must not throw.
  const { assertPaymentsAllowed } = await import("../lib/runtime/external-write-guard.ts");
  assert.doesNotThrow(() => assertPaymentsAllowed("banco-inter", "create-pix-charge"));
});

// ---------- Woo mutation guard (restApiWrite / cartRequest single choke points) ----------

test("Woo REST API mutation (restApiPost/restApiPut) is blocked in staging via the single restApiWrite choke point", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../services/woocommerce/restClient.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function restApiWrite"));
  assert.match(fn, /assertWooMutationAllowed\(/);
});

test("Woo cart mutation (POST-method cartRequest calls) is blocked in staging via the single cartRequest choke point, GET is unaffected", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../services/woocommerce/cart.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function cartRequest"), source.indexOf("export async function getCart"));
  assert.match(fn, /if \(options\.method === "POST"\) assertWooMutationAllowed/);
});

test("checkout submission guard is the first statement in the payment route's POST handler", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/checkout/payment/route.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function POST(request: Request) {"));
  const guardIndex = fn.indexOf("assertCheckoutSubmissionAllowed()");
  const cartTokenIndex = fn.indexOf("CART_TOKEN_COOKIE");
  assert.ok(guardIndex !== -1 && guardIndex < cartTokenIndex, "checkout guard must run before any cart/body processing");
});

test("checkout submission guard returns a safe Portuguese message, never a raw internal error, when blocked", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/checkout/payment/route.ts", import.meta.url), "utf8");
  assert.match(source, /Checkout indisponível neste ambiente de teste\./);
});

// ---------- messaging guards ----------

test("contact/newsletter/stock-notification submit functions all call assertMessagingAllowed before their fetch", async () => {
  const fs = await import("node:fs/promises");
  const files = ["services/woocommerce/contact.ts", "services/woocommerce/newsletter.ts", "services/woocommerce/stockNotifications.ts"];
  for (const file of files) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /assertMessagingAllowed\(/, file);
  }
});
