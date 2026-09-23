import postgres from "postgres";

// Gate 3 — smoke test E2E das rotas novas de carrinho/checkout nativo em
// staging (autorização "STAGING ONLY", ver conversa). Fica FORA do build
// (scripts/staging/), nunca é importado pelo app.
//
// NUNCA chama /api/checkout/native (submissão final) nem toca
// NATIVE_CHECKOUT_RUNTIME_ENABLED — só exercita
// /api/cart/native/* e /api/checkout/native/{prepare,pii,ready}.
// Nenhuma credencial é impressa em nenhuma circunstância.
//
// Variáveis de ambiente obrigatórias (definir em .env.local, NUNCA
// commitar valores):
//   STAGING_BASE_URL                 (opcional; default abaixo)
//   PERSI_STAGING_BASIC_AUTH_USER    (já usada pela própria proteção de staging)
//   PERSI_STAGING_BASIC_AUTH_PASSWORD
//   STAGING_READONLY_DATABASE_URL    (conexão de LEITURA ao Supabase de
//                                     staging — NUNCA a DATABASE_URL local,
//                                     que aponta para produção)

const STAGING_BASE_URL = (process.env.STAGING_BASE_URL || "https://staging.persimateriais.com.br").replace(/\/+$/, "");
const BASIC_AUTH_USER = process.env.PERSI_STAGING_BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.PERSI_STAGING_BASIC_AUTH_PASSWORD;
const READONLY_DATABASE_URL = process.env.STAGING_READONLY_DATABASE_URL;

const missing = [
  ["PERSI_STAGING_BASIC_AUTH_USER", BASIC_AUTH_USER],
  ["PERSI_STAGING_BASIC_AUTH_PASSWORD", BASIC_AUTH_PASSWORD],
  ["STAGING_READONLY_DATABASE_URL", READONLY_DATABASE_URL],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(`Faltam variáveis de ambiente (nenhuma requisição foi feita): ${missing.join(", ")}`);
  process.exit(1);
}

const basicAuthHeader = `Basic ${Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`).toString("base64")}`;
const ORIGIN = STAGING_BASE_URL;

const results = [];
function record(step, expected, response, note = "") {
  const actual = typeof response === "number" ? response : response?.status ?? "ERR";
  const pass = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  results.push({ step, expected: Array.isArray(expected) ? expected.join("|") : expected, actual, pass, note });
  return pass;
}

function extractCookieValue(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function req(path, { method = "GET", body, cookie, origin = ORIGIN, extraHeaders = {} } = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: basicAuthHeader,
    ...(origin ? { origin } : {}),
    ...(cookie ? { cookie: `persi_native_cart_token=${cookie}` } : {}),
    ...extraHeaders,
  };
  const response = await fetch(`${STAGING_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const setCookie = response.headers.get("set-cookie");
  const json = await response.clone().json().catch(() => null);
  return { status: response.status, json, setCookie };
}

function uuid() {
  return crypto.randomUUID();
}

