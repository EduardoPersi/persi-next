import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("confirmação por attempt restaura Pix e boleto sem criar cobrança", () => {
  const page = read("app/checkout/confirmacao/page.tsx");
  const pending = read("components/Checkout/PendingPaymentConfirmation.tsx");

  assert.match(page, /PendingPaymentConfirmation/);
  assert.match(page, /expiresAt: charge\.expiresAt/);
  assert.match(page, /barcode: charge\.barcode/);
  assert.match(page, /dueDate: charge\.dueDate/);
  assert.match(pending, /PixPaymentResult/);
  assert.match(pending, /BoletoPaymentResult/);
  assert.doesNotMatch(pending, /\/api\/checkout\/payment["'`]/);
});

test("polling consulta apenas status, aborta ao desmontar e respeita aba oculta", () => {
  const hook = read("hooks/usePaymentStatusPolling.ts");
  const pix = read("components/Checkout/PixPaymentResult.tsx");
  const boleto = read("components/Checkout/BoletoPaymentResult.tsx");

  assert.match(hook, /new AbortController/);
  assert.match(hook, /controller\?\.abort\(\)/);
  assert.match(hook, /document\.hidden/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /MAX_ACTIVE_POLL_DURATION_MS/);
  assert.match(pix, /\/api\/checkout\/payment\/status\?provider=inter_pix/);
  assert.match(boleto, /\/api\/checkout\/payment\/status\?provider=inter_boleto/);
  assert.doesNotMatch(`${pix}\n${boleto}`, /import .*createPixCharge|import .*createBoletoCharge/);
});

test("Pix usa expiração autoritativa e só encerra após status terminal", () => {
  const pix = read("components/Checkout/PixPaymentResult.tsx");
  assert.match(pix, /getSecondsRemaining\(result\.expiresAt\)/);
  assert.match(pix, /body\?\.category === "paid"/);
  assert.match(pix, /body\?\.category === "failed"/);
  assert.doesNotMatch(pix, /if \(secondsRemaining <= 0\) onExpired/);
  assert.match(pix, /navigator\.clipboard\.writeText/);
  assert.match(pix, /document\.execCommand\("copy"\)/);
});

test("boleto preserva linha digitável, vencimento, PDF e polling espaçado", () => {
  const boleto = read("components/Checkout/BoletoPaymentResult.tsx");
  assert.match(boleto, /digitableLine/);
  assert.match(boleto, /formatDueDate/);
  assert.match(boleto, /boleto-pdf/);
  assert.match(boleto, /fastIntervalMs: 20_000/);
  assert.match(boleto, /slowIntervalMs: 30_000/);
});

test("status pago reconcilia pedido Woo e checkout_attempt", () => {
  const page = read("app/checkout/confirmacao/page.tsx");
  const status = read("app/api/checkout/payment/status/route.ts");
  for (const source of [page, status]) {
    assert.match(source, /reconcilePaymentReference/);
    assert.match(source, /reconcileCheckoutAttempt/);
  }
});
