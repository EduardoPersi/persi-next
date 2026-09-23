import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static source-inspection tests, matching this codebase's own established
// convention for Next.js Route Handlers (tests/nativeCheckoutHttpBoundary.test.mjs,
// tests/checkoutPaymentHealth.test.mjs do the same, for the same reason:
// importing a route file that pulls in "next/server" fails under the plain
// Node test runner). These pin the exact wiring shape of every new Gate 3
// route instead. The business logic each route delegates to is exercised
// directly (no next/server import) by tests/nativeCartHandlers.test.mjs and
// tests/nativeCheckoutPrepHandlers.test.mjs.

const read = (path) => readFileSync(path, "utf8");

const cartRoutes = [
  "app/api/cart/native/route.ts",
  "app/api/cart/native/items/route.ts",
  "app/api/cart/native/items/[variantId]/route.ts",
];
const checkoutRoutes = [
  "app/api/checkout/native/prepare/route.ts",
  "app/api/checkout/native/pii/route.ts",
  "app/api/checkout/native/ready/route.ts",
];
const allNewRoutes = [...cartRoutes, ...checkoutRoutes];

function exportedHandlerBodies(source) {
  const bodies = [];
  const regex = /export async function (GET|POST|PATCH|DELETE)\(/g;
  let match;
  const starts = [];
  while ((match = regex.exec(source))) starts.push(match.index);
  for (let i = 0; i < starts.length; i += 1) {
    bodies.push(source.slice(starts[i], starts[i + 1] ?? source.length));
  }
  return bodies;
}

// ---------- staging gate is checked first, in every exported handler ----------

test("every new Gate 3 route checks stagingGateResponse() as its first statement, in every exported handler", () => {
  for (const path of allNewRoutes) {
    const source = read(path);
    const bodies = exportedHandlerBodies(source);
    assert.ok(bodies.length > 0, `${path} deve exportar pelo menos um handler`);
    for (const body of bodies) {
      const gateIndex = body.indexOf("stagingGateResponse()");
      assert.ok(gateIndex > -1, `${path}: cada handler deve chamar stagingGateResponse()`);
      // Nothing meaningful (another guard, a DB call, a body parse) may run
      // before the gate check -- the very first non-brace line of the
      // function body must be the gate assignment.
      const beforeGate = body.slice(body.indexOf("{") + 1, gateIndex);
      assert.doesNotMatch(beforeGate, /await |resolveGuestOwner|rateLimitResponse|originGuardResponse/, `${path}: nada deve rodar antes do gate de staging`);
    }
  }
});

test("the staging gate itself is production-safe: disabled unless staging AND the flag is exactly \"true\"", () => {
  const gateSource = read("lib/runtime/native-commerce-staging-routes.ts");
  assert.match(gateSource, /getPersiRuntimeEnvironment\(environment\) === "staging"/);
  assert.match(gateSource, /flag === "true"/);
});

// ---------- Origin check on every mutating route ----------

test("every mutating Gate 3 route (POST/PATCH/DELETE) checks originGuardResponse before any DB call", () => {
  for (const path of allNewRoutes) {
    const source = read(path);
    for (const body of exportedHandlerBodies(source)) {
      const isGet = body.startsWith("export async function GET(");
      if (isGet) continue;
      assert.match(body, /originGuardResponse\(request\)/, `${path}: rotas de mutação devem checar a Origin`);
    }
  }
});

// ---------- rate limiting on every mutating route ----------

test("every mutating Gate 3 route applies a rate limiter before calling its handler", () => {
  for (const path of allNewRoutes) {
    const source = read(path);
    for (const body of exportedHandlerBodies(source)) {
      const isGet = body.startsWith("export async function GET(");
      if (isGet) continue;
      assert.match(body, /rateLimitResponse\(request,/, `${path}: rotas de mutação devem aplicar rate limit`);
    }
  }
});

// ---------- no cookie => rejects (mandatory) ----------

test("every mutating Gate 3 route rejects when resolveGuestOwner finds no cookie, before calling its handler", () => {
  for (const path of [...cartRoutes.slice(1), ...checkoutRoutes]) {
    const source = read(path);
    for (const body of exportedHandlerBodies(source)) {
      assert.match(body, /!owner\.guestToken/, `${path}: deve rejeitar quando não há guestToken (sem cookie)`);
    }
  }
});

// ---------- zero Woo calls (mandatory) ----------

test("no new Gate 3 file imports anything from services/woocommerce", () => {
  const files = [
    ...allNewRoutes,
    "lib/commerce/nativeCartHandlers.ts",
    "lib/commerce/nativeCheckoutPrepHandlers.ts",
    "lib/commerce/nativeCommerceRouteWiring.ts",
    "lib/commerce/nativeCommerceCatalogResolution.ts",
    "lib/commerce/nativeCommerceRequestGuards.ts",
    "lib/commerce/nativeCommerceIdempotency.ts",
    "lib/commerce/nativeCartCookie.ts",
  ];
  for (const path of files) {
    const source = read(path);
    // Match only real import/require statements, not this file's own
    // explanatory comments (several of which literally say the string
    // "services/woocommerce" while documenting its absence).
    assert.doesNotMatch(
      source,
      /(?:import\s[^\n]*from\s+["'][^"']*services\/woocommerce|require\(["'][^"']*services\/woocommerce)/,
      `${path} não deve importar nada de services/woocommerce`,
    );
  }
});

// ---------- zero PII in logs (mandatory) ----------

test("handlePersistNativeCheckoutPii never passes input.pii (or the decrypted envelope) to logNativeCommerceEvent", () => {
  const source = read("lib/commerce/nativeCheckoutPrepHandlers.ts");
  const fnBody = source.slice(source.indexOf("export async function handlePersistNativeCheckoutPii"));
  const logCalls = [...fnBody.matchAll(/logNativeCommerceEvent\([^)]*\)/gs)];
  assert.ok(logCalls.length > 0, "handlePersistNativeCheckoutPii deve logar ao menos um evento");
  for (const [call] of logCalls) {
    assert.doesNotMatch(call, /\bpii\b/i, "nenhuma chamada de log pode referenciar pii/envelope");
    assert.doesNotMatch(call, /envelope/i);
  }
});

test("NativeCommerceEventFields has no field shaped like PII (name, email, phone, address, document)", () => {
  const source = read("lib/observability/nativeCommerceEvents.ts");
  const interfaceBody = source.slice(
    source.indexOf("export interface NativeCommerceEventFields"),
    source.indexOf("}", source.indexOf("export interface NativeCommerceEventFields")),
  );
  for (const forbidden of [/email/i, /phone/i, /address/i, /document/i, /\bname\b/i, /cpf/i, /cnpj/i]) {
    assert.doesNotMatch(interfaceBody, forbidden, `NativeCommerceEventFields não pode conter um campo com formato de PII (${forbidden})`);
  }
});

test("no new route or handler logs a raw request body", () => {
  const files = [...allNewRoutes, "lib/commerce/nativeCartHandlers.ts", "lib/commerce/nativeCheckoutPrepHandlers.ts"];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /console\.(log|info|error|warn)\([^)]*\brawBody\b/, `${path}: nunca logar o corpo bruto da requisição`);
    assert.doesNotMatch(source, /console\.(log|info|error|warn)\([^)]*\binput\.pii\b/, `${path}: nunca logar input.pii`);
  }
});
