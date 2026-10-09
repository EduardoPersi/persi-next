import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PENDING_PAYMENT_STORAGE_KEY,
  PENDING_PAYMENT_TTL_MS,
  clearPendingPayment,
  parsePendingPayment,
  readPendingPayment,
  serializePendingPayment,
  shouldKeepPendingAfterFailure,
  writePendingPayment,
} from "../lib/commerce/pendingPayment.ts";
import { resumePendingPayment } from "../lib/commerce/resumePendingPayment.ts";
import { PAYMENT_POLL_INTERVAL_MS, PAYMENT_POLL_TIMEOUT_MS, pollPaymentAttempt } from "../lib/commerce/paymentPolling.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const CHAVE = "6f1c1c1e-5a0b-4d1e-9a0b-5a0b4d1e9a0b";
const AGORA = 1_700_000_000_000;

function armazenamento() {
  const dados = new Map();
  return {
    dados,
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, v),
    removeItem: (k) => dados.delete(k),
  };
}

function relogio(inicio = AGORA) {
  let agora = inicio;
  return {
    now: () => agora,
    wait: async (ms) => {
      agora += ms;
    },
    get decorrido() {
      return agora - inicio;
    },
  };
}

function gravar(storage, em = AGORA, key = CHAVE, method = "mercadopago_card") {
  writePendingPayment(storage, { key, method, at: em });
}

// ---------- o que é guardado ----------
test("guarda só a chave, a forma de pagamento e o horário", () => {
  const storage = armazenamento();
  gravar(storage);
  const bruto = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(bruto)).sort(), ["at", "key", "method", "v"]);
  assert.deepEqual(readPendingPayment(storage, AGORA + 1000), { key: CHAVE, method: "mercadopago_card", at: AGORA });
  // Nada de cartão nem de dado pessoal na fonte do módulo.
  const fonte = read("lib/commerce/pendingPayment.ts");
  for (const proibido of ["cardToken", "holderDocument", "document", "email", "phone", "billing"]) {
    assert.ok(!fonte.includes(proibido), `não pode haver ${proibido}`);
  }
});

test("chave com 30 minutos ou mais é ignorada (e apagada); com menos, vale", () => {
  const storage = armazenamento();
  gravar(storage);
  assert.ok(readPendingPayment(storage, AGORA + PENDING_PAYMENT_TTL_MS - 1));
  assert.equal(readPendingPayment(storage, AGORA + PENDING_PAYMENT_TTL_MS), null);
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null, "a vencida é apagada");
});

test("valores inválidos, adulterados ou do futuro viram nada", () => {
  const bom = { v: 1, key: CHAVE, method: "inter_pix", at: AGORA };
  assert.ok(parsePendingPayment(JSON.stringify(bom), AGORA));
  for (const ruim of [
    { ...bom, v: 2 },
    { ...bom, key: "nao-e-uuid" },
    { ...bom, method: "dinheiro" },
    { ...bom, at: "ontem" },
    { ...bom, at: AGORA + 10 * 60_000 }, // do futuro
  ]) {
    assert.equal(parsePendingPayment(JSON.stringify(ruim), AGORA), null, JSON.stringify(ruim));
  }
  assert.equal(parsePendingPayment("não é json", AGORA), null);
  assert.equal(parsePendingPayment(null, AGORA), null);
  assert.equal(serializePendingPayment(bom).includes("inter_pix"), true);
});

test("armazenamento bloqueado ou ausente nunca derruba o pagamento", () => {
  const quebrado = {
    getItem: () => {
      throw new Error("bloqueado");
    },
    setItem: () => {
      throw new Error("bloqueado");
    },
    removeItem: () => {
      throw new Error("bloqueado");
    },
  };
  assert.equal(readPendingPayment(quebrado, AGORA), null);
  assert.doesNotThrow(() => gravar(quebrado));
  assert.doesNotThrow(() => clearPendingPayment(quebrado));
  assert.equal(readPendingPayment(null, AGORA), null);
  assert.doesNotThrow(() => writePendingPayment(null, { key: CHAVE, method: "inter_pix", at: AGORA }));
});

