import assert from "node:assert/strict";
import test from "node:test";
import { clearIdempotencyCacheForTests, withIdempotency } from "../lib/commerce/nativeCommerceIdempotency.ts";

test.beforeEach(() => clearIdempotencyCacheForTests());

test("withIdempotency: a chamada repetida com a mesma chave retorna o resultado em cache, sem executar `run` de novo", async () => {
  let callCount = 0;
  const run = async () => { callCount += 1; return { value: callCount }; };
  const first = await withIdempotency("scope-a", "key-1", run);
  const second = await withIdempotency("scope-a", "key-1", run);
  assert.equal(callCount, 1);
  assert.deepEqual(first, second);
});

test("withIdempotency: chaves diferentes nunca colidem", async () => {
  let callCount = 0;
  const run = async () => { callCount += 1; return callCount; };
  await withIdempotency("scope-a", "key-1", run);
  await withIdempotency("scope-a", "key-2", run);
  assert.equal(callCount, 2);
});

test("withIdempotency: o mesmo valor de chave em escopos diferentes não colide", async () => {
  let callCount = 0;
  const run = async () => { callCount += 1; return callCount; };
  await withIdempotency("cart:add-item", "same-key", run);
  await withIdempotency("cart:remove-item", "same-key", run);
  assert.equal(callCount, 2);
});

test("withIdempotency: uma rejeição de `run` não é cacheada -- uma nova tentativa executa `run` de novo", async () => {
  let callCount = 0;
  const run = async () => {
    callCount += 1;
    if (callCount === 1) throw new Error("falha transitória");
    return "ok";
  };
  await assert.rejects(withIdempotency("scope-a", "key-retry", run));
  const result = await withIdempotency("scope-a", "key-retry", run);
  assert.equal(callCount, 2);
  assert.equal(result, "ok");
});
