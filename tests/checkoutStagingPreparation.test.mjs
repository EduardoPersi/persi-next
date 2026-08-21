import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("health de staging é HMAC e verifica tabela, UNIQUE e versão", () => {
  const controller = read("wordpress-plugin/persi-headless-checkout/src/Api/CheckoutAttemptController.php");
  const repository = read("wordpress-plugin/persi-headless-checkout/src/Checkout/CheckoutAttemptRepository.php");
  assert.match(controller, /authenticate\(/);
  assert.match(controller, /'health'/);
  assert.match(repository, /SHOW TABLES LIKE/);
  assert.match(repository, /SHOW INDEX FROM/);
  assert.match(repository, /'Non_unique'/);
  assert.match(repository, /expected_database_version/);
});

test("teste concorrente exige duas instâncias, 20 chamadas e um pedido Woo real", () => {
  const script = read("scripts/checkout-staging-concurrency.mjs");
  assert.match(script, /instanceUrls\.length < 2/);
  assert.match(script, /length: 20/);
  assert.match(script, /_persi_idempotency_key/);
  assert.match(script, /realOrderIds\.length !== 1/);
  assert.match(script, /STAGING_STOPPED_BEFORE_GATEWAY/);
});

test("diagnóstico Woo registra status e duração sem payload ou credenciais", () => {
  const rest = read("services/woocommerce/restClient.ts");
  const cart = read("services/woocommerce/cart.ts");
  for (const source of [rest, cart]) {
    assert.match(source, /\[woocommerce-outbound\]/);
    assert.match(source, /durationMs/);
    assert.doesNotMatch(source, /\[woocommerce-outbound\][\s\S]{0,500}(authorization|cookie|cpf|email)/i);
  }
});
