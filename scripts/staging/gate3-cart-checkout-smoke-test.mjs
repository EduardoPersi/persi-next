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
// A conferência de banco (Passo 2) é OPCIONAL e vive, de preferência, no
// arquivo separado docs/native-commerce/gate3-staging-db-check.sql,
// rodado manualmente no SQL Editor do Supabase com o cartId/checkoutId que
// este script imprime ao final. Se STAGING_READONLY_DATABASE_URL estiver
// configurada, o script também tenta uma conferência inline como
// conveniência; se não, imprime "DB_CHECK=MANUAL" e segue só com o .sql.
//
// Variáveis de ambiente:
//   STAGING_BASE_URL                 (opcional; default abaixo)
//   PERSI_STAGING_BASIC_AUTH_USER    (obrigatória; já usada pela própria proteção de staging)
//   PERSI_STAGING_BASIC_AUTH_PASSWORD (obrigatória)
//   STAGING_READONLY_DATABASE_URL    (opcional; conexão de LEITURA ao Supabase
//                                     de staging — NUNCA a DATABASE_URL local,
//                                     que aponta para produção. Sem ela, a
//                                     escolha automática de produtos e a
//                                     conferência inline ficam indisponíveis.)
//   STAGING_TEST_WOO_PRODUCT_ID      (obrigatória só se STAGING_READONLY_DATABASE_URL
//                                     não estiver definida — um wooProductId real,
//                                     mapeado e com estoque > 0 em staging, escolhido
//                                     manualmente por você)

const STAGING_BASE_URL = (process.env.STAGING_BASE_URL || "https://staging.persimateriais.com.br").replace(/\/+$/, "");
const BASIC_AUTH_USER = process.env.PERSI_STAGING_BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.PERSI_STAGING_BASIC_AUTH_PASSWORD;
const READONLY_DATABASE_URL = process.env.STAGING_READONLY_DATABASE_URL || null;
const MANUAL_WOO_PRODUCT_ID = process.env.STAGING_TEST_WOO_PRODUCT_ID || null;

const missing = [
  ["PERSI_STAGING_BASIC_AUTH_USER", BASIC_AUTH_USER],
  ["PERSI_STAGING_BASIC_AUTH_PASSWORD", BASIC_AUTH_PASSWORD],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(`Faltam variáveis de ambiente (nenhuma requisição foi feita): ${missing.join(", ")}`);
  process.exit(1);
}
if (!READONLY_DATABASE_URL && !MANUAL_WOO_PRODUCT_ID) {
  console.error("Sem STAGING_READONLY_DATABASE_URL, defina STAGING_TEST_WOO_PRODUCT_ID (um wooProductId real, mapeado, com estoque > 0 em staging) para o script poder rodar.");
  process.exit(1);
}

