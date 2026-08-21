import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("health de pagamento é protegido e não retorna segredos", () => {
  const source = read("app/api/checkout/payment/health/route.ts");
  assert.match(source, /CHECKOUT_STAGING_DRY_RUN_SECRET/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /status: 404/);
  assert.doesNotMatch(source, /clientSecret:/);
  assert.doesNotMatch(source, /certificateRaw/);
  assert.doesNotMatch(source, /privateKeyRaw/);
});

test("health valida tentativa, OAuth, mTLS e leitura Pix e boleto sem criar cobrança", () => {
  const source = read("app/api/checkout/payment/health/route.ts");
  assert.match(source, /healthCheckoutAttempt/);
  assert.match(source, /verifyInterAuthentication/);
  assert.match(source, /getInterConfigurationDiagnostics/);
  assert.match(source, /getPixChargeStatus/);
  assert.match(source, /getBoletoChargeStatus/);
  assert.doesNotMatch(source, /createPixCharge|createBoletoCharge/);
});
