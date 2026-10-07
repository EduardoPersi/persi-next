import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostcodeCache,
  lookupPostcodeWithFallback,
  parseBrasilApiPostcode,
  parseViaCepPostcode,
} from "../lib/commerce/postcodeLookup.ts";

const brasilApiBody = {
  cep: "13201000",
  state: "SP",
  city: "Jundiaí",
  neighborhood: "Centro",
  street: "Rua do Rosário",
};
const viaCepBody = {
  cep: "13201-000",
  logradouro: "Rua do Rosário",
  bairro: "Centro",
  localidade: "Jundiaí",
  uf: "SP",
};

function respond(body, ok = true) {
  return { ok, json: async () => body };
}

test("BrasilAPI é consultada primeiro e o ViaCEP nem é chamado", async () => {
  const urls = [];
  const address = await lookupPostcodeWithFallback("13201-000", async (url) => {
    urls.push(url);
    return respond(brasilApiBody);
  });
  assert.deepEqual(urls, ["https://brasilapi.com.br/api/cep/v1/13201000"]);
  assert.equal(address?.address1, "Rua do Rosário");
  assert.equal(address?.address2, "Centro");
  assert.equal(address?.city, "Jundiaí");
  assert.equal(address?.state, "SP");
  assert.equal(address?.country, "BR");
});

test("cai para o ViaCEP quando a BrasilAPI falha, devolve erro ou não acha", async () => {
  for (const brasilApi of [
    async () => {
      throw new Error("timeout");
    },
    async () => respond({}, false),
    async () => respond({ message: "CEP não encontrado" }),
  ]) {
    const urls = [];
    const address = await lookupPostcodeWithFallback("13201000", async (url) => {
      urls.push(url);
      return url.includes("brasilapi") ? brasilApi() : respond(viaCepBody);
    });
    assert.equal(urls.length, 2);
    assert.match(urls[1], /viacep\.com\.br\/ws\/13201000\/json/);
    assert.equal(address?.city, "Jundiaí");
  }
});

test("CEP inexistente nos dois provedores resolve para undefined", async () => {
  const address = await lookupPostcodeWithFallback("00000000", async (url) =>
    url.includes("brasilapi") ? respond({}, false) : respond({ erro: true }),
  );
  assert.equal(address, undefined);
});

test("CEP malformado nem chama a rede", async () => {
  let calls = 0;
  const address = await lookupPostcodeWithFallback("123", async () => {
    calls += 1;
    return respond(brasilApiBody);
  });
  assert.equal(address, undefined);
  assert.equal(calls, 0);
});

test("parsers exigem cidade e UF e aceitam rua vazia (CEP geral de cidade)", () => {
  assert.equal(parseBrasilApiPostcode("13201000", { city: "X" }), undefined);
  assert.equal(parseViaCepPostcode("13201000", { erro: "true" }), undefined);
  const cityOnly = parseViaCepPostcode("13200000", {
    cep: "13200-000",
    logradouro: "",
    bairro: "",
    localidade: "Jundiaí",
    uf: "SP",
  });
  assert.equal(cityOnly?.address1, undefined);
  assert.equal(cityOnly?.city, "Jundiaí");
});

test("cache guarda por 24 h, expira e limita o tamanho", () => {
  let now = 1_000;
  const cache = createPostcodeCache(() => now);
  const address = { city: "Jundiaí", state: "SP", country: "BR" };

  assert.equal(cache.get("13201000"), undefined);
  cache.set("13201000", address);
  assert.deepEqual(cache.get("13201000"), address);

  now += 24 * 60 * 60 * 1000 - 1;
  assert.deepEqual(cache.get("13201000"), address);
  now += 2;
  assert.equal(cache.get("13201000"), undefined);

  for (let index = 0; index < 600; index += 1) {
    cache.set(String(10_000_000 + index), address);
  }
  assert.equal(cache.get("10000000"), undefined);
  assert.deepEqual(cache.get("10000599"), address);
});
