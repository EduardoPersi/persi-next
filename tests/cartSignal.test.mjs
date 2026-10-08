import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  criarRegistroDeEnvios,
  enviarCartUpdatedAoPainel,
  envioDoCarrinhoLigado,
  impressaoDoEvento,
  montarCartUpdated,
  sessaoDoCarrinho,
} from "../lib/painel/carrinho.ts";
import {
  emailDoCarrinho,
  etapaDoContrato,
  temContatoValido,
  whatsappDoCarrinho,
} from "../lib/painel/carrinhoContato.ts";

const read = (path) => readFileSync(path, "utf8");

const money = (value) => ({
  value: String(value),
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
});

// Carrinho "sujo" de propósito: tem endereço completo, CPF e telefone do
// WooCommerce que NUNCA podem aparecer no que vai ao painel.
const cart = {
  items: [
    {
      key: "k1",
      id: 4821,
      productId: 4821,
      variationId: undefined,
      name: "Cano PVC 25mm 6m",
      sku: "CAN-PVC-25",
      slug: "cano-pvc-25mm-6m",
      permalink: "https://loja.persimateriais.com.br/produto/cano-pvc-25mm-6m/",
      variation: [],
      quantity: 2,
      minQuantity: 1,
      quantityStep: 1,
      image: { src: "https://persimateriais.com.br/wp-content/uploads/cano.webp", alt: "Cano" },
      price: 34.9,
      total: 69.8,
    },
  ],
  itemsCount: 2,
  subtotal: 69.8,
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
  coupons: [{ code: "VOLTA10", totalDiscount: money(0), totalDiscountTax: money(0) }],
  fees: [],
  taxLines: [],
  totals: { items: money(6980), discount: money(500), shipping: money(1500) },
  shippingAddress: {
    firstName: "Maria",
    lastName: "Souza",
    address1: "Rua Rangel Pestana 123",
    address2: "Apto 45",
    city: "Jundiaí",
    state: "SP",
    postcode: "13201-000",
    country: "BR",
    phone: "(11) 98765-4321",
    email: "maria@example.com",
  },
  billingAddress: {
    address1: "Rua Rangel Pestana 123",
    city: "Jundiaí",
    postcode: "13201-000",
    country: "BR",
  },
  needsShipping: true,
  hasCalculatedShipping: true,
  shippingPackages: [],
};

const sinal = {
  nome: "Maria Souza",
  email: "Maria@Example.com",
  whatsapp: "(11) 98765-4321",
  etapa: "entrega",
  optinWhatsapp: true,
};
const AGORA = new Date("2026-10-08T14:03:22.000Z");
const TOKEN = "token-secreto-do-carrinho-woocommerce";

function montar(overrides = {}) {
  return montarCartUpdated({
    sinal,
    cart,
    cartToken: TOKEN,
    siteUrl: "https://persimateriais.com.br",
    agora: AGORA,
    ...overrides,
  });
}

test("monta o cart.updated do contrato a partir do carrinho real", () => {
  const evento = montar();
  assert.equal(evento.tipo, "carrinho");
  assert.equal(evento.evento, "cart.updated");
  assert.deepEqual(evento.contato, {
    nome: "Maria Souza",
    email: "maria@example.com",
    telefone: "5511987654321",
  });
  assert.equal(evento.optin_whatsapp, true);
  assert.equal(evento.etapa, "entrega");
  assert.equal(evento.cep, "13201000");
  assert.equal(evento.cidade, "Jundiaí");
  assert.equal(evento.total_centavos, 6480);
  assert.equal(evento.cupom, "VOLTA10");
  assert.equal(evento.enviado_em, AGORA.toISOString());
  assert.deepEqual(evento.itens, [
    {
      produto_id: 4821,
      variacao_id: null,
      sku: "CAN-PVC-25",
      nome: "Cano PVC 25mm 6m",
      quantidade: 2,
      preco_centavos: 3490,
      url: "https://persimateriais.com.br/produto/cano-pvc-25mm-6m",
      imagem: "https://persimateriais.com.br/wp-content/uploads/cano.webp",
    },
  ]);
});

