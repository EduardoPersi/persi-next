import { test } from "node:test";
import assert from "node:assert/strict";

// FASE 7 DO PAINEL: o pedido completo (endereço, itens, frete, pagamento) e a
// forma de envio que decide se ele vira entrega da loja. O contrato está no
// persi-atendimento, docs/contrato-api-sites.md §3.1.
import { classificarEnvio, montarAvisoDoPedido, situacaoDoWebhook } from "../lib/painel/pedido.ts";
import { orderFromWebhookPayload } from "../services/woocommerce/orders.ts";

const doWoo = (extra = {}) => ({
  id: 4512, status: "processing", total: "209.40", currency: "BRL", payment_method: "inter_pix",
  billing: { first_name: "Maria", last_name: "Souza", phone: "11988887777", email: "maria@exemplo.com.br",
             address_1: "Rua da Cobrança", postcode: "13200-000", city: "Jundiaí", state: "SP" },
  shipping: { first_name: "João", last_name: "Souza", address_1: "Rua do Retiro", address_2: "casa 2",
              postcode: "13201-000", city: "Jundiaí", state: "SP" },
  line_items: [
    { name: "Cimento CP II 50 kg", quantity: 4, sku: "CIM-50", total: "159.60" },
    { name: "Argamassa AC-II 20 kg", quantity: 2, sku: "", total: "49.80" },
    { name: "", quantity: 1, total: "1.00" },
  ],
  shipping_lines: [{ method_id: "flat_rate", method_title: "Entrega Persi (Jundiaí)", total: "11.00" }],
  meta_data: [
    { key: "_shipping_number", value: "500" }, { key: "_shipping_neighborhood", value: "Centro" },
    { key: "_billing_cpf", value: "123.456.789-09" },
  ],
  ...extra,
});

test("o pedido do WooCommerce: o endereço de ENTREGA (não o de cobrança), com número e bairro do Brazilian Market", () => {
  const p = orderFromWebhookPayload(doWoo());
  assert.equal(p.entrega.endereco.rua, "Rua do Retiro");
  assert.equal(p.entrega.endereco.numero, "500");
  assert.equal(p.entrega.endereco.bairro, "Centro");
  assert.equal(p.entrega.endereco.complemento, "casa 2");
  assert.equal(p.entrega.endereco.destinatario, "João Souza");
  assert.equal(p.entrega.endereco.cep, "13201-000");
});

test("sem endereço de entrega, vale o de cobrança", () => {
  const p = orderFromWebhookPayload(doWoo({ shipping: {} }));
  assert.equal(p.entrega.endereco.rua, "Rua da Cobrança");
  assert.equal(p.entrega.endereco.destinatario, "Maria Souza");
});

test("os itens: sem nome fica de fora, e o preço é por unidade em centavos", () => {
  const p = orderFromWebhookPayload(doWoo());
  assert.equal(p.entrega.itens.length, 2);
  assert.deepEqual(p.entrega.itens[0], { nome: "Cimento CP II 50 kg", quantidade: 4, sku: "CIM-50", preco_centavos: 3990 });
  assert.equal(p.entrega.itens[1].sku, undefined);
});

test("o frete: o método do WooCommerce, o nome e o valor", () => {
  const p = orderFromWebhookPayload(doWoo());
  assert.deepEqual(p.entrega.frete, { metodoId: "flat_rate", metodo: "Entrega Persi (Jundiaí)", centavos: 1100 });
  assert.equal(orderFromWebhookPayload(doWoo({ shipping_lines: [] })).entrega.frete, null);
});

test("corpo torto não vira pedido", () => {
  assert.equal(orderFromWebhookPayload(null), null);
  assert.equal(orderFromWebhookPayload({ id: "x", status: "processing" }), null);
  assert.equal(orderFromWebhookPayload({ id: 1 }), null);
});