test("depois de uma falha, a chave só fica guardada quando o resultado é incerto", () => {
  // Incerto: guarda.
  for (const incerto of [
    {}, // sem resposta (erro de rede)
    { status: 500, code: "UNKNOWN" },
    { status: 502, code: "PROVIDER_REQUEST_FAILED" },
    { status: 503, code: "PROVIDER_AUTH_FAILED" },
    { status: 409, code: "PAYMENT_IN_PROGRESS" },
    { status: 409, code: "CHECKOUT_IN_PROGRESS" },
  ]) {
    assert.equal(shouldKeepPendingAfterFailure(incerto), true, JSON.stringify(incerto));
  }
  // Definitivo: libera.
  for (const definitivo of [
    { status: 402, code: "CARD_PAYMENT_DECLINED" },
    { status: 400, code: "REQUEST_VALIDATION" },
    { status: 422, code: "VALIDATION" },
    { status: 429, code: "RATE_LIMITED" },
    { status: 429, code: "CARD_ATTEMPTS_EXCEEDED" },
    { status: 409, code: "ORDER_TOTAL_MISMATCH" },
    { status: 409, code: "CART_CHANGED" },
  ]) {
    assert.equal(shouldKeepPendingAfterFailure(definitivo), false, JSON.stringify(definitivo));
  }
});

// ---------- recarregar a página ----------
const geraChave = (() => {
  let n = 0;
  return () => `chave-nova-${++n}`;
})();

test("recarregar em processamento: volta para a espera, sem chave nova e sem liberar pagamento", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage, AGORA);
  const consultas = [];
  const resultado = await resumePendingPayment({
    storage,
    check: async (chave) => {
      consultas.push(chave);
      return { outcome: "processing" };
    },
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
  });
  assert.deepEqual(resultado, { kind: "timeout" });
  // Consultou a MESMA chave, a cada 5 s, por 2 minutos.
  assert.equal(consultas.length, PAYMENT_POLL_TIMEOUT_MS / PAYMENT_POLL_INTERVAL_MS);
  assert.ok(consultas.every((chave) => chave === CHAVE));
  // A chave continua guardada: recarregar de novo volta para a mesma espera.
  assert.deepEqual(readPendingPayment(storage, tempo.now())?.key, CHAVE);
});

test("recarregar em processamento que depois se resolve: vai para a página do pedido", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage);
  let consultas = 0;
  const resultado = await resumePendingPayment({
    storage,
    check: async () => {
      consultas += 1;
      return consultas < 3
        ? { outcome: "processing" }
        : { outcome: "created", confirmationUrl: `/checkout/confirmacao?attempt=${CHAVE}` };
    },
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
  });
  assert.deepEqual(resultado, { kind: "created", confirmationUrl: `/checkout/confirmacao?attempt=${CHAVE}` });
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null, "pedido criado apaga a chave pendente");
});

test("recarregar depois de aprovado: direto para a página do pedido", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage);
  const resultado = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "created", confirmationUrl: "/checkout/confirmacao?attempt=k" }),
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
  });
  assert.equal(resultado.kind, "created");
  assert.equal(tempo.decorrido, 0, "sem esperar nada");
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null);
});

test("recarregar depois de recusado: apaga a pendente, libera com chave NOVA e segue o fluxo da recusa", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage);
  const resultado = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "declined" }),
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
  });
  assert.equal(resultado.kind, "declined");
  assert.notEqual(resultado.newKey, CHAVE);
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null);
});

test("chave com mais de 30 minutos: ignorada, sem nenhuma consulta", async () => {
  const storage = armazenamento();
  gravar(storage, AGORA - PENDING_PAYMENT_TTL_MS - 60_000);
  let consultas = 0;
  const resultado = await resumePendingPayment({
    storage,
    check: async () => {
      consultas += 1;
      return { outcome: "processing" };
    },
    wait: async () => {},
    now: () => AGORA,
    generateKey: geraChave,
  });
  assert.deepEqual(resultado, { kind: "none" });
  assert.equal(consultas, 0);
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null);
  // Sem nada guardado: igual.
  assert.deepEqual(
    await resumePendingPayment({ storage, check: async () => null, wait: async () => {}, now: () => AGORA, generateKey: geraChave }),
    { kind: "none" },
  );
});