test("NUNCA envia CPF/CNPJ, endereço completo nem dado de pagamento", () => {
  const evento = montar({
    sinal: {
      ...sinal,
      // Mesmo que alguém tente empurrar campos a mais pelo sinal:
      document: "529.982.247-25",
      cpf: "52998224725",
      cardNumber: "4111111111111111",
      cvv: "123",
      rua: "Rua Secreta",
    },
  });
  const texto = JSON.stringify(evento);
  for (const proibido of [
    "529.982.247-25",
    "52998224725",
    "4111111111111111",
    "cvv",
    "Rua Rangel Pestana",
    "Apto 45",
    "address1",
    "address2",
    "Rua Secreta",
    "(11) 98765-4321",
    "cpf",
    "cnpj",
    "document",
    "cardNumber",
    "password",
    "senha",
  ]) {
    assert.ok(!texto.includes(proibido), `vazou no payload: ${proibido}`);
  }

  // Só estas chaves existem, em qualquer nível.
  const permitidas = new Set([
    "tipo", "evento", "sessao", "enviado_em", "contato", "nome", "email", "telefone",
    "optin_whatsapp", "cep", "cidade", "etapa", "itens", "produto_id", "variacao_id",
    "sku", "quantidade", "preco_centavos", "url", "imagem", "variacao", "atributo", "valor",
    "total_centavos", "moeda", "cupom",
  ]);
  const chaves = (valor) =>
    Array.isArray(valor)
      ? valor.flatMap(chaves)
      : valor && typeof valor === "object"
        ? Object.entries(valor).flatMap(([chave, filho]) => [chave, ...chaves(filho)])
        : [];
  for (const chave of chaves(evento)) {
    assert.ok(permitidas.has(chave), `chave inesperada: ${chave}`);
  }
});

test("a sessão é o hash do token do carrinho, nunca o token", () => {
  const evento = montar();
  assert.equal(evento.sessao, crypto.createHash("sha256").update(TOKEN).digest("hex"));
  assert.equal(evento.sessao, sessaoDoCarrinho(TOKEN));
  assert.match(evento.sessao, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(evento).includes(TOKEN));
});

test("sem e-mail nem WhatsApp válidos não há evento", () => {
  assert.equal(montar({ sinal: { ...sinal, email: "x", whatsapp: "123" } }), null);
  assert.equal(montar({ sinal: { ...sinal, email: undefined, whatsapp: "(11) 98765-4321" } }) !== null, true);
  assert.equal(montar({ sinal: { ...sinal, whatsapp: undefined } }) !== null, true);
});

test("opt-in desmarcado vai como false e carrinho vazio vira itens []", () => {
  const evento = montar({
    sinal: { ...sinal, optinWhatsapp: false },
    cart: { ...cart, items: [], coupons: [], totals: { items: money(0), discount: money(0) } },
  });
  assert.equal(evento.optin_whatsapp, false);
  assert.deepEqual(evento.itens, []);
  assert.equal(evento.total_centavos, 0);
  assert.equal(evento.cupom, null);
});

test("contato: WhatsApp de 10/11 dígitos vira 55+dígitos; e-mail e etapas", () => {
  assert.equal(whatsappDoCarrinho("(11) 98765-4321"), "5511987654321");
  assert.equal(whatsappDoCarrinho("1132145678"), "551132145678");
  assert.equal(whatsappDoCarrinho("+55 11 98765-4321"), "5511987654321");
  assert.equal(whatsappDoCarrinho("98765-4321"), null);
  assert.equal(whatsappDoCarrinho("119876543210"), null);
  assert.equal(emailDoCarrinho(" Maria@Example.com "), "maria@example.com");
  assert.equal(emailDoCarrinho("maria@"), null);
  assert.equal(temContatoValido({ email: "", whatsapp: "(11) 98765-4321" }), true);
  assert.equal(temContatoValido({ email: "", whatsapp: "" }), false);
  assert.equal(etapaDoContrato("profile"), "perfil");
  assert.equal(etapaDoContrato("address"), "entrega");
  assert.equal(etapaDoContrato("payment"), "pagamento");
});

test("dedupe: o mesmo conteúdo do mesmo carrinho não reenvia dentro de 60 s", () => {
  const registro = criarRegistroDeEnvios();
  const a = impressaoDoEvento(montar());
  // O horário não conta para a impressão.
  assert.equal(a, impressaoDoEvento(montar({ agora: new Date("2026-10-08T14:03:50.000Z") })));
  assert.equal(registro.deveEnviar("s1", a, 0), true);
  assert.equal(registro.deveEnviar("s1", a, 30_000), false);
  // Conteúdo diferente (etapa mudou) envia.
  const b = impressaoDoEvento(montar({ sinal: { ...sinal, etapa: "pagamento" } }));
  assert.notEqual(a, b);
  assert.equal(registro.deveEnviar("s1", b, 31_000), true);
  // Outro carrinho envia.
  assert.equal(registro.deveEnviar("s2", b, 31_000), true);
  // Passou a janela: o mesmo conteúdo pode voltar a ser enviado.
  assert.equal(registro.deveEnviar("s1", b, 31_000 + 60_000), true);
});