test("a forma de envio: padrão da loja, retirada e transportadora", () => {
  const env = {};
  assert.equal(classificarEnvio("flat_rate", env), "loja");
  assert.equal(classificarEnvio("flat_rate:3", env), "loja");
  assert.equal(classificarEnvio("free_shipping", env), "loja");
  assert.equal(classificarEnvio("local_pickup", env), "retirada");
  assert.equal(classificarEnvio("pickup_location", env), "retirada");
  assert.equal(classificarEnvio("melhorenvio_sedex", env), "transportadora");
  assert.equal(classificarEnvio("correios", env), "transportadora");
  // "flat_rate_x" casa com flat_rate (prefixo com _), mas "flat_rateira" não.
  assert.equal(classificarEnvio("flat_rateira", env), "transportadora");
});

test("a forma de envio vem do ambiente quando configurada", () => {
  const env = { PAINEL_ENVIO_LOJA: "persi_entrega, free_shipping", PAINEL_ENVIO_RETIRADA: "retirar_loja" };
  assert.equal(classificarEnvio("persi_entrega", env), "loja");
  assert.equal(classificarEnvio("flat_rate", env), "transportadora");
  assert.equal(classificarEnvio("retirar_loja", env), "retirada");
  assert.equal(classificarEnvio("local_pickup", env), "transportadora");
});

test("o aviso PAGO leva o pedido completo — e a mensagem ao cliente continua a mesma (sem nome nem total)", () => {
  const a = montarAvisoDoPedido(orderFromWebhookPayload(doWoo()), "pago", {});
  assert.equal(a.pago, true);
  assert.equal(a.envio.entrega_propria, true);
  assert.equal(a.envio.retirada, false);
  assert.equal(a.envio.frete_centavos, 1100);
  assert.equal(a.envio.metodo, "Entrega Persi (Jundiaí)");
  assert.equal(a.endereco.rua, "Rua do Retiro");
  assert.equal(a.itens.length, 2);
  assert.equal(a.cpf_cnpj, "12345678909");
  assert.deepEqual(a.pagamento, { forma: "pix" });
  assert.equal("cliente" in a, false);
  assert.equal("total_centavos" in a, false);
});

test("retirada e transportadora: o aviso diz, e o painel não cria entrega", () => {
  const retirada = montarAvisoDoPedido(orderFromWebhookPayload(doWoo({ shipping_lines: [{ method_id: "local_pickup", method_title: "Retirar na loja", total: "0" }] })), "pago", {});
  assert.equal(retirada.envio.retirada, true);
  assert.equal(retirada.envio.entrega_propria, false);
  const melhor = montarAvisoDoPedido(orderFromWebhookPayload(doWoo({ shipping_lines: [{ method_id: "melhorenvio_pac", method_title: "PAC", total: "30.00" }] })), "pago", {});
  assert.equal(melhor.envio.entrega_propria, false);
  assert.equal(melhor.envio.retirada, false);
});

test("sem frete no pedido, o aviso não diz o envio (o painel não inventa)", () => {
  const a = montarAvisoDoPedido(orderFromWebhookPayload(doWoo({ shipping_lines: [] })), "pago", {});
  assert.equal("envio" in a, false);
});

test("cartão parcelado: forma e parcelas", () => {
  const p = orderFromWebhookPayload(doWoo({ payment_method: "mercadopago_card", meta_data: [{ key: "_persi_payment_installments", value: "3" }] }));
  assert.deepEqual(montarAvisoDoPedido(p, "pago", {}).pagamento, { forma: "cartão", parcelas: 3 });
});

test("pedido antigo, sem os dados de entrega: o aviso é o de antes", () => {
  const a = montarAvisoDoPedido({ id: 7, billingPhone: "11999998888", billingEmail: "", metaData: {} }, "pago", {});
  for (const campo of ["endereco", "itens", "envio", "pagamento", "cpf_cnpj"]) assert.equal(campo in a, false, campo);
});

test("o webhook do WooCommerce: só o cancelamento vai ao painel", () => {
  for (const s of ["cancelled", "refunded", "failed"]) assert.equal(situacaoDoWebhook(s), "cancelado", s);
  for (const s of ["processing", "completed", "pending", "on-hold"]) assert.equal(situacaoDoWebhook(s), null, s);
});
