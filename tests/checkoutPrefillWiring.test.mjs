import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("a captura do link fica no layout, guarda na sessão (sem cookie) e limpa a URL", () => {
  assert.match(read("app/layout.tsx"), /<CheckoutPrefillCapture \/>/);
  const capture = read("components/Checkout/CheckoutPrefillCapture.tsx");
  assert.match(capture, /storeCheckoutPrefill\(prefill\)/);
  assert.match(capture, /history\.replaceState/);
  assert.match(capture, /stripCheckoutPrefillParams/);
  assert.doesNotMatch(capture, /document\.cookie/);
  const storage = read("lib/commerce/checkoutPrefillStorage.ts");
  assert.match(storage, /sessionStorage/);
  assert.doesNotMatch(storage, /localStorage|document\.cookie/);
});

test("o analytics nunca recebe os parâmetros de pré-preenchimento", () => {
  const source = read("components/layout/AnalyticsPageView.tsx");
  assert.match(source, /stripCheckoutPrefillParams/);
  assert.match(source, /stripCheckoutPrefillFromHref\(window\.location\.href\)/);
  assert.doesNotMatch(source, /page_location: window\.location\.href/);
});

test("precedência: conta, depois link, depois rascunho; link é consumido uma vez", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const link = form.indexOf("mergeCheckoutPrefill(accountValues, linkPrefill)");
  const draft = form.indexOf("mergeCheckoutDraft(withLink, savedDraft)");
  assert.ok(link > 0 && draft > link);
  assert.match(form, /clearStoredCheckoutPrefill\(\)/);
});

test("o portão de e-mail só usa o e-mail do link com o campo vazio", () => {
  const gate = read("components/Checkout/CheckoutIdentityGate.tsx");
  assert.match(gate, /readStoredCheckoutPrefill\(\)\?\.email/);
  assert.match(gate, /setEmail\(\(current\) => current \|\| prefilledEmail\)/);
});

test("a busca de CEP do formulário só completa campos vazios", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.match(form, /fillIfEmpty\("addressLine1", address\.address1\)/);
  assert.match(form, /fillIfEmpty\("city", address\.city\)/);
});
