import {
  CHECKOUT_PREFILL_KEY,
  parseStoredCheckoutPrefill,
  serializeCheckoutPrefill,
  type CheckoutPrefill,
} from "./checkoutPrefill";

// Acesso à sessionStorage da aba para o pré-preenchimento do checkout. Todas
// as funções são seguras fora do navegador e com o armazenamento bloqueado.

export function readStoredCheckoutPrefill(): CheckoutPrefill | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredCheckoutPrefill(
      window.sessionStorage.getItem(CHECKOUT_PREFILL_KEY),
      Date.now(),
    );
  } catch {
    return null;
  }
}

export function storeCheckoutPrefill(prefill: CheckoutPrefill) {
  try {
    window.sessionStorage.setItem(
      CHECKOUT_PREFILL_KEY,
      serializeCheckoutPrefill(prefill, Date.now()),
    );
  } catch {
    // Sem armazenamento: o link simplesmente não pré-preenche.
  }
}

export function clearStoredCheckoutPrefill() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_PREFILL_KEY);
  } catch {
    // Nada a apagar.
  }
}
