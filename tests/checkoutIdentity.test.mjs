import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  maskCheckoutEmail,
  normalizeCheckoutEmail,
  parseCheckoutIdentityPayload,
} from "../lib/checkout-auth/validation.ts";
import {
  CheckoutIdentityServiceError,
  createCheckoutIdentitySignature,
  requestCheckoutIdentity,
} from "../services/checkout/checkoutIdentity.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("e-mail do checkout é normalizado, validado e mascarado", () => {
  assert.equal(normalizeCheckoutEmail("  Cliente@Exemplo.COM "), "cliente@exemplo.com");
  assert.equal(maskCheckoutEmail("cliente@exemplo.com"), "c******@exemplo.com");
  assert.deepEqual(parseCheckoutIdentityPayload('{"email":" Cliente@Exemplo.COM "}', "identify"), { email: "cliente@exemplo.com" });
  assert.throws(() => parseCheckoutIdentityPayload('{"email":"inválido"}', "identify"));
  assert.throws(() => parseCheckoutIdentityPayload('{"email":"a@b.com","extra":true}', "identify"));
});

test("senha e OTP usam contratos fechados", () => {
  assert.deepEqual(parseCheckoutIdentityPayload('{"email":"a@b.com","password":"segredo"}', "password"), { email: "a@b.com", password: "segredo" });
  assert.deepEqual(parseCheckoutIdentityPayload('{"email":"a@b.com","code":"123456"}', "code-verify"), { email: "a@b.com", code: "123456" });
  assert.throws(() => parseCheckoutIdentityPayload('{"email":"a@b.com","code":"12345"}', "code-verify"));
});

test("proxy assina a rota REST exata sem expor o segredo", async () => {
  const previousUrl = process.env.WORDPRESS_URL;
  const previousSecret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
  process.env.WORDPRESS_URL = "https://loja.example";
  process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = "s".repeat(32);
  try {
    const body = '{"email":"a@b.com"}';
    const fingerprint = "f".repeat(64);
    const result = await requestCheckoutIdentity(
      "/checkout-auth/identify",
      body,
      fingerprint,
      async (url, init) => {
        assert.equal(url, "https://loja.example/wp-json/persi-headless/v1/checkout-auth/identify");
        const headers = new Headers(init?.headers);
        const canonical = [
          headers.get("x-persi-timestamp"),
          headers.get("x-persi-nonce"),
          "POST",
          "/persi-headless/v1/checkout-auth/identify",
          fingerprint,
          body,
        ].join("\n");
        assert.equal(
          headers.get("x-persi-signature"),
          createHmac("sha256", "s".repeat(32)).update(canonical).digest("hex"),
        );
        assert.equal(headers.get("x-persi-client-fingerprint"), fingerprint);
        return Response.json({ exists: false });
      },
    );
    assert.deepEqual(result.body, { exists: false });
  } finally {
    if (previousUrl === undefined) delete process.env.WORDPRESS_URL;
    else process.env.WORDPRESS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
    else process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = previousSecret;
  }
});

test("vetor HMAC determinístico coincide com o teste PHP", () => {
  assert.equal(
    createCheckoutIdentitySignature({
      secret: "s".repeat(32),
      timestamp: "1724241600",
      nonce: "123e4567-e89b-12d3-a456-426614174000",
      method: "POST",
      restRoute: "/persi-headless/v1/checkout-auth/identify",
      clientFingerprint: "f".repeat(64),
      rawBody: '{"email":"novo@example.com"}',
    }),
    "15e5dd9e3725db9a7f6c8de7faf2774527db3dd862eadef4efeb8d64621f2256",
  );
});

