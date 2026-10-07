import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("autosave grava ao esconder/fechar a página e apaga o rascunho ao criar o pedido", () => {
  const source = read("hooks/useCheckoutDraft.ts");
  assert.match(source, /addEventListener\("pagehide"/);
  assert.match(source, /addEventListener\("visibilitychange"/);
  assert.match(source, /removeEventListener\("pagehide"/);
  assert.match(source, /removeEventListener\("visibilitychange"/);
  assert.match(source, /if \(disabled\)/);
  assert.match(source, /removeItem\(CHECKOUT_DRAFT_KEY\)/);
  // Armazenamento bloqueado nunca derruba o checkout.
  assert.match(source, /catch/);
});

test("rascunho usa a chave checkout_form_v1 e não persiste senha, OTP, cartão ou pagamento", () => {
  const draft = read("lib/commerce/checkoutDraft.ts");
  assert.match(draft, /CHECKOUT_DRAFT_KEY = "checkout_form_v1"/);
  const hook = read("hooks/useCheckoutDraft.ts");
  assert.doesNotMatch(hook, /password|otp|cardToken|paymentMethod|cvv/i);
});

test("CheckoutForm liga o autosave, o ?step= e o aviso de saída só para alterações não gravadas", () => {
  const source = read("components/Checkout/CheckoutForm.tsx");
  assert.match(source, /useCheckoutDraft\(methods, hasCreatedOrder\)/);
  assert.match(source, /readStoredCheckoutDraft\(\)/);
  assert.match(source, /mergeCheckoutDraft\(accountValues, savedDraft\)/);
  assert.match(source, /resolveInitialCheckoutStep\(/);
  assert.match(source, /addEventListener\("popstate"/);
  assert.match(source, /removeEventListener\("popstate"/);
  assert.match(source, /hasUnsavedDraft \|\| paymentMethod !== "inter_pix"/);
  assert.match(source, /useBeforeUnloadWarning\(hasUnsavedProgress && !hasCreatedOrder\)/);
});
