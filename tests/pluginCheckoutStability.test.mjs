import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleRequest } from "../cloudflare/persi-checkout-proxy/src/index.js";

const read = (path) => readFileSync(path, "utf8");

const checkoutRedirect = read(
  "wordpress-plugin/persi-headless-checkout/src/Checkout/CheckoutRedirect.php",
);
const cartRestorer = read(
  "wordpress-plugin/persi-headless-checkout/src/Checkout/CartRestorer.php",
);
const lockdown = read(
  "wordpress-plugin/persi-headless/includes/storefront-lockdown/class-storefront-lockdown.php",
);
const pluginCore = read("wordpress-plugin/persi-headless/includes/class-plugin.php");
const diagnostics = read(
  "wordpress-plugin/persi-headless-checkout/src/Support/RequestDiagnostics.php",
);

test("transferência é adquirida atomicamente, usada uma vez e perde o token", () => {
  assert.match(checkoutRedirect, /->acquire\(/);
  assert.match(checkoutRedirect, /->mark_used\(/);
  assert.match(checkoutRedirect, /status.*pending/s);
  assert.match(checkoutRedirect, /remove_query_arg\( self::TOKEN_PARAMETER/);
  assert.match(checkoutRedirect, /wp_safe_redirect\( \$checkout_url, 303/);
});

test("consumo ignora AJAX, REST, admin e endpoints internos", () => {
  assert.match(checkoutRedirect, /! \$is_checkout_endpoint/);
  assert.match(checkoutRedirect, /! \$is_admin/);
  assert.match(checkoutRedirect, /! \$is_ajax/);
  assert.match(checkoutRedirect, /! \$is_rest/);
});

test("sessão e carrinho só são carregados quando ausentes", () => {
  assert.match(
    cartRestorer,
    /null === WC\(\)->session \|\| null === WC\(\)->customer \|\| null === WC\(\)->cart/,
  );
  assert.equal((cartRestorer.match(/wc_load_cart\(\)/g) ?? []).length, 1);
});

test("lockdown libera wc-ajax, wc-api, REST e admin-ajax", () => {
  for (const marker of ["wc-ajax", "wc-api", "/wp-json/", "/wp-admin/admin-ajax.php"]) {
    assert.ok(lockdown.includes(marker), `exceção ausente: ${marker}`);
  }
});

test("upgrade de banco não executa dbDelta no tráfego público", () => {
  assert.match(pluginCore, /add_action\( 'admin_init'.*maybe_upgrade_database/s);
  assert.match(pluginCore, /persi_headless_db_upgrade_lock/);
  assert.doesNotMatch(pluginCore.split("public function maybe_upgrade_database")[0], /::install\(\)/);
});

test("diagnóstico é opt-in e não registra segredos nem dados pessoais", () => {
  assert.match(diagnostics, /PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS/);
  assert.match(diagnostics, /path/);
  assert.match(diagnostics, /elapsed_ms/);
  assert.match(diagnostics, /queries/);
  assert.match(diagnostics, /mask_postcode/);
  assert.match(diagnostics, /woocommerce_package_rates/);
  assert.match(diagnostics, /get_zone_matching_package/);
  assert.match(diagnostics, /get_packages\(\)/);
  assert.doesNotMatch(diagnostics, /authorization|cpf|email|owner_token/i);
  assert.doesNotMatch(diagnostics, /\$_COOKIE\s*\[/);
});

test("ações críticas de wc-ajax preservam POST e resposta JSON 200", async () => {
  for (const action of ["update_order_review", "get_refreshed_fragments"]) {
    let forwarded;
    const response = await handleRequest(
      new Request(`https://persimateriais.com.br/checkout/?wc-ajax=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "security=test-nonce",
      }),
      async (url, init) => {
        forwarded = { url: String(url), init };
        return new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(forwarded.init.method, "POST");
    assert.match(forwarded.url, new RegExp(`wc-ajax=${action}`));
  }
});