test("tentativa que nunca existiu: apaga a chave pendente e libera normalmente", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage);
  const resultado = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "not_found" }),
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
  });
  assert.deepEqual(resultado, { kind: "not_found" });
  assert.equal(storage.getItem(PENDING_PAYMENT_STORAGE_KEY), null);
});

test("no pagamento em andamento, 'não encontrada' conta como ainda processando (só ao retomar ela libera)", async () => {
  const tempo = relogio();
  let consultas = 0;
  const resultado = await pollPaymentAttempt({
    check: async () => {
      consultas += 1;
      return consultas < 3 ? { outcome: "not_found" } : { outcome: "declined" };
    },
    wait: tempo.wait,
    now: tempo.now,
  });
  assert.deepEqual(resultado, { kind: "declined" });
  assert.equal(consultas, 3);
});

test("sair da página durante a retomada mantém a chave guardada", async () => {
  const storage = armazenamento();
  const tempo = relogio();
  gravar(storage);
  const resultado = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "processing" }),
    wait: tempo.wait,
    now: tempo.now,
    generateKey: geraChave,
    isCancelled: () => true,
  });
  assert.deepEqual(resultado, { kind: "cancelled" });
  assert.ok(storage.getItem(PENDING_PAYMENT_STORAGE_KEY));
});

// ---------- o checkout e a rota ----------
test("checkout: grava a chave antes de enviar, libera ao concluir e retoma ao abrir", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  // Grava ANTES do envio.
  const gravacao = form.indexOf("rememberPendingPayment(browserPendingStorage(), idempotencyKey, paymentMethod);");
  const envio = form.indexOf('const response = await fetch("/api/checkout/payment", {');
  assert.ok(gravacao > -1 && envio > gravacao);
  // Só chave, forma de pagamento e horário (o horário é de agora, dentro de pendingPayment.ts).
  assert.ok(read("lib/commerce/pendingPayment.ts").includes("writePendingPayment(storage, { key, method, at: Date.now() });"));
  // Pedido criado apaga a chave (os quatro desfechos de sucesso passam por um só lugar).
  assert.ok(form.includes("const markOrderCreated = () => {\n    clearPendingPayment(browserPendingStorage());\n    setHasCreatedOrder();\n  };"));
  assert.equal(form.split("markOrderCreated();").length - 1, 4);
  assert.equal(form.split("setHasCreatedOrder();").length - 1, 1 + 1); // a definição + a retomada
  // Falha definitiva apaga; incerta mantém.
  assert.ok(form.includes("if (!shouldKeepPendingAfterFailure(outcome)) clearPendingPayment(browserPendingStorage());"));
  // Abre travado se há chave pendente e retoma ao montar.
  assert.ok(form.includes("() => (readPendingPayment(browserPendingStorage()) ? \"confirming\" : \"idle\")"));
  assert.ok(form.includes("void resumePendingPayment({"));
  assert.ok(form.includes("generateKey: createIdempotencyKey,"));
  // Recusa descoberta na espera ao vivo também apaga a chave.
  const ao_vivo = form.slice(form.indexOf('if (polled.kind === "declined") {'), form.indexOf("// 2 minutos sem confirmação: mensagem final, sem liberar novo pagamento."));
  assert.ok(ao_vivo.includes("clearPendingPayment(browserPendingStorage());"));
});

test("a rota de consulta responde 'não encontrada' só para a tentativa que nunca existiu", () => {
  const route = read("app/api/checkout/payment/attempt/route.ts");
  assert.ok(route.includes('error.message.endsWith("(404)")'));
  assert.ok(route.includes('respond({ outcome: "not_found" satisfies AttemptOutcome })'));
  // Qualquer outro erro continua sendo dúvida ("processing").
  assert.ok(route.includes("throw error;"));
  assert.ok(route.includes("} catch {\n    return processing();"));
});
