import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTrustedIpLimiter } from "../lib/network/trustedIpLimiter.ts";
import { getTrustedClientIp } from "../lib/network/trustedIp.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function montar(overrides = {}) {
  let agora = 1_000_000;
  const avisos = [];
  const limitador = createTrustedIpLimiter({
    windowMs: 60_000,
    maxRequests: 60,
    route: "/api/checkout/payment/attempt",
    getIp: getTrustedClientIp,
    warn: (mensagem, dados) => avisos.push({ mensagem, dados }),
    now: () => agora,
    ...overrides,
  });
  return { limitador, avisos, avancar: (ms) => (agora += ms) };
}

const comIp = (ip = "203.0.113.7") => new Headers({ "cf-connecting-ip": ip });

test("60 consultas por minuto por IP; a 61ª é barrada e a janela libera depois", () => {
  const { limitador, avancar } = montar();
  for (let i = 1; i <= 60; i += 1) assert.equal(limitador.isLimited(comIp()), false, `consulta ${i}`);
  assert.equal(limitador.isLimited(comIp()), true);
  // Outro IP tem a sua contagem.
  assert.equal(limitador.isLimited(comIp("198.51.100.9")), false);
  // Passada a janela, volta a responder.
  avancar(61_000);
  assert.equal(limitador.isLimited(comIp()), false);
});

test("uma aba consultando a cada 5 s por 2 minutos fica longe do limite", () => {
  const { limitador, avancar } = montar();
  for (let i = 0; i < 24; i += 1) {
    assert.equal(limitador.isLimited(comIp()), false);
    avancar(5_000);
  }
});

test("sem IP de confiança não limita e registra o aviso com a rota, sem dado pessoal", () => {
  const { limitador, avisos } = montar();
  // x-forwarded-for e x-real-ip forjados não valem como IP.
  const semIp = new Headers({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8" });
  for (let i = 1; i <= 100; i += 1) assert.equal(limitador.isLimited(semIp), false);
  assert.equal(avisos.length, 100);
  assert.deepEqual(avisos[0].dados, { route: "/api/checkout/payment/attempt", ocorrencias: 1 });
  assert.equal(avisos[99].dados.ocorrencias, 100);
  assert.ok(avisos[0].mensagem.includes("IP de confiança não identificado"));
  const log = JSON.stringify(avisos);
  for (const proibido of ["9.9.9.9", "8.8.8.8"]) assert.ok(!log.includes(proibido));
  // Com IP confiável, o limite funciona normalmente.
  for (let i = 1; i <= 60; i += 1) assert.equal(limitador.isLimited(comIp()), false);
  assert.equal(limitador.isLimited(comIp()), true);
  assert.equal(avisos.length, 100, "com IP confiável não sai aviso");
});

test("a rota de consulta usa o limitador de IP de confiança (60 por minuto) e os outros ficam como estão", () => {
  const route = read("app/api/checkout/payment/attempt/route.ts");
  assert.ok(route.includes('createTrustedIpRateLimiter(60 * 1000, 60, "/api/checkout/payment/attempt")'));
  assert.ok(route.includes("rateLimiter.isLimited(request.headers)"));
  assert.ok(!route.includes("createRateLimiter"));
  const limitador = read("lib/network/rateLimit.ts");
  assert.ok(limitador.includes("export function createTrustedIpRateLimiter"));
  assert.ok(limitador.includes('const ip = getRequestIp(headers) || "unknown";'));
  // O IP vem só do cabeçalho da Cloudflare, o mesmo do pagamento.
  assert.ok(limitador.split("getIp: getTrustedClientIp").length - 1 >= 2);
  assert.ok(read("lib/recaptcha/verify.ts").includes('headers.get("x-forwarded-for")?.split(",")[0]?.trim()'));
});