async function main() {
  const sql = postgres(READONLY_DATABASE_URL, { max: 1, prepare: false });
  const testStartedAt = new Date();

  // ---------- escolha de 2 produtos reais mapeados, com estoque > 0 (leitura read-only) ----------
  const candidates = await sql`
    select em.external_id::text as "wooProductId", p.id as "productId"
    from external_mappings em
    join products p on p.id = em.internal_id
    join product_variants pv on pv.product_id = p.id
    join inventory_levels il on il.product_variant_id = pv.id
    where em.system = 'woocommerce' and em.entity_type = 'product'
      and p.status = 'active' and p.is_purchasable = true and p.catalog_visibility <> 'hidden'
      and il.quantity_available > 0
    group by em.external_id, p.id
    having count(distinct pv.id) = 1
    limit 2
  `;
  if (candidates.length < 2) {
    console.error("Não foi possível encontrar 2 produtos mapeados com estoque > 0 e exatamente 1 variante em staging.");
    await sql.end({ timeout: 1 });
    process.exit(1);
  }
  const [productA, productB] = candidates;
  const wooProductId = Number(productA.wooProductId);
  console.log(`Produtos escolhidos (read-only): wooProductId=${wooProductId} (principal), ${Number(productB.wooProductId)} (reserva, não usado neste roteiro)`);

  // ---------- (a) criar/obter carrinho ----------
  const createCart = await req("/api/cart/native", { method: "POST" });
  record("a) POST /api/cart/native (criar carrinho)", 201, createCart);
  const guestCookie = extractCookieValue(createCart.setCookie, "persi_native_cart_token");
  const cartId = createCart.json?.id;
  if (!guestCookie || !cartId) {
    console.error("Falha crítica: não foi possível obter cookie/cartId — abortando o restante do roteiro.");
    printTable();
    await sql.end({ timeout: 1 });
    process.exit(1);
  }

  // ---------- (b) adicionar 1 produto mapeado ----------
  const addIdempotencyKey = uuid();
  const addItem1 = await req("/api/cart/native/items", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: addIdempotencyKey },
  });
  record("b) POST items (adicionar produto mapeado)", 200, addItem1);

  // ---------- (c) repetir com a MESMA idempotencyKey ----------
  const addItem2 = await req("/api/cart/native/items", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: addIdempotencyKey },
  });
  const noDuplicate = addItem2.json?.quantity === addItem1.json?.quantity;
  results.push({ step: "c) repetir POST items (mesma idempotencyKey)", expected: "sem duplicar", actual: noDuplicate ? "sem duplicar" : `quantidade mudou (${addItem1.json?.quantity} -> ${addItem2.json?.quantity})`, pass: noDuplicate, note: "" });

  // ---------- (d) PATCH quantidade; DELETE do item ----------
  const productVariantId = addItem1.json?.productVariantId;
  const patchQty = await req(`/api/cart/native/items/${productVariantId}`, {
    method: "PATCH",
    cookie: guestCookie,
    body: { cartId, quantity: 3, idempotencyKey: uuid() },
  });
  record("d.1) PATCH quantidade", 200, patchQty);

  const deleteItem = await req(`/api/cart/native/items/${productVariantId}`, {
    method: "DELETE",
    cookie: guestCookie,
    body: { cartId, idempotencyKey: uuid() },
  });
  record("d.2) DELETE item", 200, deleteItem);

  // Recoloca 1 unidade para poder seguir para o checkout.
  const reAdd = await req("/api/cart/native/items", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: uuid() },
  });
  record("(recolocar item para prosseguir ao checkout)", 200, reAdd);

  // ---------- (e) prepare (shippingRequired:false) ----------
  const prepareKey = uuid();
  const prepare = await req("/api/checkout/native/prepare", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, idempotencyKey: prepareKey, shippingRequired: false },
  });
  record("e) POST prepare", 201, prepare);
  const checkoutId = prepare.json?.checkoutId;

  // "preço enviado pelo cliente -> ignorado": o schema é .strict() e não
  // tem NENHUM campo de preço/frete -- um totalMinor extra faz o schema
  // rejeitar a requisição inteira (o valor nunca chega a ser lido, é mais
  // forte que "ignorado silenciosamente").
  const priceInjection = await req("/api/checkout/native/prepare", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, idempotencyKey: uuid(), shippingRequired: false, totalMinor: 1 },
  });
  record("neg) preço enviado pelo cliente (campo extra)", 400, priceInjection, "schema .strict() rejeita a requisição inteira -- o preço vem sempre de resolveStorePriceAuthority no servidor, nunca do body");

  // ---------- (f) pii com dados fictícios ----------
  const pii = await req("/api/checkout/native/pii", {
    method: "POST",
    cookie: guestCookie,
    body: {
      checkoutId,
      expectedVersion: String(prepare.json?.version ?? "0"),
      idempotencyKey: uuid(),
      pii: {
        contact: { firstName: "TESTE", lastName: "STAGING", email: "teste.staging@example.com", phone: "11999999999", taxDocument: "11144477735" },
        billing: { recipient: "TESTE STAGING", street: "Rua de Teste", number: "100", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR" },
        shippingSameAsBilling: true,
      },
    },
  });
  record("f) POST pii (dados fictícios)", 200, pii);

  // ---------- (g) ready ----------
  const ready = await req("/api/checkout/native/ready", {
    method: "POST",
    cookie: guestCookie,
    body: { checkoutId, expectedVersion: String(pii.json?.checkoutVersion ?? "0"), expectedPiiFingerprint: pii.json?.fingerprint ?? "0".repeat(64) },
  });
  record("g) POST ready", 200, ready);

  // ---------- negativos ----------
  const noCookie = await req("/api/cart/native/items", {
    method: "POST",
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: uuid() },
  });
  results.push({
    step: "neg) sem cookie",
    expected: "401|403 (esperado na autorização)",
    actual: noCookie.status,
    pass: [401, 403].includes(noCookie.status),
    note: noCookie.status === 404 || noCookie.status === 422
      ? "DIVERGÊNCIA: o código hoje responde 404/422 (fail-closed por design, ver route.ts), não 401/403 -- ver nota no relatório final, não é um bug do smoke test"
      : "",
  });

  const tamperedCookie = guestCookie.slice(0, -1) + (guestCookie.slice(-1) === "A" ? "B" : "A");
  const tampered = await req("/api/cart/native/items", {
    method: "POST",
    cookie: tamperedCookie,
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: uuid() },
  });
  record("neg) cookie adulterado", 403, tampered);

  const badOrigin = await req("/api/cart/native/items", {
    method: "POST",
    cookie: guestCookie,
    origin: "https://evil.example.invalid",
    body: { cartId, wooProductId, quantity: 1, idempotencyKey: uuid() },
  });
  record("neg) Origin errado", 403, badOrigin);

  const unmapped = await req("/api/cart/native/items", {
    method: "POST",
    cookie: guestCookie,
    body: { cartId, wooProductId: 999999999, quantity: 1, idempotencyKey: uuid() },
  });
  record("neg) produto sem mapping/inexistente", 404, unmapped, "falha fechada (PRODUCT_NOT_MAPPED)");

  // ---------- rate limit (POST /api/cart/native, create-or-get é idempotente e barato) ----------
  let rateLimited = false;
  for (let i = 0; i < 65 && !rateLimited; i += 1) {
    const response = await req("/api/cart/native", { method: "POST", cookie: guestCookie });
    if (response.status === 429) rateLimited = true;
  }
  results.push({ step: "neg) rate limit (>60 POST /api/cart/native em 1 min)", expected: 429, actual: rateLimited ? 429 : "nunca ocorreu em 65 tentativas", pass: rateLimited, note: "" });

  printTable();

  // ---------- Passo 2: conferência read-only ----------
  console.log("\n--- Passo 2: conferência read-only (Supabase staging) ---");
  const cartRow = await sql`select id, status, version from carts where id = ${cartId}`;
  const checkoutRow = checkoutId ? await sql`select id, status, version, expires_at from checkout_sessions where id = ${checkoutId}` : [];
  const reservations = checkoutId
    ? await sql`
        select ir.id, ir.status, ir.expires_at from inventory_reservations ir
        join checkout_session_items csi on csi.id = ir.checkout_session_item_id
        where csi.checkout_session_id = ${checkoutId}
      `
    : [];
  const ordersCreated = await sql`select count(*)::int as n from orders where created_at >= ${testStartedAt}`;
  const paymentAttemptsCreated = await sql`select count(*)::int as n from payment_attempts where created_at >= ${testStartedAt}`;

  console.log({
    cart: cartRow[0] ?? null,
    checkout: checkoutRow[0] ?? null,
    reservations: reservations.map((r) => ({ status: r.status, expiresAt: r.expires_at })),
    ordersCreatedSinceTestStart: ordersCreated[0]?.n,
    paymentAttemptsCreatedSinceTestStart: paymentAttemptsCreated[0]?.n,
  });

  const gate3Pass = results.every((r) => r.pass) && ordersCreated[0]?.n === 0 && paymentAttemptsCreated[0]?.n === 0;
  console.log(`\nGATE_3=${gate3Pass ? "PASS" : "FAIL"}`);
  console.log(`cartId=${cartId} checkoutId=${checkoutId ?? "N/A"}`);
  console.log("Nota Passo 3 (logs de runtime do staging): NÃO verificado por este script -- requer acesso read-only aos logs do Node.js na Hostinger (MCP hostinger-hosting indisponível nesta sessão). Verificar manualmente ou reconectar o conector.");

  await sql.end({ timeout: 1 });
  process.exit(gate3Pass ? 0 : 1);
}

function printTable() {
  console.log("\n--- Passo 1: resultados HTTP ---");
  for (const row of results) {
    console.log(`${row.pass ? "PASS" : "FAIL"} | ${row.step} | esperado=${row.expected} obtido=${row.actual}${row.note ? ` | ${row.note}` : ""}`);
  }
}

main().catch((error) => {
  console.error("Falha inesperada no smoke test:", error instanceof Error ? error.message : error);
  process.exit(1);
});