test("envio ao painel: chave no cabeçalho, nunca lança, log sem dados pessoais", async () => {
  const evento = montar();
  const chamadas = [];
  const fetchOk = async (url, init) => {
    chamadas.push({ url, init });
    return { ok: true, status: 200 };
  };
  const env = { PAINEL_URL: "https://painel.exemplo.com/", SITE_WEBHOOK_KEY: "chave-secreta" };

  const ok = await enviarCartUpdatedAoPainel(evento, { env, fetchImpl: fetchOk });
  assert.deepEqual(ok, { enviado: true, status: 200 });
  assert.equal(chamadas[0].url, "https://painel.exemplo.com/api/webhooks/site/notificar");
  assert.equal(chamadas[0].init.headers["X-Site-Webhook-Key"], "chave-secreta");
  assert.equal(JSON.parse(chamadas[0].init.body).evento, "cart.updated");

  const recusado = await enviarCartUpdatedAoPainel(evento, {
    env,
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(recusado.enviado, false);
  assert.equal(recusado.status, 401);

  const caiu = await enviarCartUpdatedAoPainel(evento, {
    env,
    fetchImpl: async () => {
      throw new Error("rede");
    },
  });
  assert.equal(caiu.enviado, false);
  assert.ok(!JSON.stringify(caiu).includes("maria@example.com"));

  const semConfig = await enviarCartUpdatedAoPainel(evento, { env: {} });
  assert.equal(semConfig.enviado, false);
});

test("a flag PAINEL_ENVIAR_CARRINHO vem desligada", () => {
  assert.equal(envioDoCarrinhoLigado({}), false);
  assert.equal(envioDoCarrinhoLigado({ PAINEL_ENVIAR_CARRINHO: "0" }), false);
  assert.equal(envioDoCarrinhoLigado({ PAINEL_ENVIAR_CARRINHO: "1" }), true);
  assert.equal(envioDoCarrinhoLigado({ PAINEL_ENVIAR_CARRINHO: "true" }), true);
  assert.match(read(".env.example"), /^PAINEL_ENVIAR_CARRINHO=0$/m);
});

test("a rota responde 204, só envia depois da resposta e recusa campos a mais", () => {
  const route = read("app/api/checkout/cart-signal/route.ts");
  // Flag desligada: responde antes de ler corpo, cookie ou carrinho.
  assert.ok(route.indexOf("envioDoCarrinhoLigado()") < route.indexOf("request.json()"));
  assert.ok(route.indexOf("envioDoCarrinhoLigado()") < route.indexOf("getCart("));
  assert.ok(route.includes("status: 204"));
  // Envio depois da resposta, com erro só no log.
  assert.ok(route.includes("after(async"));
  assert.ok(route.includes("} catch {"));
  // Rate limit por IP e limite de tamanho.
  assert.ok(route.includes("rateLimiter.isLimited(request.headers)"));
  assert.ok(route.includes("exceedsRequestLimit(request)"));
  // O corpo aceita só contato, etapa e opt-in.
  assert.ok(route.includes(".strict()"));
  for (const proibido of ["document", "cpf", "cnpj", "cardNumber", "address", "payment"]) {
    assert.ok(!route.includes(`${proibido}:`), `campo proibido no schema: ${proibido}`);
  }
  // A origem vem dos cookies do servidor, não do corpo.
  assert.ok(route.includes("lerOrigemDosCookies"));
});

test("o checkout dispara com debounce de 800 ms e keepalive, só com a flag ligada", () => {
  const hook = read("hooks/useCartSignal.ts");
  assert.ok(hook.includes("const DEBOUNCE_MS = 800"));
  assert.ok(hook.includes("keepalive: true"));
  assert.ok(hook.includes("temContatoValido"));
  // Dispara de novo quando mudam etapa, itens e opt-in.
  for (const dependencia of ["step,", "itemsSignature,", "optIn,"]) {
    assert.ok(hook.includes(dependencia), `falta dependência: ${dependencia}`);
  }
  // Não manda CPF, endereço nem pagamento.
  for (const proibido of ["document", "billingAddress", "shippingAddress", "cardNumber", "paymentMethod"]) {
    assert.ok(!hook.includes(proibido), `o hook não deve citar: ${proibido}`);
  }
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.ok(form.includes("enabled: capabilities.cartSignal && !hasCreatedOrder"));
  assert.ok(read("lib/commerce/checkoutConfig.ts").includes("cartSignal: envioDoCarrinhoLigado()"));
});

test("produto com variação leva os atributos escolhidos; simples não leva", () => {
  const evento = montar({
    cart: {
      ...cart,
      items: [
        ...cart.items,
        {
          ...cart.items[0],
          key: "k2",
          id: 5120,
          productId: 5120,
          variationId: 5120,
          name: "Tinta acrílica 18L",
          slug: "tinta-acrilica-18l",
          variation: [{ attribute: "Cor", label: "Cor", value: "Branco" }],
        },
      ],
    },
  });
  assert.equal("variacao" in evento.itens[0], false);
  assert.deepEqual(evento.itens[1].variacao, [{ atributo: "Cor", valor: "Branco" }]);
  assert.equal(evento.itens[1].variacao_id, 5120);
});
