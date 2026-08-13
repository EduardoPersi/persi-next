import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOriginUrl,
  rewriteCheckoutHtml,
  rewriteLocation,
  rewriteSetCookie,
  splitSetCookieHeader,
  handleRequest,
} from "../cloudflare/persi-checkout-proxy/src/index.js";

test("transferência pública vira consumo de token no checkout WooCommerce", () => {
  const token = "A".repeat(43);
  assert.equal(
    buildOriginUrl(`https://persimateriais.com.br/checkout/transfer?token=${token}`).toString(),
    `https://loja.persimateriais.com.br/checkout/?persi_checkout_transfer=${token}`,
  );
});

test("resposta proxied preserva múltiplos cookies, no-store e redirect público", async () => {
  const originHeaders = new Headers({
    Location: "https://loja.persimateriais.com.br/checkout/",
    "Set-Cookie": "woocommerce_cart_hash=abc; Path=/; Secure, woocommerce_items_in_cart=1; Path=/; Secure",
  });
  const response = await handleRequest(
    new Request(`https://persimateriais.com.br/checkout/transfer?token=${"A".repeat(43)}`),
    async () => new Response(null, { status: 303, headers: originHeaders }),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://persimateriais.com.br/checkout/");
  assert.match(response.headers.get("cache-control"), /no-store/);
  const cookies = splitSetCookieHeader(response.headers.get("set-cookie"));
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((cookie) => !/Domain=/i.test(cookie)));
});

test("checkout, wc-ajax e admin-ajax ficam limitados ao namespace público", () => {
  assert.equal(
    buildOriginUrl("https://persimateriais.com.br/checkout/?wc-ajax=update_order_review").toString(),
    "https://loja.persimateriais.com.br/?wc-ajax=update_order_review",
  );
  assert.equal(
    buildOriginUrl("https://persimateriais.com.br/checkout/admin-ajax.php?action=smart_checkout_auth").toString(),
    "https://loja.persimateriais.com.br/wp-admin/admin-ajax.php?action=smart_checkout_auth",
  );
});

test("proxy preserva POST, corpo, content-type e cookies do wc-ajax", async () => {
  let forwarded;
  const response = await handleRequest(
    new Request(
      "https://persimateriais.com.br/checkout/?wc-ajax=update_order_review",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: "wp_woocommerce_session_hash=session",
          Origin: "https://persimateriais.com.br",
          Referer: "https://persimateriais.com.br/checkout/",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: "security=nonce&post_data=billing_country%3DBR",
      },
    ),
    async (url, init) => {
      forwarded = { url: url.toString(), init };
      return Response.json({ result: "success" });
    },
  );

  assert.equal(forwarded.url, "https://loja.persimateriais.com.br/?wc-ajax=update_order_review");
  assert.equal(forwarded.init.method, "POST");
  assert.equal(
    new TextDecoder().decode(forwarded.init.body),
    "security=nonce&post_data=billing_country%3DBR",
  );
  assert.equal(forwarded.init.headers.get("content-type"), "application/x-www-form-urlencoded; charset=UTF-8");
  assert.equal(forwarded.init.headers.get("cookie"), "wp_woocommerce_session_hash=session");
  assert.equal(forwarded.init.headers.get("origin"), "https://loja.persimateriais.com.br");
  assert.equal(forwarded.init.headers.get("referer"), "https://loja.persimateriais.com.br/checkout/?wc-ajax=update_order_review");
  assert.equal(forwarded.init.headers.get("x-requested-with"), "XMLHttpRequest");
  assert.equal(response.status, 200);
});

test("cookies se tornam host-only sem perder atributos", () => {
  const cookie = rewriteSetCookie(
    "wp_woocommerce_session_hash=value; Path=/; Domain=loja.persimateriais.com.br; Max-Age=3600; Secure; HttpOnly; SameSite=Lax",
  );
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.match(cookie, /Path=\/checkout\//);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(
    splitSetCookieHeader("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT, b=2; Path=/").length,
    2,
  );
});

test("somente redirects e URLs funcionais do checkout são reescritos", () => {
  assert.equal(
    rewriteLocation("https://loja.persimateriais.com.br/checkout/order-received/10/?key=x"),
    "https://persimateriais.com.br/checkout/order-received/10/?key=x",
  );
  assert.equal(
    rewriteLocation("https://loja.persimateriais.com.br/wp-admin/"),
    "https://loja.persimateriais.com.br/wp-admin/",
  );
  assert.equal(
    rewriteLocation("https://loja.persimateriais.com.br/carrinho/"),
    "https://persimateriais.com.br/carrinho",
  );
  const html = rewriteCheckoutHtml(
    'ajax="https://loja.persimateriais.com.br/?wc-ajax=x" admin="/wp-admin/admin-ajax.php" escaped="\\/wp-admin\\/admin-ajax.php" asset="https://loja.persimateriais.com.br/wp-content/a.js" action="https://loja.persimateriais.com.br/checkout/"',
  );
  assert.match(html, /persimateriais\.com\.br\/checkout\/\?wc-ajax=x/);
  assert.match(html, /loja\.persimateriais\.com\.br\/wp-content\/a\.js/);
  assert.match(html, /action="https:\/\/persimateriais\.com\.br\/checkout\/"/);
  assert.match(html, /admin="\/checkout\/admin-ajax\.php"/);
  assert.match(html, /escaped="\\\/checkout\\\/admin-ajax\.php"/);
});

test("token malformado é rejeitado no edge sem chegar ao WordPress", async () => {
  let called = false;
  const response = await handleRequest(
    new Request("https://persimateriais.com.br/checkout/transfer?token=invalido"),
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