test("serviço distingue configuração, timeout e rede", async () => {
  const previousUrl = process.env.WORDPRESS_URL;
  const previousSecret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
  try {
    process.env.WORDPRESS_URL = "https://loja.example";
    delete process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
    await assert.rejects(
      requestCheckoutIdentity("/checkout-auth/identify", "{}", "f".repeat(64)),
      (error) => error instanceof CheckoutIdentityServiceError && error.category === "configuration",
    );
    process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = "s".repeat(32);
    await assert.rejects(
      requestCheckoutIdentity("/checkout-auth/identify", "{}", "f".repeat(64), async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
      (error) => error instanceof CheckoutIdentityServiceError && error.category === "timeout",
    );
    await assert.rejects(
      requestCheckoutIdentity("/checkout-auth/identify", "{}", "f".repeat(64), async () => {
        throw new TypeError("network");
      }),
      (error) => error instanceof CheckoutIdentityServiceError && error.category === "network",
    );
  } finally {
    if (previousUrl === undefined) delete process.env.WORDPRESS_URL;
    else process.env.WORDPRESS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
    else process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = previousSecret;
  }
});

test("serviço preserva status 200, 301, 401, 403 e 500 sem seguir redirect", async () => {
  const previousUrl = process.env.WORDPRESS_URL;
  const previousSecret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
  process.env.WORDPRESS_URL = "https://loja.example";
  process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = "s".repeat(32);
  try {
    const nonces = new Set();
    for (const status of [200, 301, 401, 403, 500]) {
      const result = await requestCheckoutIdentity(
        "/checkout-auth/identify",
        "{}",
        "f".repeat(64),
        async (_url, init) => {
          assert.equal(init?.redirect, "manual");
          nonces.add(new Headers(init?.headers).get("x-persi-nonce"));
          return new Response("{}", { status });
        },
      );
      assert.equal(result.status, status);
    }
    assert.equal(nonces.size, 5);
  } finally {
    if (previousUrl === undefined) delete process.env.WORDPRESS_URL;
    else process.env.WORDPRESS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET;
    else process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET = previousSecret;
  }
});

test("checkout anônimo monta identidade antes do formulário", () => {
  const page = read("app/checkout/page.tsx");
  const gate = read("components/Checkout/CheckoutIdentityGate.tsx");
  assert.match(page, /authenticated \? \(/);
  assert.match(page, /<CheckoutIdentityGate/);
  assert.match(gate, /state === "guest"/);
  assert.match(gate, /initialGuestEmail=\{email\}/);
  assert.match(gate, /sessionStorage/);
  assert.doesNotMatch(gate, /localStorage/);
  assert.match(gate, /finally \{\s*setLoading\(false\)/);
  assert.match(gate, /email=\{email\}/);
  assert.match(read("components/Checkout/CheckoutEmailStep.tsx"), /Tentar novamente/);
});

test("OTP visual aceita colagem, navegação e one-time-code", () => {
  const otp = read("components/Checkout/CheckoutOtpStep.tsx");
  assert.match(otp, /slice\(0, 6\)/);
  assert.match(otp, /event\.key === "Backspace"/);
  assert.match(otp, /one-time-code/);
  assert.match(otp, /maxLength=\{1\}/);
});

test("plugin protege endpoints e armazena somente hash do OTP", () => {
  const controller = read("wordpress-plugin/persi-headless/includes/checkout-auth/class-checkout-auth.php");
  const authenticator = read("wordpress-plugin/persi-headless/includes/checkout-auth/class-authenticator.php");
  assert.match(controller, /random_int\( 100000, 999999 \)/);
  assert.match(controller, /wp_hash_password\( \$code \)/);
  assert.match(controller, /wp_check_password\( \$code, \$hash \)/);
  assert.match(controller, /CODE_MAX_ATTEMPTS = 5/);
  assert.match(controller, /CODE_COOLDOWN_SECONDS = 60/);
  assert.match(controller, /delete_user_meta/);
  assert.match(controller, /wp_signon/);
  assert.match(controller, /wp_set_auth_cookie/);
  assert.match(authenticator, /hash_equals/);
  assert.match(authenticator, /persi_checkout_auth_nonce_/);
  assert.match(authenticator, /strlen\( \$secret \) < 32/);
  assert.match(authenticator, /hash_equals\( strtolower\( \$key_id \), \$received_key \)/);
  assert.match(authenticator, /abs\( time\(\) - \(int\) \$timestamp \) > self::WINDOW_SECONDS/);
  assert.doesNotMatch(controller, /error_log/);
});

test("login do checkout preserva o Cart-Token", () => {
  const route = read("lib/checkout-auth/route.ts");
  assert.match(route, /AUTH_COOKIE_NAME/);
  assert.doesNotMatch(route, /Cart-Token|CART_TOKEN_COOKIE_NAME|getExpiredCart/);
});