const basicAuthHeader = `Basic ${Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`).toString("base64")}`;
const ORIGIN = STAGING_BASE_URL;

const results = [];
function record(step, expected, response, note = "") {
  const actual = typeof response === "number" ? response : response?.status ?? "ERR";
  const pass = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  // response.json?.code is the route's own stable error code (e.g.
  // CHECKOUT_PII_INVALID, CART_NOT_FOUND) -- never PII, it's a fixed enum
  // string every route already returns in its body on failure.
  // response.json?.field (only present for CHECKOUT_PII_INVALID) names
  // the rejected field ("contact.phone") -- never its value.
  const errorCode = typeof response === "object" ? response?.json?.code : undefined;
  const errorField = typeof response === "object" ? response?.json?.field : undefined;
  results.push({ step, expected: Array.isArray(expected) ? expected.join("|") : expected, actual, pass, note, errorCode, errorField });
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

async function resolveWooProductId(sql) {
  if (!sql) return { wooProductId: Number(MANUAL_WOO_PRODUCT_ID), source: "STAGING_TEST_WOO_PRODUCT_ID (manual)" };
  const candidates = await sql`
    select em.external_id::text as "wooProductId"
    from external_mappings em
    join products p on p.id = em.internal_id
    join product_variants pv on pv.product_id = p.id
    join inventory_levels il on il.product_variant_id = pv.id
    where em.system = 'woocommerce' and em.entity_type = 'product'
      and p.status = 'active' and p.is_purchasable = true and p.catalog_visibility <> 'hidden'
      and il.quantity_available > 0
    group by em.external_id, p.id
    having count(distinct pv.id) = 1
    limit 1
  `;
  if (candidates.length < 1) return null;
  return { wooProductId: Number(candidates[0].wooProductId), source: "STAGING_READONLY_DATABASE_URL (automático)" };
}

async function main() {
  const sql = READONLY_DATABASE_URL ? postgres(READONLY_DATABASE_URL, { max: 1, prepare: false }) : null;

  // ---------- (0) escolha de 1 produto real mapeado, com estoque > 0 ----------
  const resolved = await resolveWooProductId(sql);
  if (!resolved) {
    console.error("Não foi possível encontrar um produto mapeado com estoque > 0 e exatamente 1 variante em staging.");
    if (sql) await sql.end({ timeout: 1 });
    process.exit(1);
  }
  const { wooProductId } = resolved;
  console.log(`Produto escolhido: wooProductId=${wooProductId} (fonte: ${resolved.source})`);

  // ---------- (a) criar/obter carrinho ----------
  const createCart = await req("/api/cart/native", { method: "POST" });
  record("a) POST /api/cart/native (criar carrinho)", 201, createCart);
  const guestCookie = extractCookieValue(createCart.setCookie, "persi_native_cart_token");
  const cartId = createCart.json?.id;
  if (!guestCookie || !cartId) {
    console.error("Falha crítica: não foi possível obter cookie/cartId — abortando o restante do roteiro.");
    printTable();
    if (sql) await sql.end({ timeout: 1 });
    process.exit(1);
  }

  // Passos b–g e os negativos rodam dentro de try/finally: uma exceção
  // inesperada em qualquer chamada (ex.: um 500 cru que quebre alguma
  // suposição do script) não pode impedir o restante das linhas já
  // registradas de aparecer no resumo -- printTable() SEMPRE roda.
  let checkoutId;
  try {
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
    checkoutId = prepare.json?.checkoutId;

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
          // inputEnvelopeSchema (lib/commerce/checkoutPii.ts) is .strict()
          // on every level AND requires personType + a full shipping
          // address even when shippingSameAsBilling is true. "11987654321"
          // is used instead of a repeated-digit number (validateBrazilianPhone
          // explicitly rejects those as an anti-fraud check) -- both bugs
          // found and fixed in earlier rounds of this same script.
          contact: { firstName: "TESTE", lastName: "STAGING", email: "teste.staging@example.com", phone: "11987654321", personType: "fisica", taxDocument: "11144477735" },
          billing: { recipient: "TESTE STAGING", street: "Rua de Teste", number: "100", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR" },
          shipping: { recipient: "TESTE STAGING", street: "Rua de Teste", number: "100", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR" },
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
    record("neg) sem cookie", [404, 422], noCookie, "fail-closed por desenho (as rotas devem parecer que não existem); 404/422 é o esperado, não 401/403");

    const tamperedCookie = guestCookie.slice(0, -1) + (guestCookie.slice(-1) === "A" ? "B" : "A");
    const tampered = await req("/api/cart/native/items", {
      method: "POST",
      cookie: tamperedCookie,
      body: { cartId, wooProductId, quantity: 1, idempotencyKey: uuid() },
    });
    record("neg) cookie adulterado", 404, tampered, "fail-closed por desenho: ownership inválida responde igual a carrinho inexistente, em toda rota Gate 3");

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
    // Chamado repetidamente com o MESMO cookie -- exercita também o fix de
    // 2026-09-24 para o "obter ou criar": a essa altura o carrinho já está
    // 'locked' (prepare rodou em (e)), então cada chamada aqui deve
    // devolver o carrinho existente (200, native_cart_reused), nunca um
    // 23505 cru.
    let rateLimited = false;
    let unexpectedDuringRateLimit = 0;
    for (let i = 0; i < 65 && !rateLimited; i += 1) {
      const response = await req("/api/cart/native", { method: "POST", cookie: guestCookie });
      if (response.status === 429) rateLimited = true;
      else if (response.status >= 500) unexpectedDuringRateLimit += 1;
    }
    results.push({ step: "neg) rate limit (>60 POST /api/cart/native em 1 min)", expected: 429, actual: rateLimited ? 429 : "nunca ocorreu em 65 tentativas", pass: rateLimited, note: "" });
    results.push({
      step: "obter-ou-criar repetido (carrinho já em checkout) nunca retorna 5xx",
      expected: 0,
      actual: unexpectedDuringRateLimit,
      pass: unexpectedDuringRateLimit === 0,
      note: unexpectedDuringRateLimit > 0 ? "23505 cru (ou outro 5xx) durante chamadas repetidas -- ver fix de create_native_cart/findNativeCartByGuestTokenAnyStatus" : "",
    });
  } catch (error) {
    console.error("Falha inesperada durante o roteiro (as linhas já registradas abaixo ainda são exibidas):", error instanceof Error ? error.message : error);
  } finally {
    printTable();
  }

  // ---------- Passo 2: conferência (opcional, inline) ----------
  let dbCheckPass = true;
  if (sql) {
    console.log("\n--- Passo 2: conferência inline (Supabase staging, read-only) ---");
    const ordersCreated = await sql`select count(*)::int as n from orders where checkout_session_id = ${checkoutId}`;
    const paymentAttemptsCreated = checkoutId
      ? await sql`select count(*)::int as n from payment_attempts pa join orders o on o.id = pa.order_id where o.checkout_session_id = ${checkoutId}`
      : [{ n: 0 }];
    console.log({ ordersLinkedToTestCheckout: ordersCreated[0]?.n, paymentAttemptsLinkedToTestCheckout: paymentAttemptsCreated[0]?.n });
    dbCheckPass = ordersCreated[0]?.n === 0 && paymentAttemptsCreated[0]?.n === 0;
  } else {
    console.log("\nDB_CHECK=MANUAL — rode docs/native-commerce/gate3-staging-db-check.sql no SQL Editor do Supabase com os IDs abaixo.");
  }

  const gate3Pass = results.every((r) => r.pass) && dbCheckPass;
  console.log(`\nGATE_3=${gate3Pass ? "PASS" : "FAIL"}${sql ? "" : " (conferência de banco pendente — ver DB_CHECK=MANUAL acima)"}`);
  console.log(`cartId=${cartId}`);
  console.log(`checkoutId=${checkoutId ?? "N/A"}`);
  console.log("Nota Passo 3 (logs de runtime do staging): NÃO verificado por este script -- requer acesso read-only aos logs do Node.js na Hostinger (MCP hostinger-hosting indisponível nesta sessão). Verificar manualmente ou reconectar o conector.");

  if (sql) await sql.end({ timeout: 1 });
  process.exit(gate3Pass ? 0 : 1);
}

function printTable() {
  console.log("\n--- Passo 1: resultados HTTP ---");
  for (const row of results) {
    // O código de erro (body.code) só é impresso em FAILs -- em PASS ele é
    // redundante (o status já confirma o resultado esperado) e omiti-lo
    // mantém a saída de sucesso enxuta.
    const codeSuffix = !row.pass && row.errorCode ? ` | code=${row.errorCode}` : "";
    const fieldSuffix = !row.pass && row.errorField ? ` | field=${row.errorField}` : "";
    console.log(`${row.pass ? "PASS" : "FAIL"} | ${row.step} | esperado=${row.expected} obtido=${row.actual}${codeSuffix}${fieldSuffix}${row.note ? ` | ${row.note}` : ""}`);
  }
}

main().catch((error) => {
  console.error("Falha inesperada no smoke test:", error instanceof Error ? error.message : error);
  process.exit(1);
});
