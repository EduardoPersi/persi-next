import assert from "node:assert/strict";
import test from "node:test";
import { getValidAccessToken } from "../../lib/shipping/providers/melhor-envio/auth.ts";
import { calculateShipment } from "../../lib/shipping/providers/melhor-envio/client.ts";
import { ShippingProviderError } from "../../lib/shipping/core/errors.ts";

const CONFIG = {
  clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://example.test/callback",
  environment: "sandbox", baseUrl: "https://sandbox.melhorenvio.com.br",
  userAgent: "Persi Next (dev@example.test)", originPostcode: "13214065",
  timeoutMs: 200, maxRetries: 2, quoteCacheTtlMs: 900_000,
  tokenEncryptionKeyBase64: "x".repeat(44),
};

function makeMemoryStore(initial) {
  let current = initial;
  return {
    async load() { return current; },
    async save(credential) { current = credential; },
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("token ainda válido: getValidAccessToken não chama a rede", async () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const store = makeMemoryStore({
    accessToken: "still-valid", refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(now.getTime() + 20 * 60 * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
  });
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse(200, {}); };

  const token = await getValidAccessToken(CONFIG, store, fetchImpl, now);

  assert.equal(token, "still-valid");
  assert.equal(calls, 0);
});

test("token expirado (dentro da margem) dispara refresh automático e persiste o novo token", async () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const store = makeMemoryStore({
    accessToken: "expiring-soon", refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(now.getTime() + 60 * 1000), // dentro da margem de 5min
    refreshTokenExpiresAt: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonResponse(200, { access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 2_592_000 });
  };

  const token = await getValidAccessToken(CONFIG, store, fetchImpl, now);

  assert.equal(token, "new-access-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.grant_type, "refresh_token");
  assert.equal(calls[0].body.refresh_token, "refresh-1");
  assert.ok(calls[0].url.startsWith(CONFIG.baseUrl), "deve usar a base URL do ambiente configurado (sandbox sem www)");

  const stored = await store.load();
  assert.equal(stored.accessToken, "new-access-token", "o novo token deve ser persistido, não só devolvido");
});

test("refresh_token também expirado: exige reautorização manual, sem chamar a rede", async () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const store = makeMemoryStore({
    accessToken: "old", refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(now.getTime() - 1_000),
    refreshTokenExpiresAt: new Date(now.getTime() - 1_000),
  });
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse(200, {}); };

  await assert.rejects(
    () => getValidAccessToken(CONFIG, store, fetchImpl, now),
    (error) => {
      assert.ok(error instanceof ShippingProviderError);
      assert.equal(error.code, "AUTH");
      return true;
    },
  );
  assert.equal(calls, 0, "sem refresh_token válido não há chamada a fazer");
});

test("nunca autorizado: getValidAccessToken falha com AUTH sem tentar rede", async () => {
  const store = makeMemoryStore(null);
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse(200, {}); };

  await assert.rejects(() => getValidAccessToken(CONFIG, store, fetchImpl, new Date()), (error) => {
    assert.ok(error instanceof ShippingProviderError);
    assert.equal(error.code, "AUTH");
    return true;
  });
  assert.equal(calls, 0);
});

const PAYLOAD = {
  from: { postal_code: "13214065" },
  to: { postal_code: "01310000" },
  products: [{ id: "v1", width: 10, height: 10, length: 10, weight: 1, insurance_value: 100, quantity: 1 }],
};

test("500 transitório: tenta de novo e devolve sucesso na segunda tentativa", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    if (attempts === 1) return jsonResponse(500, {});
    return jsonResponse(200, [{ id: 1, name: "PAC", price: "10.00", delivery_time: 5, company: { id: 1, name: "Correios" } }]);
  };

  const result = await calculateShipment(CONFIG, "token", PAYLOAD, fetchImpl);

  assert.equal(attempts, 2);
  assert.ok(Array.isArray(result));
});

test("indisponibilidade persistente (5xx em todas as tentativas) lança UNAVAILABLE após esgotar o retry", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts++; return jsonResponse(503, {}); };

  await assert.rejects(() => calculateShipment(CONFIG, "token", PAYLOAD, fetchImpl), (error) => {
    assert.ok(error instanceof ShippingProviderError);
    assert.equal(error.code, "UNAVAILABLE");
    return true;
  });
  assert.equal(attempts, CONFIG.maxRetries + 1, "deve tentar exatamente maxRetries+1 vezes, nem mais nem menos");
});

test("timeout é classificado como TIMEOUT e também é retentado", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    throw new DOMException("aborted", "TimeoutError");
  };

  await assert.rejects(() => calculateShipment(CONFIG, "token", PAYLOAD, fetchImpl), (error) => {
    assert.ok(error instanceof ShippingProviderError);
    assert.equal(error.code, "TIMEOUT");
    return true;
  });
  assert.equal(attempts, CONFIG.maxRetries + 1);
});

test("erro do cliente (422) não é retentado — problema no payload não se resolve tentando de novo", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts++; return jsonResponse(422, { errors: {} }); };

  await assert.rejects(() => calculateShipment(CONFIG, "token", PAYLOAD, fetchImpl), (error) => {
    assert.ok(error instanceof ShippingProviderError);
    assert.equal(error.code, "INVALID_REQUEST");
    return true;
  });
  assert.equal(attempts, 1);
});

test("401 é classificado como AUTH e não é retentado (token deve ser renovado por fora, não em loop)", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts++; return jsonResponse(401, {}); };

  await assert.rejects(() => calculateShipment(CONFIG, "token", PAYLOAD, fetchImpl), (error) => {
    assert.ok(error instanceof ShippingProviderError);
    assert.equal(error.code, "AUTH");
    return true;
  });
  assert.equal(attempts, 1);
});
